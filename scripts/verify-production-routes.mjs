import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const desktopEntry = path.join(dist, "index.html");
const mobileEntry = path.join(dist, "mobile-app", "index.html");
const redirectsPath = path.join(dist, "_redirects");

function read(file) {
  assert.ok(fs.existsSync(file), `Missing production artifact: ${path.relative(root, file)}`);
  return fs.readFileSync(file, "utf8");
}

function parseRedirects(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [from, to, status] = line.split(/\s+/);
      return { from, to, status };
    });
}

function matches(pattern, pathname) {
  if (!pattern.includes("*")) return pattern === pathname;
  const prefix = pattern.slice(0, pattern.indexOf("*"));
  return pathname.startsWith(prefix);
}

function resolveEntry(pathname, rules) {
  const exactFile = path.join(dist, pathname.replace(/^\/+/, ""));
  if (fs.existsSync(exactFile) && fs.statSync(exactFile).isFile()) return exactFile;

  const directoryEntry = path.join(exactFile, "index.html");
  if (fs.existsSync(directoryEntry)) return directoryEntry;

  const rule = rules.find((candidate) => matches(candidate.from, pathname));
  assert.ok(rule, `No Cloudflare fallback matches ${pathname}`);
  assert.equal(rule.status, "200", `Fallback for ${pathname} must be an internal rewrite`);
  return path.join(dist, rule.to.replace(/^\/+/, ""));
}

function getAssetPaths(html) {
  return [...html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:css|js))"/g)].map((match) => match[1]);
}

function assertEntryAssets(entry, expectedPrefix) {
  const html = read(entry);
  const assets = getAssetPaths(html);
  assert.ok(assets.some((asset) => asset.endsWith(".css")), `${entry} does not reference CSS`);
  assert.ok(assets.some((asset) => asset.endsWith(".js")), `${entry} does not reference JavaScript`);

  for (const asset of assets) {
    assert.ok(asset.startsWith(expectedPrefix), `${asset} uses the wrong production base`);
    const assetFile = path.join(dist, asset.replace(/^\/+/, ""));
    const contents = read(assetFile).trimStart();
    assert.ok(!contents.startsWith("<!doctype html"), `${asset} incorrectly resolves to HTML`);
  }
}

function assertEntryMarker(entry, expectedMarker) {
  const html = read(entry);
  assert.match(
    html,
    new RegExp(`<meta\\s+name=["']packdex-entry["']\\s+content=["']${expectedMarker}["']\\s*/?>`),
    `${entry} does not contain the ${expectedMarker} entry marker`
  );
}

const redirects = parseRedirects(read(redirectsPath));
assert.deepEqual(redirects, [
  { from: "/privacy", to: "/index.html", status: "200" },
  { from: "/terms", to: "/index.html", status: "200" },
  { from: "/mobile-app/share/*", to: "/mobile-app/index.html", status: "200" },
  { from: "/mobile-app/*", to: "/mobile-app/index.html", status: "200" },
]);
assert.ok(!fs.existsSync(path.join(dist, "mobile-app", "_redirects")), "Nested mobile _redirects must not be deployed");

const routeCases = [
  ["/privacy", desktopEntry],
  ["/terms", desktopEntry],
  ["/mobile-app", mobileEntry],
  ["/mobile-app/", mobileEntry],
  ["/mobile-app/share/VALID_SHARE_CODE", mobileEntry],
  ["/mobile-app/share/INVALID_SHARE_CODE", mobileEntry],
  ["/mobile-app/reset-password", path.join(dist, "mobile-app", "reset-password", "index.html")],
  ["/mobile-app/auth/callback", mobileEntry],
  ["/mobile-app/explore", mobileEntry],
  ["/mobile-app/explore/search", mobileEntry],
  ["/mobile-app/explore/pokemon/94", mobileEntry],
  ["/mobile-app/explore/sets/base-set", mobileEntry],
  ["/mobile-app/explore/eras/sword-shield", mobileEntry],
];

for (const [pathname, expected] of routeCases) {
  assert.equal(path.resolve(resolveEntry(pathname, redirects)), path.resolve(expected), `${pathname} resolves to the wrong HTML entry`);
}

assertEntryAssets(desktopEntry, "/assets/");
assertEntryAssets(mobileEntry, "/mobile-app/assets/");
assertEntryAssets(path.join(dist, "mobile-app", "reset-password", "index.html"), "/mobile-app/assets/");
assertEntryMarker(desktopEntry, "legacy-desktop");
assertEntryMarker(mobileEntry, "mobile-app");
assertEntryMarker(path.join(dist, "mobile-app", "reset-password", "index.html"), "mobile-app");

console.log(`Verified ${routeCases.length} production routes and all generated entry assets.`);
