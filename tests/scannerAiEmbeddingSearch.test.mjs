import assert from "node:assert/strict";
import test from "node:test";
import {
  createTypedEmbeddingIndex,
  decodeFloat16LittleEndian,
  l2Normalize,
  searchEmbeddingIndex,
  summarizeEmbeddingRetrieval,
} from "../src/lib/cardScanner/aiVisual/embeddingSearch.js";

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

test("scanner AI decodes generated float16 indexes and restricts search to the OCR pool", () => {
  // 1, 0, 0, 1 as little-endian IEEE-754 binary16.
  const bytes = Uint8Array.from([0x00, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3c]);
  assert.deepEqual([...decodeFloat16LittleEndian(bytes)], [1, 0, 0, 1]);
  const index = createTypedEmbeddingIndex({
    schemaVersion: 2,
    indexVersion: "typed-test",
    count: 2,
    dimensions: 2,
    dtype: "float16-le",
    normalized: true,
    model: { version: "typed-model", sha256: "model-sha256" },
    cardIds: ["first", "second"],
  }, bytes);
  const results = searchEmbeddingIndex([1, 0], index, { candidateIds: ["second"], limit: 5 });
  assert.deepEqual(results.map(({ cardId, visualScore }) => [cardId, visualScore]), [["second", 0]]);
});

test("scanner AI rejects malformed typed index metadata before scanning", () => {
  const base = { schemaVersion: 2, indexVersion: "test-index", model: { version: "test-model", sha256: "model-sha256" }, normalized: true };
  assert.throws(() => createTypedEmbeddingIndex({ ...base, count: 2, dimensions: 3, dtype: "float16-le", cardIds: ["one", "two"] }, new Uint8Array(4)), /does not match/);
  assert.throws(() => createTypedEmbeddingIndex({ ...base, count: 2, dimensions: 1, dtype: "float16-le", cardIds: ["same", "same"] }, new Uint8Array(4)), /unique/);
  assert.throws(() => createTypedEmbeddingIndex({ ...base, normalized: false, count: 1, dimensions: 1, dtype: "float16-le", cardIds: ["one"] }, Uint8Array.from([0, 0x3c])), /explicitly declare/);
  assert.throws(() => createTypedEmbeddingIndex({ ...base, count: 1, dimensions: 1, dtype: "float16-le", cardIds: ["one"] }, Uint8Array.from([0, 0x7e])), /non-finite/);
  assert.throws(() => createTypedEmbeddingIndex({ ...base, count: 1, dimensions: 2, dtype: "float16-le", cardIds: ["one"] }, new Uint8Array(4)), /not L2-normalized/);
  assert.deepEqual(searchEmbeddingIndex([Number.NaN, 1], { dimensions: 2, cards: [] }), []);
});
