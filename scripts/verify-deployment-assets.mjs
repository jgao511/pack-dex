import assert from "node:assert/strict";

const baseUrl = process.argv.find((value) => value.startsWith("--base-url="))?.slice(11);
assert.ok(baseUrl, "Usage: node scripts/verify-deployment-assets.mjs --base-url=https://deployment.example");
const origin = new URL(baseUrl).origin;

async function fetchChecked(url, expectedKind) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "PackDex production asset verification/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `${url} returned HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const body = await response.text();
  assert.doesNotMatch(body.trimStart(), /^<!doctype html/i, `${url} returned HTML instead of ${expectedKind}`);
  if (expectedKind === "JavaScript") assert.match(contentType, /javascript|ecmascript/, `${url} has MIME ${contentType}`);
  if (expectedKind === "CSS") assert.match(contentType, /text\/css/, `${url} has MIME ${contentType}`);
  return { body, contentType, bytes: Buffer.byteLength(body), cacheControl: response.headers.get("cache-control") };
}

async function inspectEntry(pathname, assetPrefix) {
  const entryUrl = new URL(pathname, origin).href;
  const response = await fetch(entryUrl, { headers: { "User-Agent": "PackDex production asset verification/1.0" }, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${entryUrl} returned HTTP ${response.status}`);
  const html = await response.text();
  assert.match(html, /<meta\s+name=["']packdex-entry["']/i, `${entryUrl} is not a PackDex entry`);
  const initialAssets = [...html.matchAll(/(?:src|href)=["']([^"'?#]+\.(?:js|css))["']/giu)]
    .map((match) => new URL(match[1], entryUrl))
    .filter((url) => url.origin === origin && url.pathname.startsWith(assetPrefix));
  const queue = [...initialAssets.filter((url) => url.pathname.endsWith(".js"))];
  const visited = new Set();
  const assets = [];
  for (const stylesheet of initialAssets.filter((url) => url.pathname.endsWith(".css"))) {
    const result = await fetchChecked(stylesheet.href, "CSS");
    assets.push({ url: stylesheet.href, kind: "CSS", ...result, body: undefined });
  }
  while (queue.length > 0) {
    const url = queue.shift();
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    const result = await fetchChecked(url.href, "JavaScript");
    assets.push({ url: url.href, kind: "JavaScript", ...result, body: undefined });
    const imports = [
      ...result.body.matchAll(/import\(\s*["'`]([^"'`]+\.js)["'`]\s*\)/gu),
      ...result.body.matchAll(/(?:from\s*|import\s*)["'`]([^"'`]+\.js)["'`]/gu),
    ];
    for (const match of imports) {
      const imported = new URL(match[1], url);
      if (imported.origin === origin && imported.pathname.startsWith(assetPrefix) && !visited.has(imported.href)) queue.push(imported);
    }
  }
  return { entryUrl, assets };
}

const desktop = await inspectEntry("/?desktop=1", "/assets/");
const mobile = await inspectEntry("/mobile-app/", "/mobile-app/assets/");
const missingUrl = new URL(`/assets/definitely-missing-packdex-audit-${Date.now()}.js`, origin);
const missing = await fetch(missingUrl, { redirect: "manual", headers: { "User-Agent": "PackDex production asset verification/1.0" }, signal: AbortSignal.timeout(30_000) });
const missingBody = await missing.text();
assert.equal(missing.status, 404, `${missingUrl.href} must return 404, not an SPA fallback`);
assert.doesNotMatch(missingBody, /<meta\s+name=["']packdex-entry["']/i, `${missingUrl.href} returned the PackDex SPA shell`);
assert.doesNotMatch(String(missing.headers.get("cache-control") || ""), /immutable/i, `${missingUrl.href} returned an immutable missing-asset response`);

const report = {
  verifiedAt: new Date().toISOString(),
  origin,
  desktopAssets: desktop.assets,
  mobileAssets: mobile.assets,
  negativeMissingAsset: {
    url: missingUrl.href,
    status: missing.status,
    contentType: missing.headers.get("content-type"),
    cacheControl: missing.headers.get("cache-control"),
    isSpaShell: /<meta\s+name=["']packdex-entry["']/i.test(missingBody),
  },
};
console.log(JSON.stringify(report, null, 2));
