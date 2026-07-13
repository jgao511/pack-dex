import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getOcrCropDefinitions, getProportionalSize, prepareCardImage, stripDataUrlPrefix } from "../src/lib/cardScanner/prepareCardImage.js";
import { mapPreviewOutlineToCapture } from "../src/lib/cardScanner/mapPreviewCrop.js";

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
    { label: "collector-bottom-edge", x: 0, y: 1176, width: 1000, height: 224, scale: 3 },
  ]);
});

test("File/Blob EXIF orientation is honored and scanner root is scrollable", async () => {
  const prep = await readFile(new URL("../src/lib/cardScanner/prepareCardImage.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8");
  assert.match(prep, /imageOrientation: "from-image"/);
  assert.match(css, /\.scanner-dev[^}]*overflow-y: auto/);
  assert.match(css, /calc\(86px \+ max\(14px, env\(safe-area-inset-bottom\)\) \+ 18px\)/);
});

test("maps a portrait card outline through center-cover preview coordinates", () => {
  assert.deepEqual(mapPreviewOutlineToCapture({
    previewWidth: 300, previewHeight: 420, captureWidth: 1200, captureHeight: 1600,
    outline: { x: 10, y: 10, width: 280, height: 400 }, safetyMargin: 0, bottomSafetyMargin: 0,
  }), { x: 67, y: 38, width: 1067, height: 1524 });
});

test("native scanner uses embedded Camera Preview and reserves Camera for photos", async () => {
  const adapters = await readFile(new URL("../mobile-app/src/lib/nativeScannerAdapters.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../mobile-app/src/CardScannerDevPage.jsx", import.meta.url), "utf8");
  assert.match(adapters, /CameraPreview\.start/);
  assert.match(adapters, /CameraPreview\.capture/);
  assert.match(adapters, /disableAudio:\s*true/);
  assert.match(adapters, /CameraPreview\.isCameraStarted/);
  assert.doesNotMatch(adapters, /rect\.left \* dpr/);
  assert.match(adapters, /setPreviewTransparency\(toBack\)/);
  assert.match(page, /onClick=\{capturePreview\}/);
  assert.match(page, /Diagnostic: preview in front/);
  assert.match(page, /Run Reference Test/);
  const css = await readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8");
  assert.match(css, /html\.scanner-camera-active/);
  assert.match(css, /background-color:\s*transparent !important/);
});

test("bottom safety expansion preserves the physical Pixel capture lower edge", () => {
  assert.deepEqual(mapPreviewOutlineToCapture({
    previewWidth: 300, previewHeight: 420, captureWidth: 1080, captureHeight: 1920,
    outline: { x: 10, y: 10, width: 280, height: 400 },
  }), { x: 11, y: 204, width: 1058, height: 1716 });
});

test("reference fixture is a JPEG wired through recognition without trusted-result injection", async () => {
  const fixture = await readFile(new URL("./fixtures/scanner/mega-charizard-x-ex-013-094.jpg", import.meta.url));
  const page = await readFile(new URL("../mobile-app/src/CardScannerDevPage.jsx", import.meta.url), "utf8");
  assert.deepEqual([...fixture.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.match(page, /recognizeCardText\(referenceImage/);
  assert.match(page, /new File\(\[blob\]/);
  assert.match(page, /createTemporaryImage\(file\)/);
  assert.doesNotMatch(page, /runReferenceTest[\s\S]{0,1200}phantasmal-flames-13-mega-charizard-x-ex/);
});

test("camera preparation offers both mapped outline and complete capture to rectification", async () => {
  const makeCanvas = (width, height) => ({ width, height, getContext: () => ({ filter: "none", drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,AA==" });
  let inputs;
  const rectified = makeCanvas(750, 1050);
  const result = await prepareCardImage({ imageUrl: "blob:test", previewGeometry: { previewWidth: 300, previewHeight: 420, outline: { x: 10, y: 10, width: 280, height: 400 } } }, {
    fetchImpl: async () => ({ blob: async () => new Blob(["image"]) }),
    createBitmap: async () => ({ width: 1080, height: 1920, close() {} }), createCanvas: makeCanvas,
    rectify: async (value) => { inputs = value; return { canvas: rectified, diagnostics: { selectedSource: "full-capture" } }; },
  });
  assert.ok(inputs.mappedCrop); assert.notEqual(inputs.outlineCanvas, inputs.fullCanvas);
  assert.equal(result.canvas, rectified); assert.equal(result.boundaryDiagnostics.selectedSource, "full-capture");
});

test("Choose Photo preparation starts from the complete File/Blob image", async () => {
  const makeCanvas = (width, height) => ({ width, height, getContext: () => ({ filter: "none", drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,AA==" });
  let inputs; let bitmapOptions;
  await prepareCardImage({ imageUrl: "blob:user-photo" }, {
    fetchImpl: async () => ({ blob: async () => new Blob(["image"]) }),
    createBitmap: async (_blob, options) => { bitmapOptions = options; return { width: 716, height: 1000, close() {} }; }, createCanvas: makeCanvas,
    rectify: async (value) => { inputs = value; return { canvas: value.fullCanvas, diagnostics: { selectedSource: "full-capture-fallback" } }; },
  });
  assert.deepEqual(bitmapOptions, { imageOrientation: "from-image" });
  assert.equal(inputs.mappedCrop, null); assert.equal(inputs.outlineCanvas, inputs.fullCanvas);
});
