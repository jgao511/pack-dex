import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("mobile navigation has permanent Open, Collection, Scanner, and Profile tabs", async () => {
  const app = await source("../mobile-app/src/App.jsx");
  const tabOrder = [...app.matchAll(/\{ id: "([^"]+)", label: "([^"]+)"/g)].slice(0, 4).map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(tabOrder, ["open:Open a Pack", "collection:Collection", "scanner:Scanner", "profile:Profile"]);
  assert.match(app, /MobileScannerPage onAddToCollection=\{addScannedCardToCollection\} onAddToWishlist=\{addScannedCardToWishlist\} onSearchManually=\{openScannerSearchInCollection\} onLoadCardPrice=\{loadScannerCardPrice\}/);
});

test("Collection preserves Set Collection, Binders, and Value destinations", async () => {
  const app = await source("../mobile-app/src/App.jsx");
  assert.match(app, /Set Collection/);
  assert.match(app, /\n\s*Binders\n/);
  assert.match(app, /\n\s*Value\n/);
  assert.match(app, /<ValueScreen \{\.\.\.valueScreenProps\} \/>/);
  assert.match(app, /collectionTab === "value"/);
});

test("production Scanner persists tips and has a restartable camera flow without diagnostic UI", async () => {
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
