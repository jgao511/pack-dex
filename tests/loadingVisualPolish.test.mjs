import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop fallback reuses the existing Poké Ball asset after a CSS-only threshold", async () => {
  const [main, css] = await Promise.all([read("../src/main.jsx"), read("../src/base.css")]);

  assert.match(main, /getPokeballLoadingUrl/);
  assert.match(main, /className="loading-pokeball"/);
  assert.match(main, /className="loading-overlay startup-loading-overlay"/);
  assert.match(css, /startup-loader-reveal 0s linear 120ms forwards/);
  assert.match(css, /animation: pokeballSpin 0\.9s linear infinite/);
  assert.doesNotMatch(main, /setTimeout\([^)]*(?:100|120|150)/);
});

test("real desktop catalog and Pack Ready facades still bypass the fallback", async () => {
  const main = await read("../src/main.jsx");
  const initialRender = main.slice(main.indexOf("function renderInitialProductContent"), main.indexOf("if (isPublicLanding)"));

  assert.match(initialRender, /if \(hasSnapshot && !replace\) return/);
  assert.ok(initialRender.indexOf("<ProductCatalogFacade") < initialRender.indexOf("<DelayedDesktopLoadingFallback"));
  assert.ok(initialRender.indexOf("<ProductSetFacade") < initialRender.indexOf("<DelayedDesktopLoadingFallback"));
});

test("mobile startup uses the previous PackDex logo treatment without a minimum duration", async () => {
  const [html, bootstrap, loader, css, main] = await Promise.all([
    read("../mobile-app/index.html"),
    read("../mobile-app/src/MobileBootstrap.jsx"),
    read("../mobile-app/src/components/PackDexStartupAnimation.jsx"),
    read("../mobile-app/src/App.css"),
    read("../mobile-app/src/main.jsx"),
  ]);

  for (const source of [html, loader]) {
    assert.match(source, /packdex-startup__ambient/);
    assert.match(source, /packdex-startup__cards/);
    assert.match(source, /packdex-startup__wordmark/);
    assert.match(source, /Preparing your collection/);
  }
  assert.match(css, /packdex-startup-delay 0s linear 120ms forwards/);
  assert.match(bootstrap, /import PackDexStartupAnimation/);
  assert.doesNotMatch(bootstrap, /packdex-boot-block|packdex-boot-nav|mobile-content-skeleton/);
  assert.doesNotMatch(main, /setTimeout\([^)]*(?:100|120|150)/);
});

test("startup import failures replace loaders with retryable error states", async () => {
  const [desktopMain, mobileMain] = await Promise.all([read("../src/main.jsx"), read("../mobile-app/src/main.jsx")]);

  assert.match(desktopMain, /\.catch\(renderDesktopStartupError\)/);
  assert.match(desktopMain, /Reload PackDex/);
  assert.match(mobileMain, /renderRoute\(root\)\.catch/);
  assert.match(mobileMain, /renderStrict\(root, <MobileStartupError \/>\)/);
  assert.match(mobileMain, /Reload PackDex/);
});
