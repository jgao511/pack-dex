import assert from "node:assert/strict";
import test from "node:test";
import { l2Normalize, searchEmbeddingIndex, summarizeEmbeddingRetrieval } from "../src/lib/cardScanner/aiVisual/embeddingSearch.js";

test("scanner AI embedding search returns cosine-ranked catalog candidates", () => {
  const index = {
    dimensions: 3,
    modelVersion: "test-model",
    indexVersion: "test-index",
    cards: [
      { cardId: "far", embedding: [0, 1, 0] },
      { cardId: "near", embedding: [1, 0, 0] },
      { cardId: "closest", embedding: [0.9, 0.1, 0] },
    ],
  };

  const results = searchEmbeddingIndex([1, 0, 0], index, { limit: 2 });
  assert.deepEqual(results.map((result) => result.cardId), ["near", "closest"]);
  assert.equal(results[0].modelVersion, "test-model");
  assert.equal(results[0].indexVersion, "test-index");
  assert.equal(summarizeEmbeddingRetrieval(results).candidateCount, 2);
});

test("scanner AI l2 normalization safely handles empty vectors", () => {
  assert.deepEqual(l2Normalize([0, 0, 0]), [0, 0, 0]);
});
