import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("welcome copy, curated groups, and app destinations match the product brief", async () => {
  const [page, app, mobileApp] = await Promise.all([
    read("../src/LandingPage.jsx"),
    read("../src/App.jsx"),
    read("../mobile-app/src/App.jsx"),
  ]);

  assert.match(page, /Open\. Collect\. Discover\./);
  assert.match(page, /Open virtual Pokémon TCG packs from every English set/);
  assert.match(page, /100% free/i);
  assert.match(page, /Play PackDex on Desktop/);
  assert.match(page, /Open the Mobile App/);
  assert.match(page, /Crown Zenith/);
  assert.match(page, /Prismatic Evolutions/);
  assert.match(page, /Mega Evolution—Pitch Black/);
  assert.match(page, /Collection totals and set progress/);
  assert.match(page, /badge: "New"/);
  assert.match(page, /badge: "Popular"/);
  assert.match(page, /badge: "Fan favorite"/);
  assert.match(app, /PackDex is fully playable on desktop/);
  assert.match(app, /href="\/welcome"/);
  assert.doesNotMatch(mobileApp, /packdex_welcome_seen_v1|packdex_desktop_mobile_notice_dismissed_v1/);
});

test("welcome styling has responsive, paused, and reduced-motion states without gradients", async () => {
  const [css, index] = await Promise.all([read("../src/landing.css"), read("../index.html")]);

  assert.match(css, /@media \(max-width: 1020px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-play-state: paused/);
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient/i);
  assert.match(index, /<link rel="canonical" href="https:\/\/www\.pack-dex\.com\/" \/>/);
  assert.match(index, /property="og:image" content="https:\/\/www\.pack-dex\.com\/packdex-icon-192\.png"/);
  assert.match(index, /name="twitter:card" content="summary"/);
  assert.doesNotMatch(index, /summary_large_image/);
});

test("welcome page renders the cached public activity counter without blocking the hero", async () => {
  const [page, stats, css] = await Promise.all([
    read("../src/LandingPage.jsx"),
    read("../src/lib/publicPackDexStats.js"),
    read("../src/landing.css"),
  ]);

  assert.match(page, /cards pulled on PackDex/);
  assert.match(page, /across \{formatPublicStat\(stats\.packsOpened\)\} packs/);
  assert.match(page, /IntersectionObserver/);
  assert.match(page, /reducedMotion/);
  assert.match(stats, /PUBLIC_STATS_CACHE_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(stats, /\.rpc\("get_public_packdex_stats"\)/);
  assert.doesNotMatch(stats, /\.from\("user_/);
  assert.match(css, /\.landing-activity__skeleton/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
});
