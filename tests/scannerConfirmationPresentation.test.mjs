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

  assert.match(css, /\.screen-scanner \{ width: 100%; max-width: 100%; overflow-x: hidden; overscroll-behavior-x: none; \}/);
  assert.match(css, /\.scanner-beta, \.scanner-beta \*, \.scanner-beta \*::before, \.scanner-beta \*::after \{ box-sizing: border-box; min-width: 0; \}/);
  assert.match(css, /\.scanner-beta-confirmed \{[^}]*width: 100%;[^}]*max-width: 430px;[^}]*margin: 0 auto 16px;[^}]*border: 0;/);
  assert.doesNotMatch(css, /\.scanner-beta-confirmed \{[^}]*overflow: hidden/);
  assert.match(css, /\.scanner-beta-confirmed > img \{[^}]*width: min\(48vw, 182px\)/);
  assert.match(css, /\.screen-content \{[^}]*calc\(var\(--bottom-nav-height\)/s);
});

test("confirmed scanner result renders a stable combined price panel and compact action order", async () => {
  const { page, css } = await readScannerPresentationSources();

  assert.match(page, /className="scanner-beta-confirmed"/);
  assert.match(page, /Market Price/);
  assert.match(page, /formatUsd\(marketPrice\.marketPriceUsd\)/);
  assert.match(page, /View on TCGplayer/);
  assert.match(page, /Add to Collection/);
  assert.match(page, /Add to Wishlist/);
  assert.match(page, /Scan Another/);
  assert.match(page, /data-card-id=\{confirmed\.cardId\}/);
  assert.match(page, /data-price-state=\{priceState\}/);
  assert.match(page, /showPricePanel && <section className=/);
  assert.match(page, /showPricePanel = isPriceLoading \|\| hasMarketPrice \|\| Boolean\(tcgplayerCardUrl\)/);
  assert.match(page, /\(hasMarketPrice \|\| isPriceLoading\) && <>/);
  assert.match(page, /\{tcgplayerCardUrl && <a className="scanner-beta-tcgplayer-link"/);
  assert.match(page, /scanner-beta-price-spinner/);
  assert.match(page, /Loading price/);
  assert.match(css, /\.scanner-beta-price \{[^}]*min-height: 94px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.scanner-beta-price-spinner \{ animation: none; \} \}/);
  assert.doesNotMatch(page, /Match selected by you/);
  assert.doesNotMatch(page, /Price unavailable/);
});

test("pricing failure cannot suppress scanner metadata, links, or actions", async () => {
  const { page } = await readScannerPresentationSources();

  assert.match(page, /function ScannerConfirmedResult/);
  assert.match(page, /<h2>\{confirmed\.card\?\.name\}<\/h2>/);
  assert.match(page, /\{tcgplayerCardUrl && <a/);
  assert.match(page, /Add to Collection/);
  assert.match(page, /Add to Wishlist/);
  assert.match(page, /Scan Another/);
  assert.match(page, /setPriceState\("error"\)/);
  assert.match(page, /setPriceState\(Number\(nextPrice\?\.marketPriceUsd\) > 0 \? "available" : "no-price"\)/);
  assert.match(page, /is-link-only/);
  assert.match(page, /confirmTrustedCandidate\(match, selectedCardId\)/);
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
