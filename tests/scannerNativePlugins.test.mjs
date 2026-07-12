import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getOcrCropDefinitions, getProportionalSize, stripDataUrlPrefix } from "../src/lib/cardScanner/prepareCardImage.js";

test("prepares proportional OCR dimensions without upscaling", () => {
  assert.deepEqual(getProportionalSize(3000, 2000, 1800), { width: 1800, height: 1200 });
  assert.deepEqual(getProportionalSize(900, 1260, 1800), { width: 900, height: 1260 });
});

test("removes image data URL prefixes and rejects empty dimensions", () => {
  assert.equal(stripDataUrlPrefix("data:image/jpeg;base64,ABC123"), "ABC123");
  assert.throws(() => getProportionalSize(0, 0), /open that photo/i);
});

test("native adapters keep capture temporary and local", async () => {
  const source = await readFile(new URL("../mobile-app/src/lib/nativeScannerAdapters.js", import.meta.url), "utf8");
  assert.match(source, /saveToGallery:\s*false/);
  assert.match(source, /CameraResultType\.Uri/);
  assert.match(source, /CameraSource\.Photos/);
  assert.match(source, /base64Image:\s*pass\.base64Image/);
  for (const forbidden of ["localStorage", "indexedDB", "supabase", "fetch(\"http", "upload", "Filesystem"]) assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `Unexpected persistence or upload API: ${forbidden}`);
});

test("camera permission is requested only for camera source", async () => {
  const source = await readFile(new URL("../src/lib/cardScanner/captureCardImage.js", import.meta.url), "utf8");
  assert.match(source, /if \(source === "camera"\)/);
});

test("defines labeled top and overlapping bottom OCR crops", () => {
  const crops = getOcrCropDefinitions(1000, 1400);
  assert.deepEqual(crops.map(({ label, x, y, width, height, scale }) => ({ label, x, y, width, height, scale })), [
    { label: "full-card", x: 0, y: 0, width: 1000, height: 1400, scale: 1 },
    { label: "name-top", x: 0, y: 0, width: 1000, height: 378, scale: 2 },
    { label: "collector-bottom", x: 0, y: 1064, width: 1000, height: 336, scale: 2.5 },
    { label: "collector-bottom-left", x: 0, y: 1064, width: 620, height: 336, scale: 2.5 },
    { label: "collector-bottom-right", x: 380, y: 1064, width: 620, height: 336, scale: 2.5 },
  ]);
});

test("orientation is applied once and scanner root is scrollable", async () => {
  const prep = await readFile(new URL("../src/lib/cardScanner/prepareCardImage.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8");
  assert.match(prep, /imageOrientation: "none"/);
  assert.doesNotMatch(prep, /imageOrientation: "from-image"/);
  assert.match(css, /\.scanner-dev[^}]*overflow-y: auto/);
  assert.match(css, /calc\(86px \+ max\(14px, env\(safe-area-inset-bottom\)\) \+ 18px\)/);
});
