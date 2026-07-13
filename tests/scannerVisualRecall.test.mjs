import assert from "node:assert/strict";
import test from "node:test";
import { buildVisualCandidateShortlist } from "../src/lib/cardScanner/localVisual/runVisualMatching.js";

const targetId = "evolutions-55-diglett";
const target = {
  cardId: targetId,
  normalizedName: "diglett",
  normalizedNumber: "55",
  printedSetTotal: 108,
  card: { name: "Diglett" },
};
const decoys = Array.from({ length: 50 }, (_, index) => ({
  cardId: `decoy-${index + 1}`,
  normalizedName: `different card ${index + 1}`,
  normalizedNumber: String(index + 1),
  printedSetTotal: 200,
  card: { name: `Different Card ${index + 1}` },
}));
const catalog = [...decoys, target];
const lightweight = {
  candidates: [
    ...decoys.slice(0, 34).map((entry, index) => ({ cardId: entry.cardId, score: .9 - index * .005 })),
    { cardId: targetId, score: .7 },
    ...decoys.slice(34, 44).map((entry, index) => ({ cardId: entry.cardId, score: .69 - index * .005 })),
  ],
};

test("candidate recall keeps the top forty lightweight candidates before ORB", () => {
  const shortlist = buildVisualCandidateShortlist({ lightweight, catalog });
  assert.equal(shortlist.visualRecallLimit, 40);
  assert.ok(shortlist.poolIds.includes(targetId));
  assert.equal(shortlist.poolIds.includes("decoy-40"), false);
  assert.equal(shortlist.candidateIds.length, 20);
});

test("OCR name, collector number, and printed total recover a rank-35 visual match for ORB", () => {
  const shortlist = buildVisualCandidateShortlist({
    lightweight,
    catalog,
    ocrMatch: {
      results: [],
      narrowedCardIds: [],
      nameCandidates: [{ raw: "Digletl", normalized: "digletl" }],
      collectorNumbers: [{ normalized: "55", normalizedTotal: "108" }],
    },
  });
  assert.ok(shortlist.candidateIds.includes(targetId));
  const evidence = shortlist.pool.find(({ cardId }) => cardId === targetId);
  assert.ok(evidence.sources.includes("collector-and-total"));
  assert.ok(evidence.sources.includes("ocr-fuzzy-name"));
});

test("trusted OCR result outside lightweight top forty enters the bounded ORB shortlist", () => {
  const outside = decoys[49];
  const shortlist = buildVisualCandidateShortlist({
    lightweight,
    catalog,
    ocrMatch: { results: [{ cardId: outside.cardId, score: 92 }], narrowedCardIds: [outside.cardId] },
  });
  assert.ok(shortlist.poolIds.includes(outside.cardId));
  assert.ok(shortlist.candidateIds.includes(outside.cardId));
  assert.ok(shortlist.candidateIds.length <= 20);
});
