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
  assert.match(page, /const DESKTOP_APP_PATH = "\/sets"/);
  assert.match(page, /function EntryButton[\s\S]*?const href = mobile \? APP_PATH : DESKTOP_APP_PATH/);
  assert.match(page, /isMobileVisitor \? "Open PackDex for Desktop" : "Open the Mobile App"/);
  assert.match(page, /href=\{isMobileVisitor \? APP_PATH : DESKTOP_APP_PATH\}/);
  assert.match(page, /!mobile && \([\s\S]*?<a href=\{DESKTOP_APP_PATH\}[\s\S]*?<a href=\{APP_PATH\}/);
  assert.match(page, /Crown Zenith/);
  assert.match(page, /Prismatic Evolutions/);
  assert.match(page, /Mega Evolution—Pitch Black/);
  assert.match(page, /Collection totals and set progress/);
  assert.match(page, /badge: "New"/);
  assert.match(page, /badge: "Popular"/);
  assert.match(page, /badge: "Fan favorite"/);
  assert.match(app, /PackDex is fully playable on desktop/);
  assert.match(app, /href="\/sets"/);
  assert.match(app, /href="\/about"/);
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

test("welcome page exposes substantive public content and crawlable public routes", async () => {
  const page = await read("../src/LandingPage.jsx");

  const orderedSections = [
    'className="landing-hero"',
    'id="experience"',
    'id="what-is-packdex"',
    'id="collection"',
    'id="how-it-works"',
    'id="explore"',
    'id="faq-preview"',
    'className="landing-cta"',
  ];
  let previousIndex = -1;
  for (const section of orderedSections) {
    const sectionIndex = page.indexOf(section);
    assert.ok(sectionIndex > previousIndex, `${section} should appear in the requested landing-page order`);
    previousIndex = sectionIndex;
  }

  assert.match(page, /What is PackDex\?/);
  assert.match(page, /How PackDex Works/);
  assert.match(page, /Choose a Set/);
  assert.match(page, /Open a Virtual Pack/);
  assert.match(page, /Build Your Collection/);
  assert.match(page, /Find Your Next Chase/);
  assert.match(page, /Explore the Pok\u00e9mon TCG Across Eras/);
  assert.match(page, /Is PackDex free to play\?/);
  assert.match(page, /View All FAQs/);

  for (const href of ["/sets", "/how-it-works", "/faq", "/about"]) {
    assert.match(page, new RegExp(`href="${href}"`));
  }
  assert.match(page, /id: "pitch-black"/);
  assert.match(page, /id: "151"/);
  assert.match(page, /id: "prismatic-evolutions"/);
  assert.match(page, /href: "\/set\/pitch-black"/);
  assert.match(page, /href: "\/set\/pokemon-151"/);
  assert.match(page, /href: "\/set\/prismatic-evolutions"/);
  assert.doesNotMatch(page, /className="landing-set-card" href=\{isMobileVisitor/);
  assert.match(page, /<AdSlot[\s\S]*placement=\{AD_PLACEMENTS\.CONTENT\}/);
  assert.match(page, /contentReady: true, screen: "welcome-content"/);
  assert.match(page, /isNative=\{isNativeCapacitorRuntime\(\)\}/);
  assert.equal((page.match(/<AdSlot\b/g) || []).length, 1);
});
