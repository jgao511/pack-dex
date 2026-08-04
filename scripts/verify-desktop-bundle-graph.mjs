import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const htmlPath = path.join(dist, "index.html");
const mainSource = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
const loaderSource = fs.readFileSync(path.join(root, "src", "pageLoaders.js"), "utf8");
const html = fs.readFileSync(htmlPath, "utf8");

assert.match(mainSource, /import\s+App\s+from\s+["']\.\/App\.jsx["']/, "Desktop App must remain a static entry import");
assert.doesNotMatch(mainSource, /loadDesktopPage/, "Desktop App must not return to a lazy bootstrap boundary");
assert.match(loaderSource, /import\(["']\.\/LandingPage\.jsx["']\)/, "Welcome must remain the intended lazy page");
assert.doesNotMatch(loaderSource, /import\(["']\.\/App\.jsx["']\)/, "App must never be dynamically imported");

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
assert.deepEqual(appChunks, [], `Forbidden separate desktop App chunk(s): ${appChunks.join(", ")}`);

const dynamicTargets = edges.filter((edge) => edge.kind === "dynamic").map((edge) => path.basename(edge.to));
assert.ok(dynamicTargets.every((target) => target.startsWith("LandingPage-")), `Unexpected desktop dynamic chunk(s): ${dynamicTargets.join(", ")}`);

for (const asset of htmlAssets.filter((value) => value.endsWith(".css"))) {
  const file = path.join(dist, asset.replace(/^\/+/, ""));
  assert.ok(fs.existsSync(file), `Missing desktop CSS asset ${asset}`);
  assert.doesNotMatch(fs.readFileSync(file, "utf8").trimStart(), /^<!doctype html/i, `${asset} contains HTML`);
}

const report = {
  generatedAt: new Date().toISOString(),
  desktopEntryArchitecture: "static App import; lazy LandingPage only",
  htmlAssets,
  traversedJavaScriptAssets: [...visited],
  dynamicTargets,
  appChunks,
  edges,
};
console.log(JSON.stringify(report, null, 2));
