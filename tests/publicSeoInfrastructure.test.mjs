import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  INDEXABLE_PUBLIC_PATHS,
  PACKDEX_SITE_ORIGIN,
  PUBLIC_ROUTE_PATHS,
  UTILITY_ROUTE_PATHS,
  getCanonicalUrl,
  isIndexablePublicPath,
  parseSiteRoute,
} from "../src/lib/publicRoutes.js";
import {
  canonicalSetCatalog,
  getCanonicalSetPath,
  getSetBySlug,
  getSetSlug,
  resolvePublicSetRoute,
} from "../src/lib/publicSetRoutes.js";
import {
  getSitemapPaths,
  renderSitemapXml,
} from "../scripts/generate-sitemap.mjs";
import {
  getEmptyRootTemplate,
  generatePublicSnapshots,
  renderFaqSnapshot,
  renderHowItWorksSnapshot,
  renderSetSnapshot,
  renderSetsSnapshot,
  renderSnapshotHtml,
  renderUtilityEntryHtml,
  renderWelcomeSnapshot,
} from "../scripts/generate-public-snapshots.mjs";
import { getPublicSeoDescriptor } from "../src/lib/publicSeo.js";
import {
  EDITORIAL_PUBLIC_PATHS,
  parseStaticSiteRoute,
} from "../src/lib/staticPublicRoutes.js";
import { getStaticPublicSeoDescriptor } from "../src/lib/staticPublicSeo.js";
import { onRequest as onMobileFallbackRequest } from "../functions/mobile-app/[[path]].js";
import { onRequest as onMobileShareRequest } from "../functions/mobile-app/share/[[path]].js";
import { getSetPublicContent } from "../src/lib/setContent.js";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("every active set has one unique, deterministic canonical public route", () => {
  assert.equal(canonicalSetCatalog.length, 129);
  assert.equal(new Set(canonicalSetCatalog.map((entry) => entry.setId)).size, 129);
  assert.equal(new Set(canonicalSetCatalog.map((entry) => entry.slug)).size, 129);
  assert.equal(new Set(canonicalSetCatalog.map((entry) => entry.path)).size, 129);
  const routeFingerprint = createHash("sha256")
    .update(canonicalSetCatalog.map(({ setId, slug }) => `${setId}:${slug}`).join("\n"))
    .digest("hex");
  assert.equal(
    routeFingerprint,
    "4f65c80a588928f0b795fe74579e12c253d61fb17e0448b0b727b6c2c975ae52",
    "A canonical set URL changed. Preserve the previous slug as an alias before intentionally updating this fingerprint."
  );

  for (const entry of canonicalSetCatalog) {
    assert.equal(entry.path, `/set/${entry.slug}`);
    assert.equal(getSetSlug(entry.set), entry.slug);
    assert.equal(getSetSlug(entry.setId), entry.slug);
    assert.equal(getCanonicalSetPath(entry.setId), entry.path);
    assert.equal(getSetBySlug(entry.slug), entry.set);
    const descriptor = getPublicSeoDescriptor(entry.path);
    assert.match(
      descriptor.description,
      new RegExp(`\\b${getSetPublicContent(entry.set).supportedCardCount} supported cards\\b`),
      `${entry.path} SEO count must match the live public set content`
    );
    assert.ok(descriptor.description.length <= 165, `${entry.path} has an overly long meta description`);
    assert.match(descriptor.description, /discover set highlights/);
    assert.doesNotMatch(descriptor.description, /simulation notes/i);
  }

  assert.equal(getSetSlug("151"), "pokemon-151");
  assert.equal(getCanonicalSetPath("151"), "/set/pokemon-151");
  assert.equal(getSetSlug("champions-path"), "champions-path");
  assert.equal(getSetSlug("xy12"), "xy-evolutions");
  assert.equal(getSetSlug("diamond-pearl"), "diamond-and-pearl");
  assert.equal(getSetSlug("retired-or-unknown"), null);
});

test("set routes distinguish canonical URLs, legacy ID aliases, and invalid slugs", () => {
  const canonical = resolvePublicSetRoute("/set/pokemon-151");
  assert.equal(canonical.status, "canonical");
  assert.equal(canonical.set.id, "151");
  assert.equal(canonical.isCanonical, true);
  assert.equal(canonical.canonicalPath, "/set/pokemon-151");

  const alias = resolvePublicSetRoute("/set/151");
  assert.equal(alias.status, "alias");
  assert.equal(alias.set.id, "151");
  assert.equal(alias.isAlias, true);
  assert.equal(alias.canonicalPath, "/set/pokemon-151");

  const idAlias = resolvePublicSetRoute("/set/xy12");
  assert.equal(idAlias.status, "alias");
  assert.equal(idAlias.set.id, "xy12");
  assert.equal(idAlias.canonicalPath, "/set/xy-evolutions");

  assert.equal(resolvePublicSetRoute("/sets"), null);
  assert.equal(resolvePublicSetRoute("/set/not-a-packdex-set").status, "invalid");
  assert.equal(resolvePublicSetRoute("/set/%E0%A4%A").status, "invalid");
});

test("the shared route parser indexes only substantive public routes", () => {
  assert.deepEqual(INDEXABLE_PUBLIC_PATHS, [
    "/",
    "/welcome",
    "/sets",
    "/how-it-works",
    "/faq",
    "/about",
    "/privacy",
    "/terms",
  ]);

  for (const pathname of INDEXABLE_PUBLIC_PATHS) {
    const route = parseSiteRoute(pathname);
    assert.equal(route.kind, "public");
    assert.equal(route.indexable, true);
    assert.equal(route.canonicalPath, pathname);
    assert.equal(isIndexablePublicPath(pathname), true);
  }

  const publicSet = parseSiteRoute("/set/pokemon-151");
  assert.equal(publicSet.kind, "set");
  assert.equal(publicSet.indexable, true);
  assert.equal(publicSet.set.id, "151");
  assert.equal(
    getPublicSeoDescriptor("/set/pokemon-151").openGraph.image,
    "https://www.pack-dex.com/set-logos/151.png"
  );

  const setAlias = parseSiteRoute("/set/151");
  assert.equal(setAlias.kind, "set");
  assert.equal(setAlias.isAlias, true);
  assert.equal(setAlias.canonicalPath, "/set/pokemon-151");

  for (const pathname of Object.values(UTILITY_ROUTE_PATHS)) {
    const route = parseSiteRoute(pathname);
    assert.equal(route.kind, "utility");
    assert.equal(route.indexable, false);
    assert.equal(route.canonicalPath, null);
  }

  assert.equal(parseSiteRoute("/mobile-app/explore").indexable, false);
  assert.equal(parseSiteRoute("/set/not-real").kind, "not-found");
  assert.equal(parseSiteRoute("/not-real").indexable, false);
  assert.equal(getCanonicalUrl(PUBLIC_ROUTE_PATHS.faq), `${PACKDEX_SITE_ORIGIN}/faq`);

  for (const pathname of EDITORIAL_PUBLIC_PATHS) {
    assert.equal(parseStaticSiteRoute(pathname).kind, "public");
    assert.deepEqual(
      getStaticPublicSeoDescriptor(pathname),
      getPublicSeoDescriptor(pathname),
      `${pathname} lightweight metadata must match the catalog-backed descriptor`
    );
  }
  assert.equal(parseStaticSiteRoute("/set/pokemon-151").kind, "unmatched");
});

test("the generated sitemap contains every canonical set and no utility routes", async () => {
  const sitemapPaths = getSitemapPaths();
  assert.equal(sitemapPaths.length, 137);
  assert.equal(new Set(sitemapPaths).size, 137);

  for (const entry of canonicalSetCatalog) assert.ok(sitemapPaths.includes(entry.path));
  for (const pathname of Object.values(UTILITY_ROUTE_PATHS)) assert.ok(!sitemapPaths.includes(pathname));
  assert.ok(!sitemapPaths.includes("/set/151"));
  assert.ok(!sitemapPaths.some((pathname) => pathname.startsWith("/mobile-app")));

  const expectedXml = renderSitemapXml();
  assert.equal((await read("../public/sitemap.xml")).replace(/\r\n/g, "\n"), expectedXml);
  assert.equal([...expectedXml.matchAll(/<loc>/g)].length, 137);
  assert.match(expectedXml, /<loc>https:\/\/www\.pack-dex\.com\/set\/pokemon-151<\/loc>/);
  assert.doesNotMatch(expectedXml, /\/(?:collection|profile|settings|login|signup|reset-password|auth\/callback|onboarding)<\/loc>/);
});

test("crawler files and Cloudflare fallback configuration preserve real static assets", async () => {
  const [robots, ads, redirects, headers, routesJson, packageJson, routeVerifier, mobileCopy, mobileFallback] = await Promise.all([
    read("../public/robots.txt"),
    read("../public/ads.txt"),
    read("../public/_redirects"),
    read("../public/_headers"),
    read("../public/_routes.json"),
    read("../package.json"),
    read("../scripts/verify-production-routes.mjs"),
    read("../scripts/copy-mobile-build.mjs"),
    read("../functions/mobile-app/[[path]].js"),
  ]);

  assert.match(robots, /^User-agent:\s*\*$/m);
  assert.match(robots, /^Allow:\s*\/$/m);
  assert.match(robots, /^Sitemap:\s*https:\/\/www\.pack-dex\.com\/sitemap\.xml$/m);
  assert.equal(ads.trim(), "google.com, pub-4828542760410446, DIRECT, f08c47fec0942fa0");
  const redirectRules = redirects.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(redirectRules, []);
  const routesConfig = JSON.parse(routesJson);
  assert.deepEqual(routesConfig.include, ["/mobile-app", "/mobile-app/*"]);
  for (const exclusion of [
    "/mobile-app/assets/*",
    "/mobile-app/generated/*",
    "/mobile-app/scanner-ai/*",
    "/mobile-app/set-logos/*",
    "/mobile-app/index.html",
    "/mobile-app/404.html",
    "/mobile-app/reset-password",
    "/mobile-app/auth/callback",
  ]) {
    assert.ok(routesConfig.exclude.includes(exclusion), `${exclusion} must bypass the Pages Function`);
  }
  for (const utilityRoute of ["collection", "profile", "settings", "login", "signup", "reset-password", "auth/callback", "onboarding", "mobile-app"]) {
    assert.match(headers, new RegExp(`^/${utilityRoute.replace("/", "\\/")}\\s*\\r?\\n\\s*X-Robots-Tag: noindex, follow$`, "m"));
    assert.match(headers, new RegExp(`^/${utilityRoute.replace("/", "\\/")}/\\*\\s*\\r?\\n\\s*X-Robots-Tag: noindex, follow$`, "m"));
  }
  assert.match(packageJson, /"build":\s*"npm run generate:set-catalog && npm run generate:sitemap && vite build/);
  assert.match(packageJson, /vite build && npm run generate:public-snapshots/);
  assert.match(routeVerifier, /\/set\/pokemon-151/);
  assert.match(routeVerifier, /\/ads\.txt/);
  assert.match(routeVerifier, /\/robots\.txt/);
  assert.match(routeVerifier, /\/sitemap\.xml/);
  assert.match(mobileCopy, /path\.join\(targetDist, "ads\.txt"\)/);
  assert.match(mobileCopy, /path\.join\(targetDist, "robots\.txt"\)/);
  assert.match(mobileCopy, /path\.join\(targetDist, "sitemap\.xml"\)/);
  assert.match(mobileCopy, /path\.join\(targetDist, "_routes\.json"\)/);
  assert.match(mobileFallback, /entryUrl\.pathname = "\/mobile-app\/"/);
  assert.match(mobileFallback, /X-Robots-Tag/);
});

test("the scoped mobile Pages Function serves deep links without rewriting static assets", async () => {
  const fetchedRequests = [];
  const assets = {
    async fetch(request) {
      fetchedRequests.push(request);
      return new Response("mobile entry", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };

  const response = await onMobileFallbackRequest({
    request: new Request("https://www.pack-dex.com/mobile-app/explore/sets/base-set?from=share"),
    env: { ASSETS: assets },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "mobile entry");
  assert.equal(new URL(fetchedRequests[0].url).pathname, "/mobile-app/");
  assert.equal(new URL(fetchedRequests[0].url).search, "");
  assert.equal(response.headers.get("X-PackDex-Entry"), "mobile-app-fallback");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, follow");

  const headResponse = await onMobileFallbackRequest({
    request: new Request("https://www.pack-dex.com/mobile-app/explore", { method: "HEAD" }),
    env: { ASSETS: assets },
  });
  assert.equal(await headResponse.text(), "");
  assert.equal(fetchedRequests[1].method, "HEAD");

  const deniedResponse = await onMobileFallbackRequest({
    request: new Request("https://www.pack-dex.com/mobile-app/explore", { method: "POST" }),
    env: { ASSETS: assets },
  });
  assert.equal(deniedResponse.status, 405);
  assert.equal(deniedResponse.headers.get("Allow"), "GET, HEAD");
  assert.equal(fetchedRequests.length, 2);

  const shareResponse = await onMobileShareRequest({
    request: new Request("https://www.pack-dex.com/mobile-app/share/VALID_SHARE_CODE"),
    env: { ASSETS: assets },
  });
  assert.equal(shareResponse.status, 200);
  assert.equal(shareResponse.headers.get("X-PackDex-Entry"), "mobile-share");
  assert.equal(shareResponse.headers.get("X-Robots-Tag"), "noindex, follow");
  assert.equal(new URL(fetchedRequests[2].url).pathname, "/mobile-app/");
});

test("public crawl snapshots expose substantive visible content and normal set links", () => {
  const welcome = renderWelcomeSnapshot("/welcome");
  assert.match(welcome, /<h1>Open Pokémon TCG Packs\. Build Your PackDex\.<\/h1>/);
  assert.match(welcome, /What is PackDex\?/);
  assert.match(welcome, /How PackDex Works/);
  assert.match(welcome, /href="\/sets"/);
  assert.doesNotMatch(welcome, /display\s*:\s*none/i);

  const sets = renderSetsSnapshot();
  const setLinks = [...sets.matchAll(/href="(\/set\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(setLinks, canonicalSetCatalog.map((entry) => entry.path));
  assert.match(sets, /<h1>Choose a Pokémon TCG Set<\/h1>/);
  assert.match(sets, /<p class="public-snapshot__eyebrow">Open a Pack<\/p>/);
  assert.doesNotMatch(sets, /Explore Every English Pokémon TCG Set/);
  assert.match(sets, /Scarlet &amp; Violet/);
  const setsHeader = sets.slice(0, sets.indexOf("<main"));
  assert.match(setsHeader, /class="public-snapshot__product-header"/);
  assert.match(setsHeader, /class="public-snapshot__wordmark"><span>Pack<\/span><span>Dex<\/span>/);
  assert.match(setsHeader, /class="public-snapshot__product-tabs"/);
  assert.match(setsHeader, /aria-current="page">Open a Pack<\/a>/);
  assert.doesNotMatch(setsHeader, /public-snapshot__header/);
  assert.doesNotMatch(setsHeader, /How It Works|FAQ|About/);

  const pokemon151 = canonicalSetCatalog.find((entry) => entry.setId === "151");
  const setSnapshot = renderSetSnapshot(pokemon151);
  const setHeader = setSnapshot.slice(0, setSnapshot.indexOf("<main"));
  assert.match(setHeader, /public-snapshot__product-header--pack-flow/);
  assert.match(setHeader, /class="public-snapshot__wordmark"><span>Pack<\/span><span>Dex<\/span>/);
  assert.doesNotMatch(setHeader, /public-snapshot__product-tabs|How It Works|FAQ|About/);
  assert.match(setSnapshot, /<main id="main-content" class="public-snapshot__main">\s*<section class="public-snapshot__pack-ready"/);
  assert.doesNotMatch(setSnapshot, /public-snapshot__breadcrumbs|aria-label="Breadcrumb"/);
  assert.match(setSnapshot, /<span>Pack Ready<\/span>/);
  assert.match(setSnapshot, /<h1 id="pack-ready-title">151<\/h1>/);
  assert.match(setSnapshot, />Open Pack<\/a>/);
  assert.doesNotMatch(setSnapshot, /Set Overview/);
  assert.match(setSnapshot, /207 supported cards/);
  assert.match(setSnapshot, /Featured Pokémon/);
  assert.match(setSnapshot, /Set highlight/);
  assert.match(setSnapshot, /Special PackDex feature: 151 supports a rare Demi-God Pack virtual opening/);
  assert.match(setSnapshot, /151 Collection/);
  assert.match(setSnapshot, /151 Card Catalog and Checklist/);
  assert.match(setSnapshot, /Pikachu/);
  assert.doesNotMatch(setSnapshot, /PackDex Simulation Notes|Rarities in (?:the )?PackDex|Premium pool|configured subset position|internal simulation rules|internal slot-selection logic/i);
  assert.doesNotMatch(setSnapshot, /Ã|Â|�/);
  assert.ok(setSnapshot.indexOf("Pack Ready") < setSnapshot.indexOf("About 151"));
  assert.ok(setSnapshot.indexOf("About 151") < setSnapshot.indexOf("151 Collection"));
  assert.ok(setSnapshot.indexOf("151 Collection") < setSnapshot.indexOf("151 Card Catalog and Checklist"));

  const sunMoon = canonicalSetCatalog.find((entry) => entry.setId === "sun-moon");
  const sunMoonContent = getSetPublicContent(sunMoon.set);
  const sunMoonSnapshot = renderSetSnapshot(sunMoon);
  assert.equal(sunMoonContent.supportedCardCount, 164);
  assert.match(sunMoonSnapshot, /164 supported cards/);
  assert.doesNotMatch(sunMoonSnapshot, /173 supported cards/);
  assert.equal([...sunMoonSnapshot.matchAll(/public-snapshot__card-number/g)].length, 164);

  const faq = renderFaqSnapshot();
  assert.equal([...faq.matchAll(/<article>/g)].length, 9);
  assert.match(faq, /Is PackDex free to play\?/);

  const howItWorks = renderHowItWorksSnapshot();
  assert.match(howItWorks, /collector-focused set highlights/);
  assert.doesNotMatch(howItWorks, /simulation notes/i);
});

test("snapshot HTML keeps built scripts while replacing head metadata and initial root content", () => {
  const template = `<!doctype html><html lang="en"><head>
    <meta name="packdex-entry" content="welcome-controller" />
    <meta name="description" content="old" />
    <link rel="canonical" href="https://www.pack-dex.com/" />
    <meta property="og:title" content="old" />
    <title>old</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`;
  const body = renderFaqSnapshot();
  const html = renderSnapshotHtml(template, "/faq", body);
  const seo = getPublicSeoDescriptor("/faq");

  assert.match(html, new RegExp(`<title>${seo.title}<\\/title>`));
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.pack-dex\.com\/faq" \/>/);
  assert.match(html, /<meta name="robots" content="index, follow" \/>/);
  assert.match(html, /data-packdex-static-snapshot="\/faq"/);
  assert.match(html, /src="\/assets\/app\.js"/);
  assert.match(html, /href="\/assets\/app\.css"/);
  assert.match(html, /--pd-accent:#7c4dff/);
  assert.doesNotMatch(html, /#f1d36b/i);
  assert.equal([...html.matchAll(/id="root"/g)].length, 1);

  const regenerated = renderSnapshotHtml(getEmptyRootTemplate(html), "/faq", body);
  assert.equal([...regenerated.matchAll(/data-packdex-static-snapshot-style/g)].length, 1);
  assert.equal([...regenerated.matchAll(/id="root"/g)].length, 1);

  const utilityHtml = renderUtilityEntryHtml(template, "/collection");
  assert.match(utilityHtml, /<meta name="robots" content="noindex, follow" \/>/);
  assert.match(utilityHtml, /<div id="root"><\/div>/);
  assert.match(utilityHtml, /src="\/assets\/app\.js"/);
  assert.doesNotMatch(utilityHtml, /rel="canonical"/);
  assert.doesNotMatch(utilityHtml, /data-packdex-static-snapshot/);
});

test("snapshot generation gives canonical no-slash URLs exact Cloudflare HTML entries", async () => {
  const tempDist = await mkdtemp(path.join(os.tmpdir(), "packdex-public-snapshots-"));
  const template = `<!doctype html><html lang="en"><head>
    <meta name="packdex-entry" content="welcome-controller" />
    <title>PackDex</title><link rel="stylesheet" href="/assets/app.css" />
  </head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`;

  try {
    await writeFile(path.join(tempDist, "index.html"), template, "utf8");
    const result = await generatePublicSnapshots({ dist: tempDist });
    assert.equal(result.snapshotCount, 137);
    assert.equal(result.setSnapshotCount, 129);
    assert.equal(result.utilityEntryCount, 8);

    for (const routePath of ["faq", "sets", "set/pokemon-151"]) {
      const canonicalEntry = await readFile(path.join(tempDist, `${routePath}.html`), "utf8");
      const trailingSlashEntry = await readFile(path.join(tempDist, routePath, "index.html"), "utf8");
      assert.equal(trailingSlashEntry, canonicalEntry);
    }

    for (const pathname of Object.values(UTILITY_ROUTE_PATHS)) {
      const routePath = pathname.replace(/^\/+|\/+$/g, "");
      const utilityEntry = await readFile(path.join(tempDist, `${routePath}.html`), "utf8");
      assert.match(utilityEntry, /<meta name="robots" content="noindex, follow" \/>/);
      assert.match(utilityEntry, /<div id="root"><\/div>/);
      assert.doesNotMatch(utilityEntry, /rel="canonical"/);
      assert.doesNotMatch(utilityEntry, /data-packdex-static-snapshot/);
    }
  } finally {
    await rm(tempDist, { recursive: true, force: true });
  }
});
