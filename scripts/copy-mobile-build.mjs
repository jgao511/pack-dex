import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileDist = path.join(repoRoot, "mobile-app", "dist");
const targetDist = path.join(repoRoot, "dist", "mobile-app");
const resetPasswordDist = path.join(targetDist, "reset-password");
const authCallbackDist = path.join(targetDist, "auth", "callback");

await rm(targetDist, { recursive: true, force: true });
await mkdir(path.dirname(targetDist), { recursive: true });
await cp(mobileDist, targetDist, { recursive: true });
// Cloudflare Pages reads routing controls only from the deployment root. The
// mobile Vite build shares ../public, so discard nested copies and keep the
// root dist controls authoritative.
await rm(path.join(targetDist, "_redirects"), { force: true });
await rm(path.join(targetDist, "_headers"), { force: true });
await rm(path.join(targetDist, "_routes.json"), { force: true });
await rm(path.join(targetDist, "sw.js"), { force: true });
// These are site-root control files. Keep their authoritative copies at /
// instead of deploying misleading duplicates below /mobile-app/.
await rm(path.join(targetDist, "ads.txt"), { force: true });
await rm(path.join(targetDist, "robots.txt"), { force: true });
await rm(path.join(targetDist, "sitemap.xml"), { force: true });
await mkdir(resetPasswordDist, { recursive: true });
await cp(path.join(mobileDist, "index.html"), path.join(resetPasswordDist, "index.html"));
await mkdir(authCallbackDist, { recursive: true });
await cp(path.join(mobileDist, "index.html"), path.join(authCallbackDist, "index.html"));

console.log("Copied mobile app build to dist/mobile-app");
