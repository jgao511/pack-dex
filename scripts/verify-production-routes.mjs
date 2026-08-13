import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getPublicSeoDescriptor } from "../src/lib/publicSeo.js";
import { INDEXABLE_PUBLIC_PATHS, PACKDEX_SITE_ORIGIN } from "../src/lib/publicRoutes.js";
import { canonicalSetCatalog } from "../src/lib/publicSetRoutes.js";

const root = process.cwd();
const dist = path.join(root, "dist");
const desktopEntry = path.join(dist, "index.html");
const mobileEntry = path.join(dist, "mobile-app", "index.html");
const notFoundEntry = path.join(dist, "404.html");
const redirectsPath = path.join(dist, "_redirects");
const headersPath = path.join(dist, "_headers");
const routesConfigPath = path.join(dist, "_routes.json");
const mobileFallbackFunction = path.join(root, "functions", "mobile-app", "[[path]].js");
const mobileShareFunction = path.join(root, "functions", "mobile-app", "share", "[[path]].js");
const publicAdsPath = path.join(root, "public", "ads.txt");
const builtAdsPath = path.join(dist, "ads.txt");
const builtRobotsPath = path.join(dist, "robots.txt");
const builtSitemapPath = path.join(dist, "sitemap.xml");
const fileTextCache = new Map();

function read(file) {
  assert.ok(fs.existsSync(file), `Missing production artifact: ${path.relative(root, file)}`);
  if (!fileTextCache.has(file)) fileTextCache.set(file, fs.readFileSync(file, "utf8"));
  return fileTextCache.get(file);
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

function isFunctionRoute(pathname, routesConfig) {
  const isIncluded = routesConfig.include.some((pattern) => matches(pattern, pathname));
  const isExcluded = routesConfig.exclude.some((pattern) => matches(pattern, pathname));
  return isIncluded && !isExcluded;
}

function resolveFunction(pathname) {
  return /^\/mobile-app\/share(?:\/|$)/.test(pathname)
    ? mobileShareFunction
    : mobileFallbackFunction;
}

function resolveEntry(pathname, rules, routesConfig) {
  // Cloudflare invokes matching Pages Functions before static asset handling.
  // _routes.json exclusions therefore protect files that must be served exactly.
  if (isFunctionRoute(pathname, routesConfig)) return resolveFunction(pathname);

  // For non-Function requests, Pages _redirects rules run before asset lookup.
  const rule = rules.find((candidate) => matches(candidate.from, pathname));
  if (rule) {
    assert.equal(rule.status, "200", `Fallback for ${pathname} must be an internal rewrite`);
    return path.join(dist, rule.to.replace(/^\/+/, ""));
  }

  const exactFile = path.join(dist, pathname.replace(/^\/+/, ""));
  if (fs.existsSync(exactFile) && fs.statSync(exactFile).isFile()) return exactFile;

  const directoryEntry = path.join(exactFile, "index.html");
  if (pathname.endsWith("/") && fs.existsSync(directoryEntry)) return directoryEntry;

  const extensionlessHtmlEntry = `${exactFile.replace(/[\\/]$/, "")}.html`;
  if (fs.existsSync(extensionlessHtmlEntry)) return extensionlessHtmlEntry;

  if (fs.existsSync(directoryEntry)) return directoryEntry;

  assert.ok(fs.existsSync(notFoundEntry), `No Cloudflare fallback or 404 page matches ${pathname}`);
  return notFoundEntry;
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

const utilityRoutes = [
  "collection",
  "profile",
  "settings",
  "login",
  "signup",
  "reset-password",
  "auth/callback",
  "onboarding",
];
const expectedUtilityRedirects = [
  ...utilityRoutes.map((route) => ({ from: `/${route}`, to: "/index.html", status: "200" })),
  ...utilityRoutes.map((route) => ({ from: `/${route}/*`, to: "/index.html", status: "200" })),
];
const redirects = parseRedirects(read(redirectsPath));
assert.deepEqual(
  redirects,
  expectedUtilityRedirects,
  "Only narrowly scoped account and utility routes may rewrite to the desktop entry"
);
assert.ok(
  !redirects.some((rule) => rule.from === "/*"),
  "Do not add a root catch-all to _redirects: Cloudflare would apply it even when a real static asset exists"
);
for (const forbiddenPrefix of ["/assets", "/mobile-app", "/set"]) {
  assert.ok(
    !redirects.some((rule) => rule.from === forbiddenPrefix || rule.from.startsWith(`${forbiddenPrefix}/`)),
    `${forbiddenPrefix} routes must never be rewritten to the desktop SPA entry`
  );
}
assert.ok(fs.existsSync(notFoundEntry), "A real top-level 404.html must protect unknown paths and missing assets");
assert.ok(!fs.existsSync(path.join(dist, "mobile-app", "_redirects")), "Nested mobile _redirects must not be deployed");
assert.ok(!fs.existsSync(path.join(dist, "mobile-app", "_headers")), "Nested mobile _headers must not be deployed");
assert.ok(!fs.existsSync(path.join(dist, "mobile-app", "_routes.json")), "Nested mobile _routes.json must not be deployed");
assert.ok(!fs.existsSync(path.join(dist, "mobile-app", "sw.js")), "The mobile app must use the root update worker");
for (const rootControlFile of ["ads.txt", "robots.txt", "sitemap.xml"]) {
  assert.ok(
    !fs.existsSync(path.join(dist, "mobile-app", rootControlFile)),
    `${rootControlFile} must be deployed only at the site root`
  );
}
const routesConfig = JSON.parse(read(routesConfigPath));
assert.deepEqual(routesConfig.include, ["/mobile-app", "/mobile-app/*"]);
for (const requiredExclusion of [
  "/mobile-app/assets/*",
  "/mobile-app/generated/*",
  "/mobile-app/scanner-ai/*",
  "/mobile-app/set-logos/*",
  "/mobile-app/index.html",
  "/mobile-app/404.html",
  "/mobile-app/reset-password",
  "/mobile-app/reset-password/*",
  "/mobile-app/auth/callback",
  "/mobile-app/auth/callback/*",
]) {
  assert.ok(routesConfig.exclude.includes(requiredExclusion), `${requiredExclusion} is missing from _routes.json`);
}
assert.ok(fs.existsSync(mobileFallbackFunction), "Missing scoped mobile fallback Pages Function");
assert.ok(fs.existsSync(mobileShareFunction), "Missing existing mobile share Pages Function");
assert.match(read(mobileFallbackFunction), /X-Robots-Tag/);
assert.match(read(mobileShareFunction), /X-Robots-Tag/);
const headers = read(headersPath);
assert.match(headers, /\/sw\.js[\s\S]*Cache-Control: no-store/);
assert.doesNotMatch(headers, /^\/mobile-app\/\*\s*\r?\n\s*Cache-Control:\s*no-store/m);
assert.doesNotMatch(headers, /\/assets\/\*[\s\S]*immutable/, "Missing desktop assets must not inherit an immutable SPA fallback response");
assert.doesNotMatch(headers, /\/mobile-app\/assets\/\*[\s\S]*immutable/, "Missing mobile assets must not inherit an immutable SPA fallback response");

for (const utilityRoute of [...utilityRoutes, "mobile-app"]) {
  assert.match(
    headers,
    new RegExp(`^/${utilityRoute.replace("/", "\\/")}\\s*\\r?\\n\\s*X-Robots-Tag: noindex, follow$`, "m"),
    `/${utilityRoute} must send a server-level noindex directive`
  );
  assert.match(
    headers,
    new RegExp(`^/${utilityRoute.replace("/", "\\/")}/\\*\\s*\\r?\\n\\s*X-Robots-Tag: noindex, follow$`, "m"),
    `/${utilityRoute}/* must send a server-level noindex directive`
  );
}

const mobileFallbackSource = read(mobileFallbackFunction);
const mobileFallbackModuleUrl = `data:text/javascript;base64,${Buffer.from(mobileFallbackSource).toString("base64")}`;
const { onRequest: mobileFallback } = await import(mobileFallbackModuleUrl);

async function invokeMobileFallback(pathname, { method = "GET", nextStatus = 404, withNext = true } = {}) {
  let entryFetches = 0;
  let nextCalls = 0;
  const result = await mobileFallback({
    request: new Request(`https://packdex.test${pathname}`, { method }),
    ...(withNext ? {
      next: async () => {
        nextCalls += 1;
        return new Response(method === "HEAD" ? null : `mobile ${nextStatus}`, {
          status: nextStatus,
          headers: { "Cache-Control": "no-store" },
        });
      },
    } : {}),
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
  return { result, entryFetches, nextCalls };
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
  assert.equal(result.headers.get("X-Robots-Tag"), "noindex, follow");
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

const noNextFallback = await invokeMobileFallback("/mobile-app/explore", { withNext: false });
assert.equal(noNextFallback.result.status, 200, "The Function test/runtime fallback may fetch the mobile entry without context.next");
assert.equal(noNextFallback.entryFetches, 1);

const deniedFallback = await invokeMobileFallback("/mobile-app/explore", { method: "POST" });
assert.equal(deniedFallback.result.status, 405);
assert.equal(deniedFallback.result.headers.get("Allow"), "GET, HEAD");
assert.equal(deniedFallback.result.headers.get("X-Robots-Tag"), "noindex, follow");
assert.equal(deniedFallback.entryFetches, 0);
assert.equal(deniedFallback.nextCalls, 0);

const exactStaticFallback = await invokeMobileFallback("/mobile-app/missing.css", { nextStatus: 200 });
assert.equal(exactStaticFallback.result.status, 200, "A static response must pass through the Function unchanged");
assert.equal(exactStaticFallback.entryFetches, 0);
assert.equal(exactStaticFallback.nextCalls, 1);

const routeCases = [
  ["/", desktopEntry],
  ["/welcome", snapshotEntry("/welcome")],
  ["/sets", snapshotEntry("/sets")],
  ["/how-it-works", snapshotEntry("/how-it-works")],
  ["/faq", snapshotEntry("/faq")],
  ["/about", snapshotEntry("/about")],
  ["/privacy", snapshotEntry("/privacy")],
  ["/privacy/", trailingSlashSnapshotEntry("/privacy")],
  ["/terms", snapshotEntry("/terms")],
  ["/terms/", trailingSlashSnapshotEntry("/terms")],
  ["/set/pokemon-151", snapshotEntry("/set/pokemon-151")],
  ["/set/151", notFoundEntry],
  ["/set/not-a-real-packdex-set", notFoundEntry],
  ["/collection", desktopEntry],
  ["/profile", desktopEntry],
  ["/settings", desktopEntry],
  ["/login", desktopEntry],
  ["/signup", desktopEntry],
  ["/reset-password", desktopEntry],
  ["/auth/callback", desktopEntry],
  ["/mobile-app", mobileFallbackFunction],
  ["/mobile-app/", mobileFallbackFunction],
  ["/mobile-app/share/VALID_SHARE_CODE", mobileShareFunction],
  ["/mobile-app/share/INVALID_SHARE_CODE", mobileShareFunction],
  ["/mobile-app/reset-password", path.join(dist, "mobile-app", "reset-password", "index.html")],
  ["/mobile-app/auth/callback", path.join(dist, "mobile-app", "auth", "callback", "index.html")],
  ["/mobile-app/explore", mobileFallbackFunction],
  ["/mobile-app/explore/search", mobileFallbackFunction],
  ["/mobile-app/explore/pokemon/94", mobileFallbackFunction],
  ["/mobile-app/explore/sets/base-set", mobileFallbackFunction],
  ["/mobile-app/explore/eras/sword-shield", mobileFallbackFunction],
];

for (const [pathname, expected] of routeCases) {
  assert.equal(path.resolve(resolveEntry(pathname, redirects, routesConfig)), path.resolve(expected), `${pathname} resolves to the wrong entry`);
}

function snapshotEntry(pathname) {
  return path.join(dist, `${pathname.replace(/^\/+|\/+$/g, "")}.html`);
}

function trailingSlashSnapshotEntry(pathname) {
  return path.join(dist, pathname.replace(/^\/+|\/+$/g, ""), "index.html");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertPublicSnapshot(pathname, entry) {
  const html = read(entry);
  const seo = getPublicSeoDescriptor(pathname);
  assert.match(
    html,
    new RegExp(`data-packdex-static-snapshot=["']${escapeRegExp(pathname)}["']`),
    `${pathname} is missing visible initial publisher content`
  );
  assert.match(html, /<main\b[^>]*>/i, `${pathname} snapshot is missing a main landmark`);
  assert.match(html, /<h1\b[^>]*>[^<]+<\/h1>/i, `${pathname} snapshot is missing its H1`);
  assert.match(html, new RegExp(`<title>${escapeRegExp(escapeHtml(seo.title))}<\\/title>`));
  assert.match(
    html,
    new RegExp(`<link\\s+rel=["']canonical["']\\s+href=["']${escapeRegExp(seo.canonicalUrl)}["']\\s*\\/>`)
  );
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["']index, follow["']/i);
  assertEntryAssets(entry, "/assets/");
  assertEntryMarker(entry, "welcome-controller");
}

for (const entry of canonicalSetCatalog) {
  assert.equal(
    path.resolve(resolveEntry(entry.path, redirects, routesConfig)),
    path.resolve(snapshotEntry(entry.path)),
    `${entry.path} does not use its exact public snapshot entry`
  );
}

assertPublicSnapshot("/", desktopEntry);
for (const pathname of INDEXABLE_PUBLIC_PATHS.filter((candidate) => candidate !== "/")) {
  assertPublicSnapshot(pathname, snapshotEntry(pathname));
  assert.equal(
    read(trailingSlashSnapshotEntry(pathname)),
    read(snapshotEntry(pathname)),
    `${pathname}/ must preserve the canonical snapshot as a fallback`
  );
}
for (const entry of canonicalSetCatalog) {
  assertPublicSnapshot(entry.path, snapshotEntry(entry.path));
  assert.equal(
    read(trailingSlashSnapshotEntry(entry.path)),
    read(snapshotEntry(entry.path)),
    `${entry.path}/ must preserve the canonical snapshot as a fallback`
  );
}

const setsSnapshot = read(snapshotEntry("/sets"));
const crawlableSetHrefs = [...setsSnapshot.matchAll(/href=["'](\/set\/[^"'?]+)["']/g)].map((match) => match[1]);
assert.deepEqual(
  crawlableSetHrefs,
  canonicalSetCatalog.map((entry) => entry.path),
  "/sets must expose every canonical set as a normal href"
);
const pokemon151Snapshot = read(snapshotEntry("/set/pokemon-151"));
assert.match(pokemon151Snapshot, /About 151/);
assert.match(pokemon151Snapshot, /Featured Pokémon/);
assert.doesNotMatch(pokemon151Snapshot, /PackDex Simulation Notes|Rarities in (?:the )?PackDex|Premium pool|configured subset position|internal simulation rules|internal slot-selection logic/i);
assert.match(pokemon151Snapshot, /151 Card Catalog and Checklist/);
assert.match(pokemon151Snapshot, /207 supported cards/);
assert.match(pokemon151Snapshot, /data-packdex-static-json-ld/);
for (const utilityPath of ["collection", "profile", "settings", "login", "signup", "onboarding"]) {
  assert.ok(!fs.existsSync(path.join(dist, utilityPath, "index.html")), `Do not generate an indexable snapshot for /${utilityPath}`);
}

assert.equal(path.resolve(resolveEntry("/assets/definitely-missing-packdex-audit.js", redirects, routesConfig)), path.resolve(notFoundEntry));
assert.equal(path.resolve(resolveEntry("/mobile-app/assets/definitely-missing-packdex-audit.js", redirects, routesConfig)), path.resolve(notFoundEntry));
assert.doesNotMatch(read(notFoundEntry), /<meta\s+name=["']packdex-entry["']/i, "The 404 response must not be a PackDex SPA shell");

assertEntryAssets(desktopEntry, "/assets/");
assertEntryAssets(mobileEntry, "/mobile-app/assets/");
assertEntryAssets(path.join(dist, "mobile-app", "reset-password", "index.html"), "/mobile-app/assets/");
assertEntryAssets(path.join(dist, "mobile-app", "auth", "callback", "index.html"), "/mobile-app/assets/");
assertEntryMarker(desktopEntry, "welcome-controller");
assertEntryMarker(mobileEntry, "mobile-app");
assertEntryMarker(path.join(dist, "mobile-app", "reset-password", "index.html"), "mobile-app");
assertEntryMarker(path.join(dist, "mobile-app", "auth", "callback", "index.html"), "mobile-app");

for (const assetPath of getAssetPaths(read(mobileEntry))) {
  const assetFile = path.join(dist, assetPath.replace(/^\/+/, ""));
  assert.equal(
    path.resolve(resolveEntry(assetPath, redirects, routesConfig)),
    path.resolve(assetFile),
    `${assetPath} must bypass the mobile fallback Function`
  );
}
for (const staticPath of [
  "/mobile-app/card-back.webp",
  "/mobile-app/favicon.png",
  "/mobile-app/mobile-manifest.webmanifest",
  "/mobile-app/set-logos/151.png",
]) {
  assert.equal(
    path.resolve(resolveEntry(staticPath, redirects, routesConfig)),
    path.resolve(path.join(dist, staticPath.replace(/^\/+/, ""))),
    `${staticPath} must resolve to its exact deployed asset`
  );
}

for (const mobileChild of fs.readdirSync(path.join(dist, "mobile-app"), { withFileTypes: true })) {
  if (mobileChild.isFile()) {
    const assetPath = `/mobile-app/${mobileChild.name}`;
    assert.ok(
      !isFunctionRoute(assetPath, routesConfig),
      `${assetPath} must be excluded from the mobile fallback Function`
    );
  }
  if (mobileChild.isDirectory() && !["auth", "reset-password"].includes(mobileChild.name)) {
    const nestedProbe = `/mobile-app/${mobileChild.name}/__packdex_static_probe__`;
    assert.ok(
      !isFunctionRoute(nestedProbe, routesConfig),
      `/mobile-app/${mobileChild.name}/* must be excluded from the mobile fallback Function`
    );
  }
}

const expectedAds = read(publicAdsPath).trim();
assert.equal(expectedAds, "google.com, pub-4828542760410446, DIRECT, f08c47fec0942fa0");
assert.equal(read(builtAdsPath).trim(), expectedAds, "The production build must preserve public/ads.txt exactly");

const robots = read(builtRobotsPath);
assert.match(robots, /^User-agent:\s*\*$/m);
assert.match(robots, /^Allow:\s*\/$/m);
assert.match(robots, new RegExp(`^Sitemap:\\s*${PACKDEX_SITE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/sitemap\\.xml$`, "m"));

const sitemap = read(builtSitemapPath);
const sitemapLocations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expectedSitemapPaths = [
  ...INDEXABLE_PUBLIC_PATHS,
  ...canonicalSetCatalog.map((entry) => entry.path),
];
assert.equal(canonicalSetCatalog.length, 129, "The active public set catalog changed; review sitemap coverage intentionally");
assert.deepEqual(
  sitemapLocations,
  expectedSitemapPaths.map((pathname) => `${PACKDEX_SITE_ORIGIN}${pathname}`),
  "sitemap.xml must contain only canonical public URLs in deterministic order"
);
assert.doesNotMatch(
  sitemap,
  /\/(?:collection|profile|settings|login|signup|reset-password|auth\/callback|onboarding)(?:<|\/)/,
  "sitemap.xml includes a private or utility route"
);
assert.ok(!sitemapLocations.includes(`${PACKDEX_SITE_ORIGIN}/set/151`), "Sitemap must not include set-ID aliases");

for (const [pathname, expectedFile] of [
  ["/ads.txt", builtAdsPath],
  ["/robots.txt", builtRobotsPath],
  ["/sitemap.xml", builtSitemapPath],
  ["/favicon.png", path.join(dist, "favicon.png")],
]) {
  assert.equal(
    path.resolve(resolveEntry(pathname, redirects, routesConfig)),
    path.resolve(expectedFile),
    `${pathname} is being swallowed by an SPA rewrite`
  );
}

console.log(
  `Verified ${routeCases.length + canonicalSetCatalog.length} production routes, ${sitemapLocations.length} sitemap URLs, and all generated entry/static assets.`
);
