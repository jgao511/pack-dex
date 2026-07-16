import assert from "node:assert/strict";
import test from "node:test";
import { applyFrozenAAcceptancePolicy, FROZEN_A_ACCEPTANCE_POLICY } from "../src/lib/cardScanner/frozenAAcceptancePolicy.js";

const card = (id, name) => ({ id, name });
const result = (cardId, name, score, reasons = []) => ({ cardId, card: card(cardId, name), score: Math.round(score * 100), reasons, visualEvidence: { frozenA: score } });
const evidence = (scores, names = ["Pikachu", "Pikachu V", "Raichu"]) => {
  const results = scores.map((score, index) => result(`card-${index + 1}`, names[index], score));
  return { frozenMatch: { results, candidateResults: results }, frozenCandidates: results.map(({ cardId, visualEvidence }) => ({ cardId, score: visualEvidence.frozenA })), results };
};
const ocrFor = (first, { name = true, number = true } = {}) => ({
  results: [{ cardId: first.cardId, reasons: [name ? "exact normalized name" : "", number ? "exact collector number" : ""].filter(Boolean) }],
  nameCandidates: name ? [{ normalized: "pikachu" }] : [],
});

test("strong visual and matching OCR become a one-card high-confidence result without replacing top-1", () => {
  const input = evidence([.79, .72, .69]);
  const out = applyFrozenAAcceptancePolicy({ ...input, ocrMatch: ocrFor(input.results[0]), geometry: { found: true }, diagnostics: true });
  assert.equal(out.mode, "high"); assert.deepEqual(out.results.map((item) => item.cardId), ["card-1"]); assert.equal(out.primaryMatch.cardId, "card-1");
  assert.ok(Math.abs(out.acceptanceDiagnostics.top1Top2Margin - .07) < 1e-9);
});

test("plausible ambiguous card remains medium with only credible alternatives", () => {
  const input = evidence([.68, .65, .54]);
  const out = applyFrozenAAcceptancePolicy({ ...input, ocrMatch: ocrFor(input.results[0], { number: false }), geometry: { found: true } });
  assert.equal(out.mode, "medium"); assert.deepEqual(out.results.map((item) => item.cardId), ["card-1", "card-2"]);
});

test("reliable OCR name only refines secondary candidates and never replaces the visual winner", () => {
  const input = evidence([.68, .64, .63], ["Pikachu", "Raichu", "Pikachu"]);
  const out = applyFrozenAAcceptancePolicy({ ...input, ocrMatch: ocrFor(input.results[0], { number: false }), geometry: { found: true } });
  assert.equal(out.mode, "medium"); assert.deepEqual(out.results.map((item) => item.cardId), ["card-1", "card-3"]);
});

for (const [label, scores, geometry] of [["room", [.42, .41, .40], { found: false }], ["card back", [.67, .66, .65], { found: true }], ["blank", [.21, .20, .19], { found: false }], ["unrelated object", [.55, .52, .50], { found: false }], ["ambiguous flat image", [.69, .685, .68], { found: false }]]) {
  test(`${label} evidence returns low/no-match without candidate cards`, () => {
    const input = evidence(scores);
    const out = applyFrozenAAcceptancePolicy({ ...input, ocrMatch: { results: [], nameCandidates: [] }, geometry });
    assert.equal(out.mode, "low"); assert.deepEqual(out.results, []); assert.equal(out.primaryMatch, null);
  });
}

test("thresholds are centralized and versioned", () => {
  assert.equal(FROZEN_A_ACCEPTANCE_POLICY.version, "frozen-a-acceptance-v1");
  assert.ok(FROZEN_A_ACCEPTANCE_POLICY.visualOnlySimilarity > FROZEN_A_ACCEPTANCE_POLICY.highSimilarity);
});
