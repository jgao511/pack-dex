import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { fingerprintScannerAiRuntimeSources } from "../scripts/scanner-ai/runtime-source-fingerprint.mjs";

const mobileAppDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command, mode }) => {
  const scannerTestMode = mode.startsWith("native-scanner");
  const scannerAiPocMode = mode === "native-scanner-ai";
  const scannerAiSourceSha256 = scannerAiPocMode ? fingerprintScannerAiRuntimeSources().sha256 : null;

  return {
    base: command === "build" ? (mode.startsWith("native") ? "./" : "/mobile-app/") : "/",
    define: {
      __PACKDEX_SCANNER_TEST__: JSON.stringify(scannerTestMode),
      __PACKDEX_SCANNER_AI_POC__: JSON.stringify(scannerAiPocMode),
      __PACKDEX_SCANNER_AI_SOURCE_SHA256__: JSON.stringify(scannerAiSourceSha256),
    },
    plugins: [
      react(),
      scannerAiPocMode && {
        name: "packdex-scanner-ai-build-marker",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "scanner-ai-build.json",
            source: `${JSON.stringify({ scannerAiPoc: true, runtimeSourceSha256: scannerAiSourceSha256 }, null, 2)}\n`,
          });
        },
      },
    ].filter(Boolean),
    envDir: mobileAppDir,
    publicDir: "../public",
    server: {
      port: 5174,
      strictPort: true,
    },
    preview: {
      port: 4174,
    },
  };
});
