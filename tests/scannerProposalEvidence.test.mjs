import assert from "node:assert/strict";
import test from "node:test";
import { rankFinalProposalRuns, rankProposalEvidence, scoreTextBlockLayout } from "../src/lib/cardScanner/proposalEvidence.js";

test("ML Kit block coordinates identify a card-spanning text cluster", () => {
  const score = scoreTextBlockLayout([
    { text: "Diglett", sourcePass: "full-card", boundingBox: { left: 50, top: 35, right: 180, bottom: 80 } },
    { text: "Dig Through", sourcePass: "full-card", boundingBox: { left: 80, top: 390, right: 330, bottom: 430 } },
    { text: "55/108", sourcePass: "full-card", boundingBox: { left: 390, top: 650, right: 475, bottom: 680 } },
  ], 500, 700);
  assert.ok(score > .9);
  assert.equal(scoreTextBlockLayout([], 500, 700), 0);
});

test("a card-shaped OCR/visual agreement beats the wooden full-photo fallback", () => {
  const expected = "xy12-55-diglett";
  const ranked = rankProposalEvidence([
    {
      proposal: { id: "centered-1", geometryScore: .72 },
      ocrMatch: { results: [{ cardId: expected, score: 105, reasons: ["exact collector number"] }] },
      lightweight: { candidates: [{ cardId: expected, score: .79 }, { cardId: "unrelated", score: .68 }] },
    },
    {
      proposal: { id: "full-fallback", geometryScore: .05, isFallback: true },
      ocrMatch: { results: [] },
      lightweight: { candidates: [{ cardId: "unrelated", score: .73 }, { cardId: expected, score: .47 }] },
    },
  ]);
  assert.equal(ranked[0].proposal.id, "centered-1");
  assert.equal(ranked[0].evidence.compatible, true);
});

test("final proposal selection includes ORB evidence", () => {
  const cardId = "xy11-111-gardevoir-ex";
  const ranked = rankFinalProposalRuns([
    {
      proposal: { id: "weak" }, evidence: { score: .75 },
      fusedMatch: { confidence: "medium", results: [{ cardId, score: 72 }] },
      visualMatch: { orb: { candidates: [{ cardId, score: .12, inliers: 2 }] } },
    },
    {
      proposal: { id: "verified" }, evidence: { score: .73 },
      fusedMatch: { confidence: "high", results: [{ cardId, score: 91 }] },
      visualMatch: { orb: { candidates: [{ cardId, score: .74, inliers: 41 }] } },
    },
  ]);
  assert.equal(ranked[0].proposal.id, "verified");
});
