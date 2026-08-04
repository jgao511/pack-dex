import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const source = path.join(dist, "index.html");
const routes = ["welcome", "privacy", "terms", "auth/callback", "reset-password"];

for (const route of routes) {
  const cleanUrlFile = path.join(dist, `${route}.html`);
  const directoryFile = path.join(dist, route, "index.html");
  await fs.mkdir(path.dirname(cleanUrlFile), { recursive: true });
  await fs.mkdir(path.dirname(directoryFile), { recursive: true });
  await fs.copyFile(source, cleanUrlFile);
  await fs.copyFile(source, directoryFile);
}

console.log(`Copied the desktop entry to ${routes.length} direct-route locations.`);
