import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const mobileAppDir = fileURLToPath(new URL(".", import.meta.url));

function mobileBundleReport() {
  if (process.env.PACKDEX_MOBILE_BUNDLE_REPORT !== "1") return null;

  return {
    name: "packdex-mobile-bundle-report",
    generateBundle(_options, bundle) {
      const report = Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .map((chunk) => ({
          fileName: chunk.fileName,
          bytes: Buffer.byteLength(chunk.code),
          gzipBytes: gzipSync(chunk.code).byteLength,
          brotliBytes: brotliCompressSync(chunk.code).byteLength,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.entries(chunk.modules)
            .map(([id, details]) => ({
              id: id.replaceAll("\\", "/"),
              renderedBytes: details.renderedLength || 0,
            }))
            .sort((left, right) => right.renderedBytes - left.renderedBytes),
        }));

      this.emitFile({
        type: "asset",
        fileName: "bundle-report.json",
        source: JSON.stringify(report, null, 2),
      });
    },
  };
}

function stripPrivateScannerStyles(mode) {
  if (mode !== "native") return null;

  return {
    name: "packdex-strip-private-scanner-styles",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?", 1)[0];
      if (!normalizedId.endsWith("/src/App.css")) return null;

      const stripped = source.replace(
        /\/\* PACKDEX_PRIVATE_SCANNER_START \*\/[\s\S]*?\/\* PACKDEX_PRIVATE_SCANNER_END \*\//g,
        ""
      );
      return stripped === source ? null : { code: stripped, map: null };
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  base: command === "build" ? (mode.startsWith("native") ? "./" : "/mobile-app/") : "/",
  define: {
    __PACKDEX_SCANNER_TEST__: JSON.stringify(mode === "native-scanner"),
    __PACKDEX_NATIVE_BUILD__: JSON.stringify(mode.startsWith("native")),
  },
  plugins: [stripPrivateScannerStyles(mode), react(), mobileBundleReport()].filter(Boolean),
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@supabase/supabase-js",
      "@supabase/auth-js",
      "@supabase/functions-js",
      "@supabase/postgrest-js",
      "@supabase/realtime-js",
      "@supabase/storage-js",
    ],
  },
  envDir: mobileAppDir,
  publicDir: "../public",
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 4174,
  },
}));
