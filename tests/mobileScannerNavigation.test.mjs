import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("normal mobile navigation has Open, Collection, Explore, and Profile while Scanner stays test-build-only", async () => {
  const app = await source("../mobile-app/src/App.jsx");
  assert.match(app, /\{ id: "open", label: "Open"[\s\S]*\{ id: "collection", label: "Collection"/);
  assert.match(app, /__PACKDEX_SCANNER_TEST__[\s\S]*\? \{ id: "scanner"[\s\S]*: \{ id: "explore"/);
  assert.match(app, /\{ id: "profile", label: "Profile"/);
  assert.match(app, /const MobileScannerPage = __PACKDEX_SCANNER_TEST__ \? lazy/);
  assert.match(app, /__PACKDEX_SCANNER_TEST__ && activeTab === "scanner"/);
  assert.match(app, /MobileScannerPage authState=\{authValidationState\}[\s\S]*?onAddToCollection=\{addScannedCardToCollection\}[\s\S]*?onAddToWishlist=\{addScannedCardToWishlist\}[\s\S]*?onSearchManually=\{openScannerSearchInCollection\}[\s\S]*?onLoadCardPrice=\{loadScannerCardPrice\}/);
});

test("Collection preserves Set Collection, Binders, and Value destinations", async () => {
  const app = await source("../mobile-app/src/App.jsx");
  assert.match(app, /Set Collection/);
  assert.match(app, /\r?\n\s*Binders\r?\n/);
  assert.match(app, /\r?\n\s*Value\r?\n/);
  assert.match(app, /<ValueScreen \{\.\.\.valueScreenProps\} \/>/);
  assert.match(app, /collectionTab === "value"/);
});

test("preserved scanner implementation keeps tips and restartable camera flow without diagnostic UI", async () => {
  const scanner = await source("../mobile-app/src/MobileScannerPage.jsx");
  assert.match(scanner, /Tips for a better scan/);
  assert.match(scanner, /Start Scanning/);
  assert.match(scanner, /packdex\.scannerTipsSeen\.v1/);
  assert.match(scanner, /localStorage\.getItem\(TIPS_STORAGE_KEY\)/);
  assert.match(scanner, /async function ensureCameraStarted\(\)/);
  assert.match(scanner, /async function stopCamera\(\)/);
  assert.match(scanner, /lifecycleRef\.current \+= 1/);
  assert.match(scanner, /setCameraEpoch/);
  assert.match(scanner, /processing-error/);
  assert.match(scanner, /captureBrowserFrame/);
  assert.match(scanner, /import\("\.\/lib\/nativeScannerAdapters\.js"\)/);
  assert.doesNotMatch(scanner, /import .*from "\.\/lib\/nativeScannerAdapters\.js"/);
  assert.doesNotMatch(scanner, /Scanner Diagnostics|Run Reference Test|Run Pixel Fixture|model score|OCR dump/i);
});
