import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { captureCardImage, CardCaptureError, createTemporaryImage, getBrowserFileInputOptions } from "../src/lib/cardScanner/captureCardImage.js";
import { normalizeOcrResult, recognizeCardText, CardRecognitionError } from "../src/lib/cardScanner/recognizeCardText.js";
import { confirmTrustedCandidate, getScannerResultMode, releaseTemporaryImage } from "../src/lib/cardScanner/scannerSession.js";

test("normalizes OCR text, confidence, lines, and bounds", () => {
  assert.deepEqual(normalizeOcrResult({ lines: [{ text: " Pikachu ", confidence: "0.9", frame: { x: 1 } }] }), { fullText: "Pikachu", blocks: [{ text: "Pikachu", confidence: .9, boundingBox: { x: 1 } }] });
  assert.deepEqual(normalizeOcrResult(null), { fullText: "", blocks: [] });
});

test("normalizes empty plugin output and wraps plugin failures", async () => {
  assert.deepEqual(await recognizeCardText({}, { adapter: { recognize: async () => ({}) } }), { fullText: "", blocks: [] });
  await assert.rejects(() => recognizeCardText({}, { adapter: { recognize: async () => { throw new Error("native failure"); } } }), (error) => error instanceof CardRecognitionError && error.code === "failed");
});

for (const [permission, code] of [["denied", "permission-denied"], ["permanentlyDenied", "permission-permanently-denied"]]) {
  test(`handles ${permission} camera permission`, async () => {
    const adapter = { isAvailable: () => true, checkPermission: async () => permission, requestPermission: async () => permission, capture: async () => assert.fail("must not capture") };
    await assert.rejects(() => captureCardImage({ nativeAdapter: adapter }), (error) => error instanceof CardCaptureError && error.code === code);
  });
}

test("treats native and browser cancellation as cancellation", async () => {
  const nativeAdapter = { isAvailable: () => true, checkPermission: async () => "granted", capture: async () => null };
  await assert.rejects(() => captureCardImage({ nativeAdapter }), (error) => error.code === "cancelled");
  await assert.rejects(() => captureCardImage({ selectBrowserFile: async () => null }), (error) => error.code === "cancelled");
});

test("uses browser image selection fallback and releases its temporary URL once", async () => {
  const calls = []; const urlApi = { createObjectURL: () => "blob:test", revokeObjectURL: (url) => calls.push(url) };
  const file = { name: "card.jpg" };
  const image = await captureCardImage({ source: "camera", selectBrowserFile: async (options) => { assert.deepEqual(options, { accept: "image/*", capture: "environment" }); return file; }, urlApi });
  assert.equal(image.imageUrl, "blob:test"); releaseTemporaryImage(image); releaseTemporaryImage(image); assert.deepEqual(calls, ["blob:test"]);
  assert.deepEqual(getBrowserFileInputOptions("library"), { accept: "image/*", capture: undefined });
});

test("models high, medium, and low result displays without auto-confirming", () => {
  const trustedCard = { id: "trusted-1", name: "Pikachu" };
  const candidate = { cardId: "trusted-1", card: trustedCard, setId: "base-set", setName: "Base Set" };
  assert.equal(getScannerResultMode({ confidence: "high", primaryMatch: candidate }), "high");
  assert.equal(getScannerResultMode({ confidence: "medium", results: [candidate] }), "medium");
  assert.equal(getScannerResultMode({ confidence: "low", results: [] }), "low");
  assert.deepEqual(confirmTrustedCandidate({ results: [candidate] }, "trusted-1"), { cardId: "trusted-1", card: trustedCard, setId: "base-set", setName: "Base Set" });
  assert.equal(confirmTrustedCandidate({ results: [candidate] }, "ocr-invented"), null);
});

test("scanner page has no collection, wishlist, pack event, or Supabase write path", async () => {
  const source = await readFile(new URL("../mobile-app/src/CardScannerDevPage.jsx", import.meta.url), "utf8");
  for (const forbidden of ["supabase", "increment_collection", "addWishlist", "recordPackOpen", "savePulledCards"]) assert.doesNotMatch(source, new RegExp(forbidden, "i"));
});

test("scanner route remains guarded by DEV and absent from mobile navigation", async () => {
  const main = await readFile(new URL("../mobile-app/src/main.jsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  assert.match(main, /import\.meta\.env\.DEV\s*&&\s*normalizedPath === "\/mobile-app\/dev\/card-scanner"/);
  assert.doesNotMatch(app, /mobile-app\/dev\/card-scanner/);
});
