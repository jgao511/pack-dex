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
  assert.match(page, /const target = kind === "collection" \? "Collection" : "Wishlist"/);
  assert.match(page, /return `Add to \$\{target\}`/);
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
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.scanner-beta-price-spinner, \.scanner-beta-action-spinner \{ animation: none; \} \}/);
  assert.doesNotMatch(page, /Match selected by you/);
  assert.doesNotMatch(page, /Price unavailable/);
});

test("scanner account actions have independent auth, saving, completion, and retry states", async () => {
  const { page, app, css } = await readScannerPresentationSources();

  assert.match(page, /Sign in to Add to \$\{target\}/);
  assert.match(page, /state === "saving"/);
  assert.match(page, /return "Adding…"/);
  assert.match(page, /state === "success" \|\| state === "already-added"/);
  assert.match(page, /aria-busy=\{isSaving \|\| undefined\}/);
  assert.match(page, /scanner-beta-action-spinner/);
  assert.match(page, /setCollectionActionState\("error"\)|setState\("error"\)/);
  assert.match(page, /Please try again/);
  assert.match(page, /actionPendingRef\.current\[kind\]/);
  assert.match(page, /onRequireAuth\?\.\(\)/);
  assert.match(page, /nextState\?\.collectionAdded/);
  assert.match(page, /nextState\?\.wishlisted/);
  assert.match(css, /button\.is-complete/);
  assert.match(app, /function openScannerAuth\(\)/);
  assert.match(app, /onRequireAuth=\{openScannerAuth\}/);
  assert.doesNotMatch(app.match(/function openScannerAuth\(\) \{[\s\S]*?\n  \}/)?.[0] || "", /setActiveTab/);
});

test("scanner collection and wishlist callbacks use authenticated server persistence", async () => {
  const { app } = await readScannerPresentationSources();

  const collectionHandler = app.match(/async function addScannedCardToCollection\(result\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const wishlistHandler = app.match(/async function addScannedCardToWishlist\(result\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(collectionHandler, /addScannedCardOnce\(supabase/);
  assert.doesNotMatch(collectionHandler, /persistSessionCollection|markCardsCollected/);
  assert.match(wishlistHandler, /addWishlistCard\(supabase, actionUserId/);
  assert.doesNotMatch(wishlistHandler, /toggleWishlistCard/);
  assert.match(app, /authValidationState === "authenticated" \? String\(user\?\.id \|\| ""\) : ""/);
});

test("pricing failure cannot suppress scanner metadata, links, or actions", async () => {
  const { page } = await readScannerPresentationSources();

  assert.match(page, /function ScannerConfirmedResult/);
  assert.match(page, /<h2>\{confirmed\.card\?\.name\}<\/h2>/);
  assert.match(page, /\{tcgplayerCardUrl && <a/);
  assert.match(page, /const target = kind === "collection" \? "Collection" : "Wishlist"/);
  assert.match(page, /return `Add to \$\{target\}`/);
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

test("scanner acceptance modes render the safe no-match copy and still require confirmation", async () => {
  const { page } = await readScannerPresentationSources();

  assert.match(page, /We couldn’t confidently identify your card\./);
  assert.match(page, /Make sure the front of one card fills the frame, reduce glare, and try again\./);
  assert.match(page, /Card identified/);
  assert.match(page, /Choose the matching card/);
  assert.match(page, /data-card-id=\{candidate\.cardId\}/);
  assert.match(page, /onClick=\{confirmSelection\}>Confirm selected card/);
  assert.doesNotMatch(page, /decision\.mode[\s\S]{0,300}(?:saveAction|onCollectionAction|onWishlistAction)/);
});
