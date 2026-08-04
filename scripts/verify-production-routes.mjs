import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const desktopEntry = path.join(dist, "index.html");
const mobileEntry = path.join(dist, "mobile-app", "index.html");
const notFoundEntry = path.join(dist, "404.html");
const redirectsPath = path.join(dist, "_redirects");
const headersPath = path.join(dist, "_headers");
const publicAdsPath = path.join(root, "public", "ads.txt");
const builtAdsPath = path.join(dist, "ads.txt");
const mobileFallbackFunctionPath = path.join(root, "functions", "mobile-app", "[[path]].js");

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
  if (pathname.endsWith("/") && fs.existsSync(directoryEntry)) return directoryEntry;

  const cleanUrlFile = `${exactFile.replace(/[\\/]$/, "")}.html`;
  if (fs.existsSync(cleanUrlFile)) return cleanUrlFile;

  if (fs.existsSync(directoryEntry)) return directoryEntry;

  const rule = rules.find((candidate) => matches(candidate.from, pathname));
  if (!rule) {
    assert.ok(fs.existsSync(notFoundEntry), `No Cloudflare fallback or 404 page matches ${pathname}`);
    return notFoundEntry;
  }
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
assert.deepEqual(redirects, [], "SPA fallbacks must use Pages Functions, not HTML-rewriting redirects");
assert.ok(!fs.existsSync(path.join(dist, "mobile-app", "_redirects")), "Nested mobile _redirects must not be deployed");
assert.ok(!fs.existsSync(path.join(dist, "mobile-app", "_headers")), "Nested mobile _headers must not be deployed");
assert.ok(!fs.existsSync(path.join(dist, "mobile-app", "sw.js")), "The mobile app must use the root update worker");
const headers = read(headersPath);
assert.match(headers, /\/sw\.js[\s\S]*Cache-Control: no-store/);
assert.doesNotMatch(headers, /^\/mobile-app\/\*\s*\r?\n\s*Cache-Control:\s*no-store/m);
assert.doesNotMatch(headers, /\/assets\/\*[\s\S]*immutable/, "Missing desktop assets must not inherit an immutable SPA fallback response");
assert.doesNotMatch(headers, /\/mobile-app\/assets\/\*[\s\S]*immutable/, "Missing mobile assets must not inherit an immutable SPA fallback response");

const mobileFallbackSource = read(mobileFallbackFunctionPath);
const mobileFallbackModuleUrl = `data:text/javascript;base64,${Buffer.from(mobileFallbackSource).toString("base64")}`;
const { onRequest: mobileFallback } = await import(mobileFallbackModuleUrl);

async function invokeMobileFallback(pathname, { method = "GET", nextStatus = 404 } = {}) {
  let entryFetches = 0;
  const result = await mobileFallback({
    request: new Request(`https://packdex.test${pathname}`, { method }),
    next: async () => new Response("mobile 404", { status: nextStatus, headers: { "Cache-Control": "no-store" } }),
    env: {
      ASSETS: {
        fetch: async (request) => {
          entryFetches += 1;
          assert.equal(new URL(request.url).pathname, "/mobile-app/");
          return new Response(method === "HEAD" ? null : read(mobileEntry), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        },
      },
    },
  });
  return { result, entryFetches };
}

for (const pathname of [
  "/mobile-app/explore",
  "/mobile-app/explore/search",
  "/mobile-app/explore/pokemon/94",
  "/mobile-app/explore/sets/base-set",
  "/mobile-app/explore/eras/sword-shield",
]) {
  const { result, entryFetches } = await invokeMobileFallback(pathname);
  assert.equal(result.status, 200, `${pathname} must receive the mobile entry`);
  assert.equal(entryFetches, 1, `${pathname} must fetch the mobile entry exactly once`);
  assert.equal(result.headers.get("X-PackDex-Entry"), "mobile-app-fallback");
}

for (const pathname of [
  "/mobile-app/assets/missing.js",
  "/mobile-app/scanner-ai/missing.wasm",
  "/mobile-app/set-logos/missing.png",
  "/mobile-app/missing.css",
]) {
  const { result, entryFetches } = await invokeMobileFallback(pathname);
  assert.equal(result.status, 404, `${pathname} must remain a true 404`);
  assert.equal(entryFetches, 0, `${pathname} must not fetch the mobile entry`);
}

const routeCases = [
  ["/", desktopEntry],
  ["/welcome", path.join(dist, "welcome.html")],
  ["/privacy", path.join(dist, "privacy.html")],
  ["/privacy/", path.join(dist, "privacy", "index.html")],
  ["/terms", path.join(dist, "terms.html")],
  ["/terms/", path.join(dist, "terms", "index.html")],
  ["/auth/callback", path.join(dist, "auth", "callback.html")],
  ["/reset-password", path.join(dist, "reset-password.html")],
  ["/mobile-app", mobileEntry],
  ["/mobile-app/", mobileEntry],
  ["/mobile-app/reset-password", path.join(dist, "mobile-app", "reset-password", "index.html")],
  ["/mobile-app/auth/callback", path.join(dist, "mobile-app", "auth", "callback", "index.html")],
];

for (const [pathname, expected] of routeCases) {
  assert.equal(path.resolve(resolveEntry(pathname, redirects)), path.resolve(expected), `${pathname} resolves to the wrong HTML entry`);
}

assert.equal(path.resolve(resolveEntry("/assets/definitely-missing-packdex-audit.js", redirects)), path.resolve(notFoundEntry));
assert.equal(path.resolve(resolveEntry("/mobile-app/assets/definitely-missing-packdex-audit.js", redirects)), path.resolve(notFoundEntry));
assert.doesNotMatch(read(notFoundEntry), /<meta\s+name=["']packdex-entry["']/i, "The 404 response must not be a PackDex SPA shell");

assertEntryAssets(desktopEntry, "/assets/");
for (const route of ["welcome", "privacy", "terms", "auth/callback", "reset-password"]) {
  assertEntryAssets(path.join(dist, `${route}.html`), "/assets/");
  assertEntryAssets(path.join(dist, route, "index.html"), "/assets/");
}
assertEntryAssets(mobileEntry, "/mobile-app/assets/");
assertEntryAssets(path.join(dist, "mobile-app", "reset-password", "index.html"), "/mobile-app/assets/");
assertEntryAssets(path.join(dist, "mobile-app", "auth", "callback", "index.html"), "/mobile-app/assets/");
assertEntryMarker(desktopEntry, "welcome-controller");
assertEntryMarker(mobileEntry, "mobile-app");
assertEntryMarker(path.join(dist, "mobile-app", "reset-password", "index.html"), "mobile-app");
assertEntryMarker(path.join(dist, "mobile-app", "auth", "callback", "index.html"), "mobile-app");

const expectedAds = read(publicAdsPath).trim();
assert.equal(expectedAds, "google.com, pub-4828542760410446, DIRECT, f08c47fec0942fa0");
assert.equal(read(builtAdsPath).trim(), expectedAds, "The production build must preserve public/ads.txt exactly");

console.log(`Verified ${routeCases.length} production routes and all generated entry assets.`);
