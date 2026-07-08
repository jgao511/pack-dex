import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileDist = path.join(repoRoot, "mobile-app", "dist");
const targetDist = path.join(repoRoot, "dist", "mobile-app");
const resetPasswordDist = path.join(targetDist, "reset-password");

await rm(targetDist, { recursive: true, force: true });
await mkdir(path.dirname(targetDist), { recursive: true });
await cp(mobileDist, targetDist, { recursive: true });
await mkdir(resetPasswordDist, { recursive: true });
await cp(path.join(mobileDist, "index.html"), path.join(resetPasswordDist, "index.html"));

console.log("Copied mobile app build to dist/mobile-app");
