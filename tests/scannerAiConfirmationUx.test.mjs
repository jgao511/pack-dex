import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canRetryAiFoilScan, getAiQualityGuidance, getAiScanPresentation, getAiUserCandidates, isAiSelectionExplicit } from "../mobile-app/src/lib/aiScannerPresentation.js";

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

test("exact Kingdra collector and set-total evidence wins user-selection rank without changing confirmation", () => {
  const scan = { result: { safeNoResult: true, results: [
    { cardId: "shrouded-fable-12-kingdra-ex", name: "Kingdra ex", score: .81, evidence: {} },
    { cardId: "xy10-73-kingdra-ex", name: "Kingdra-EX", score: .8, evidence: {} },
    { cardId: "dragon-majesty-66-kingdra-gx", name: "Kingdra-GX", score: .79, evidence: {} },
    { cardId: "shrouded-fable-80-kingdra-ex", name: "Kingdra ex", score: .61, evidence: { exactCollector: true, printedTotal: true } },
  ] } };
  assert.equal(scan.result.results.findIndex(({ cardId }) => cardId === "shrouded-fable-80-kingdra-ex") + 1, 4);
  const presented = getAiUserCandidates(scan);
  assert.equal(presented[0].cardId, "shrouded-fable-80-kingdra-ex");
  assert.equal(presented[0].displayRank, 1);
  assert.equal(scan.result.confirmedCardId, undefined);
});

test("same-name printings without collector evidence are explicitly unresolved", () => {
  const presentation = getAiScanPresentation({ result: { safeNoResult: true, results: [
    { cardId: "a", name: "Kingdra-EX", score: .8, evidence: {} }, { cardId: "b", name: "Kingdra ex", score: .7, evidence: {} },
  ] } });
  assert.equal(presentation.printingUnresolved, true);
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

test("scanner-AI renders every post-scan quality guidance state", () => {
  const cases = [
    [{ glareWarning: true }, /Glare detected/],
    [{ cropAreaFraction: .3 }, /Move closer/],
    [{ sharpnessEstimate: 5 }, /Hold steadier/],
    [{ meanLuminance: 40 }, /Improve lighting/],
    [{ progressiveResult: true }, /OCR time budget/],
  ];
  for (const [quality, expected] of cases) assert.match(getAiQualityGuidance(quality).join(" "), expected);
});

test("scanner-AI debug UI keeps progressive results and confirmation local without collection writes", async () => {
  const source = await readFile(new URL("../mobile-app/src/CardScannerDevPage.jsx", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../mobile-app/src/lib/aiScannerPoc.js", import.meta.url), "utf8");
  assert.match(source, /aiPocEnabled && stage === "ai-result"/);
  assert.match(source, /if \(aiPocEnabled\) \{\s*const file = await fileFromCapturedImage\(nextImage\)/);
  assert.match(source, /Try Foil Scan/);
  assert.match(source, /getCardImageUrl\(\{ imageUrl: result\.imageUrl \}\)/);
  assert.match(source, /Card image unavailable/);
  assert.match(source, /Printing unresolved/);
  assert.match(source, /setAiConfirmed\(aiSelected\)/);
  assert.match(runtime, /ocr-budget-exhausted/);
  assert.doesNotMatch(source, /addToCollection|addToWishlist|collection\/|wishlist\//i);
});
