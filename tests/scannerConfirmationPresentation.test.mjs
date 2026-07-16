import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readScannerPresentationSources() {
  const [page, app, css] = await Promise.all([
    readFile(new URL("../mobile-app/src/MobileScannerPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8"),
  ]);

  return { page, app, css };
}

test("confirmed scanner result uses a constrained single-column mobile layout without horizontal overflow", async () => {
  const { css } = await readScannerPresentationSources();

  assert.match(css, /\.screen-scanner \{ overflow-x: hidden; overscroll-behavior-x: none; \}/);
  assert.match(css, /\.scanner-beta, \.scanner-beta \*, \.scanner-beta \*::before, \.scanner-beta \*::after \{ box-sizing: border-box; min-width: 0; \}/);
  assert.match(css, /\.scanner-beta-confirmed \{[^}]*width: calc\(100% - 24px\);[^}]*max-width: 430px;[^}]*overflow: hidden;[^}]*border: 0;/);
  assert.match(css, /\.scanner-beta-confirmed > img \{[^}]*width: min\(52vw, 196px\)/);
});

test("confirmed scanner result renders price and the compact action order", async () => {
  const { page } = await readScannerPresentationSources();

  assert.match(page, /className="scanner-beta-confirmed"/);
  assert.match(page, /Match selected by you/);
  assert.match(page, /Market Price/);
  assert.match(page, /formatUsd\(marketPrice\.marketPriceUsd\)/);
  assert.match(page, /Price unavailable/);
  assert.match(page, /View on TCGplayer/);
  assert.match(page, /Add to Collection/);
  assert.match(page, /Add to Wishlist/);
  assert.match(page, /Scan Another/);
});

test("scanner confirmation reuses the collection card-price lookup and TCGplayer URL", async () => {
  const { page, app } = await readScannerPresentationSources();

  assert.match(app, /async function loadScannerCardPrice\(card, set\)/);
  assert.match(app, /loadCardPricesForCards\(supabase, set, \[card\]\)/);
  assert.match(app, /getCardDisplayPrice\(card, priceMap, set\.id\)/);
  assert.match(app, /onLoadCardPrice=\{loadScannerCardPrice\}/);
  assert.match(page, /getTcgplayerCardUrl\(/);
  assert.match(page, /exactUrl: marketPrice\?\.tcgplayerUrl/);
});
