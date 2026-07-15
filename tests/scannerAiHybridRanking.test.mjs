import assert from "node:assert/strict";
import test from "node:test";
import { fuseHybridEvidence, selectBoundedOrbCandidates } from "../src/lib/cardScanner/aiVisual/hybridRanking.js";

const candidate = (cardId, evidenceScore, codes) => ({ cardId, evidenceScore, reasons: codes.map((code) => ({ code })) });

test("hybrid scanner confirms agreeing collector, total, name, and supported AI evidence", () => {
  const candidatePool = {
    usedFullCatalogFallback: false,
    candidates: [
      candidate("expected", 100, ["collector-number-exact", "printed-total-exact", "name-exact"]),
      candidate("variant", 70, ["name-exact"]),
      candidate("other", 60, ["name-fuzzy"]),
    ],
  };
  const result = fuseHybridEvidence({
    candidatePool,
    visualCandidates: [
      { cardId: "expected", visualScore: 0.99 },
      { cardId: "variant", visualScore: 0.40 },
      { cardId: "other", visualScore: 0.3 },
    ],
  });
  assert.equal(result.confirmedCardId, "expected");
  assert.equal(result.safeNoResult, false);
  assert.equal(result.diagnostics.visualRank, 1);
});

test("strong OCR never confirms an anti-match or an unseparated AI winner", () => {
  const candidatePool = {
    usedFullCatalogFallback: false,
    candidates: [candidate("expected", 100, ["collector-number-total-exact", "name-exact"])],
  };
  const antiMatch = fuseHybridEvidence({ candidatePool, visualCandidates: [{ cardId: "expected", visualScore: -1 }] });
  assert.equal(antiMatch.confirmedCardId, null);
  assert.equal(antiMatch.safeNoResult, true);

  const tiedPool = {
    usedFullCatalogFallback: false,
    candidates: [
      candidate("expected", 100, ["collector-number-total-exact", "name-exact"]),
      candidate("variant", 95, ["name-exact"]),
    ],
  };
  const tied = fuseHybridEvidence({
    candidatePool: tiedPool,
    visualCandidates: [{ cardId: "expected", visualScore: 0.5 }, { cardId: "variant", visualScore: 0.5 }],
  });
  assert.equal(tied.confirmedCardId, null);
  assert.equal(tied.safeNoResult, true);
});

test("hybrid scanner returns safe no-result for weak full-catalog AI retrieval", () => {
  const result = fuseHybridEvidence({
    candidatePool: {
      usedFullCatalogFallback: true,
      candidates: [candidate("unrelated", 0, ["full-catalog-fallback"]), candidate("other", 0, ["full-catalog-fallback"])],
    },
    visualCandidates: [{ cardId: "unrelated", visualScore: 0.64 }, { cardId: "other", visualScore: 0.62 }],
  });
  assert.equal(result.confirmedCardId, null);
  assert.equal(result.safeNoResult, true);
  assert.equal(result.confidence, "low");
});

test("hybrid results retain PackDex card metadata required by selectable candidate rendering", () => {
  const result = fuseHybridEvidence({
    candidatePool: { usedFullCatalogFallback: false, candidates: [{ ...candidate("kingdra", 20, ["name-exact"]), name: "Kingdra ex", setName: "Shrouded Fable", collectorNumber: "80", printedTotal: "64", rarity: "Ultra Rare", imageUrl: "https://assets.pack-dex.com/sets/shrouded-fable/cards/80_Kingdra_ex_Ultra_Rare.png" }] },
    visualCandidates: [{ cardId: "kingdra", visualScore: .6 }],
  });
  assert.equal(result.results[0].imageUrl, "https://assets.pack-dex.com/sets/shrouded-fable/cards/80_Kingdra_ex_Ultra_Rare.png");
  assert.equal(result.results[0].setName, "Shrouded Fable");
  assert.equal(result.results[0].printedSetTotal, "64");
});

test("ORB is bounded to five only for a small ambiguous pool with close AI scores", () => {
  const pool = {
    usedFullCatalogFallback: false,
    candidates: Array.from({ length: 6 }, (_, index) => candidate(`card-${index}`, 30, ["name-exact"])),
  };
  const close = Array.from({ length: 6 }, (_, index) => ({ cardId: `card-${index}`, visualScore: 0.7 - index * 0.005 }));
  assert.deepEqual(selectBoundedOrbCandidates({ visualCandidates: close, candidatePool: pool }).candidateIds, ["card-0", "card-1", "card-2", "card-3", "card-4"]);
  assert.equal(selectBoundedOrbCandidates({ visualCandidates: [{ cardId: "a", visualScore: 0.8 }, { cardId: "b", visualScore: 0.7 }, { cardId: "c", visualScore: 0.6 }], candidatePool: pool }).reason, "ai-winner-not-close");
  assert.equal(selectBoundedOrbCandidates({ visualCandidates: close, candidatePool: { ...pool, usedFullCatalogFallback: true } }).reason, "full-catalog-pool");
});
