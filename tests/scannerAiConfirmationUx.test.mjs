import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canRetryAiFoilScan, getAiQualityGuidance, getAiScanPresentation, isAiSelectionExplicit } from "../mobile-app/src/lib/aiScannerPresentation.js";

const candidates = [
  { cardId: "one", name: "One" }, { cardId: "two", name: "Two" }, { cardId: "three", name: "Three" }, { cardId: "four", name: "Four" },
];

test("scanner-AI confirmation presentation limits possible matches to three and requires an explicit selection", () => {
  const presentation = getAiScanPresentation({ result: { safeNoResult: true, results: candidates } });
  assert.equal(presentation.kind, "possible");
  assert.deepEqual(presentation.candidates.map(({ cardId }) => cardId), ["one", "two", "three"]);
  assert.equal(isAiSelectionExplicit(null), false);
  assert.equal(isAiSelectionExplicit(presentation.candidates[0]), true);
});

test("scanner-AI presentation distinguishes frozen high confidence and no reliable match", () => {
  assert.equal(getAiScanPresentation({ result: { confirmedCardId: "one", results: candidates } }).kind, "high");
  assert.equal(getAiScanPresentation({ result: { safeNoResult: true, results: [] } }).kind, "none");
});

test("scanner-AI quality guidance and foil retry are bounded to poor or reflective scans", () => {
  const guidance = getAiQualityGuidance({ glareWarning: true, cropAreaFraction: .3, sharpnessEstimate: 5, meanLuminance: 40, progressiveResult: true });
  assert.equal(guidance.length, 5);
  assert.match(guidance.join(" "), /Glare detected/);
  assert.match(guidance.join(" "), /Move closer/);
  assert.match(guidance.join(" "), /Hold steadier/);
  assert.match(guidance.join(" "), /Improve lighting/);
  assert.equal(canRetryAiFoilScan({ result: { confirmedCardId: "one" }, scanQuality: { glareWarning: false } }), false);
  assert.equal(canRetryAiFoilScan({ result: { safeNoResult: true }, scanQuality: { glareWarning: false } }), true);
  assert.equal(canRetryAiFoilScan({ result: { confirmedCardId: "one" }, scanQuality: { glareWarning: true } }), true);
});

test("scanner-AI debug UI keeps progressive results and confirmation local without collection writes", async () => {
  const source = await readFile(new URL("../mobile-app/src/CardScannerDevPage.jsx", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../mobile-app/src/lib/aiScannerPoc.js", import.meta.url), "utf8");
  assert.match(source, /aiPocEnabled && stage === "ai-result"/);
  assert.match(source, /Try Foil Scan/);
  assert.match(source, /setAiConfirmed\(aiSelected\)/);
  assert.match(runtime, /ocr-budget-exhausted/);
  assert.doesNotMatch(source, /addToCollection|addToWishlist|collection\/|wishlist\//i);
});
