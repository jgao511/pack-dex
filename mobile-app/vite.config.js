import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const mobileAppDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command, mode }) => {
  const scannerTestMode = mode.startsWith("native-scanner");
  const scannerAiPocMode = mode === "native-scanner-ai";

  return {
    base: command === "build" ? (mode.startsWith("native") ? "./" : "/mobile-app/") : "/",
    define: {
      __PACKDEX_SCANNER_TEST__: JSON.stringify(scannerTestMode),
      __PACKDEX_SCANNER_AI_POC__: JSON.stringify(scannerAiPocMode),
    },
    plugins: [react()],
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
