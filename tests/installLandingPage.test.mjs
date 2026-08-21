import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("install page keeps the App Store action dominant and the web action exact", async () => {
  const [page, main] = await Promise.all([
    read("../src/InstallPage.jsx"),
    read("../src/main.jsx"),
  ]);

  assert.match(page, /const APP_STORE_URL = "https:\/\/apps\.apple\.com\/us\/app\/packdex\/id6802345131"/);
  assert.match(page, /const WEB_URL = "https:\/\/www\.pack-dex\.com"/);
  assert.match(page, /Download on the/);
  assert.match(page, /App Store/);
  assert.match(page, /Now available/);
  assert.match(page, /<span>Your Pokémon TCG collection,<\/span>\s*<span>reimagined\.<\/span>/);
  assert.match(page, /<span>Pack<span>Dex<\/span><\/span>/);
  assert.match(page, /Available now on iPhone/);
  assert.match(page, /Continue on the Web/);
  assert.match(page, /function AppleMark/);
  assert.doesNotMatch(page, /The collector companion for iPhone/i);
  assert.doesNotMatch(page, /install-feature-list|Designed for collectors/);
  assert.match(page, /showFloatingCta/);
  assert.match(page, /IntersectionObserver/);
  assert.match(page, /Get PackDex on the App Store/);
  assert.match(page, /not affiliated with or endorsed by/);
  assert.ok(
    main.indexOf('normalizedPath === "/install"') < main.indexOf("if (isMobileAppEntry)"),
    "the install route must be resolved before the root mobile-app redirect"
  );
});

test("install presentation is mobile-first, responsive, accessible, and lightweight", async () => {
  const css = await read("../src/install.css");
  assert.match(css, /--install-preview-width: min\(88vw, 360px\)/);
  assert.match(css, /width: min\(100%, 232px\)/);
  assert.match(css, /install-hero h1 > span \{ display: block; white-space: nowrap; \}/);
  assert.match(css, /animation: install-conveyor-loop 42s linear infinite/);
  assert.match(css, /animation-play-state: paused/);
  assert.match(css, /position: fixed/);
  assert.match(css, /install-floating-cta/);
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /@media \(min-width: 720px\)/);
  assert.match(css, /@media \(max-width: 374px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(css, /install-feature-list|install-final-cta|install-ambient/);

  for (const name of ["explore.webp", "appearances.webp", "collection.webp", "eras.webp", "packs.webp", "binder.webp"]) {
    const info = await stat(new URL(`../public/install/${name}`, import.meta.url));
    assert.ok(info.size < 70_000, `${name} should remain below 70 KB`);
  }
});
