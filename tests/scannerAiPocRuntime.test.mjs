import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogCandidateIndex } from "../src/lib/cardScanner/aiVisual/catalogCandidateIndex.js";
import { resetAiScannerPocPreloadForTests, runAiScannerPoc } from "../mobile-app/src/lib/aiScannerPoc.js";

const canvas = { toDataURL: () => "data:image/jpeg;base64,AA==" };
const preparedScan = { canvas, base64Image: "AA==", aiPreparationMs: 2 };
const catalog = [
  { cardId: "expected", name: "Pikachu ex", cardNumber: "25", printedSetTotal: "100", setId: "set-a", setName: "Set A", rarity: "Rare", card: { id: "expected", name: "Pikachu ex", number: "25", image: "https://assets.pack-dex.com/sets/a/25.png" } },
  { cardId: "same-name", name: "Pikachu ex", cardNumber: "77", printedSetTotal: "100", setId: "set-a", setName: "Set A", rarity: "Rare", card: { id: "same-name", name: "Pikachu ex", number: "77", image: "https://assets.pack-dex.com/sets/a/77.png" } },
  { cardId: "other", name: "Raichu", cardNumber: "25", printedSetTotal: "200", setId: "set-b", setName: "Set B", rarity: "Rare", card: { id: "other", name: "Raichu", number: "25", image: "https://assets.pack-dex.com/sets/b/25.png" } },
];
const candidateIndex = createCatalogCandidateIndex(catalog);

function makeEmbedder(embedding) {
  let calls = 0;
  return {
    initialize: async () => ({ ready: true }),
    embedImage: async () => { calls += 1; return { embedding, dimensions: embedding.length, inferenceMs: 4, l2Norm: 1 }; },
    get calls() { return calls; },
  };
}

test("scanner-AI orchestration requires screen-open preload instead of fetching on first scan", async () => {
  resetAiScannerPocPreloadForTests();
  const result = await runAiScannerPoc({}, { preparedScan });
  assert.equal(result.status, "scanner-ai-poc-unavailable");
  assert.match(result.error, /not preloaded/i);
  assert.equal(result.result.safeNoResult, true);
});

test("scanner-AI runs one embedding and searches only the OCR-narrowed candidate IDs", async () => {
  resetAiScannerPocPreloadForTests();
  const embedder = makeEmbedder([1, 0]);
  const index = {
    dimensions: 2,
    modelVersion: "generic-test",
    indexVersion: "test",
    cards: [
      { cardId: "expected", embedding: [0.2, 0.9797959] },
      { cardId: "same-name", embedding: [1, 0] },
      { cardId: "other", embedding: [1, 0] },
    ],
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("scan-time network forbidden"); };
  try {
    const result = await runAiScannerPoc({}, {
      index,
      embedder,
      catalog,
      candidateIndex,
      preparedScan,
      ocrEvidence: {
        rawText: "Pikachu ex\n25/100",
        nameCandidates: [{ raw: "Pikachu ex", normalized: "pikachu ex", sourcePass: "name-top", reliable: true }],
        collectorNumbers: [{ raw: "25/100", normalized: "25", normalizedTotal: "100", sourcePass: "collector-bottom", reliable: true }],
      },
    });
    assert.equal(embedder.calls, 1);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(result.candidatePool.size, 1);
    assert.deepEqual(result.visualRanking.map(({ cardId }) => cardId), ["expected"]);
    assert.equal(result.result.confirmedCardId, null);
    assert.equal(result.result.safeNoResult, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weak OCR keeps the full catalog searchable and safely declines close AI candidates", async () => {
  resetAiScannerPocPreloadForTests();
  const embedder = makeEmbedder([1, 0]);
  const result = await runAiScannerPoc({}, {
    index: {
      dimensions: 2,
      modelVersion: "generic-test",
      indexVersion: "test",
      cards: [
        { cardId: "expected", embedding: [0.7, 0.71414284] },
        { cardId: "same-name", embedding: [0.69, 0.72380937] },
        { cardId: "other", embedding: [0.68, 0.73321211] },
      ],
    },
    embedder,
    catalog,
    candidateIndex,
    preparedScan,
    ocrEvidence: { rawText: "copyright pokemon", nameCandidates: [], collectorNumbers: [] },
  });
  assert.equal(embedder.calls, 1);
  assert.equal(result.candidatePool.usedFullCatalogFallback, true);
  assert.equal(result.candidatePool.size, 3);
  assert.equal(result.result.confirmedCardId, null);
  assert.equal(result.result.safeNoResult, true);
  assert.equal(result.orb.ran, false);
});
