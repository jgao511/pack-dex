import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const htmlPath = path.join(dist, "index.html");
const mainSource = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
const loaderSource = fs.readFileSync(path.join(root, "src", "pageLoaders.js"), "utf8");
const html = fs.readFileSync(htmlPath, "utf8");

assert.match(mainSource, /const\s+loadDesktopPage\s*=\s*\(\)\s*=>\s*import\(["']\.\/App\.jsx["']\)/, "Desktop App must remain behind the lightweight product bootstrap");
assert.doesNotMatch(mainSource, /import\s+App\s+from\s+["']\.\/App\.jsx["']/, "Desktop App must not return to the eager startup graph");
assert.match(loaderSource, /import\(["']\.\/LandingPage\.jsx["']\)/, "Welcome must remain the intended lazy page");
assert.doesNotMatch(loaderSource, /import\(["']\.\/App\.jsx["']\)/, "The shared page-loader registry must stay welcome-only");

const htmlAssets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"'?#]+\.(?:js|css))["']/giu)].map((match) => match[1]);
assert.ok(htmlAssets.some((asset) => asset.endsWith(".js")), "Desktop HTML has no JavaScript entry");
assert.ok(htmlAssets.some((asset) => asset.endsWith(".css")), "Desktop HTML has no stylesheet entry");

const queue = [...htmlAssets.filter((asset) => asset.endsWith(".js"))];
const visited = new Set();
const edges = [];
while (queue.length > 0) {
  const asset = queue.shift();
  if (visited.has(asset)) continue;
  visited.add(asset);
  const file = path.join(dist, asset.replace(/^\/+/, ""));
  assert.ok(fs.existsSync(file), `Missing desktop JavaScript asset ${asset}`);
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source.trimStart(), /^<!doctype html/i, `${asset} contains HTML`);
  const imports = [
    ...[...source.matchAll(/import\(\s*["'`]([^"'`]+\.js)["'`]\s*\)/gu)].map((match) => ({ kind: "dynamic", specifier: match[1] })),
    ...[...source.matchAll(/(?:from\s*|import\s*)["'`]([^"'`]+\.js)["'`]/gu)].map((match) => ({ kind: "static", specifier: match[1] })),
  ];
  for (const imported of imports) {
    const resolved = new URL(imported.specifier, `https://pack-dex.invalid${asset}`).pathname;
    if (!resolved.startsWith("/assets/")) continue;
    edges.push({ from: asset, to: resolved, kind: imported.kind });
    if (!visited.has(resolved)) queue.push(resolved);
  }
}

const desktopFiles = fs.readdirSync(path.join(dist, "assets"));
const appChunks = desktopFiles.filter((file) => /^App-[^.]+\.(?:js|css)$/i.test(file));
assert.ok(appChunks.some((file) => file.endsWith(".js")), "Deferred desktop App JavaScript chunk is missing");
assert.ok(appChunks.some((file) => file.endsWith(".css")), "Deferred desktop App stylesheet chunk is missing");

const dynamicTargets = edges.filter((edge) => edge.kind === "dynamic").map((edge) => path.basename(edge.to));
assert.ok(dynamicTargets.some((target) => target.startsWith("LandingPage-")), "Welcome must remain a dynamic chunk");
assert.ok(dynamicTargets.some((target) => target.startsWith("App-")), "Desktop App must remain a dynamic chunk");

for (const asset of htmlAssets.filter((value) => value.endsWith(".css"))) {
  const file = path.join(dist, asset.replace(/^\/+/, ""));
  assert.ok(fs.existsSync(file), `Missing desktop CSS asset ${asset}`);
  assert.doesNotMatch(fs.readFileSync(file, "utf8").trimStart(), /^<!doctype html/i, `${asset} contains HTML`);
}

const report = {
  generatedAt: new Date().toISOString(),
  desktopEntryArchitecture: "lightweight product bootstrap; lazy App and LandingPage",
  htmlAssets,
  traversedJavaScriptAssets: [...visited],
  dynamicTargets,
  appChunks,
  edges,
};
console.log(JSON.stringify(report, null, 2));
