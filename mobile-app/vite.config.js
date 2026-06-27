import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const mobileAppDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/mobile-app/" : "/",
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
}));
