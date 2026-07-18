import assert from "node:assert/strict";
import test from "node:test";
import { getCardCollectionKey } from "../src/utils/collectionStorage.js";
import { buildOpenRecommendations } from "../mobile-app/src/explore/recommendations.js";

function fakeSet(id, releaseDate, era, count = 10, extra = {}) {
  return { id, name: id.toUpperCase(), releaseDate, era, pullRateProfile: "test", cards: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index + 1}`, name: `${id} card ${index + 1}`, number: String(index + 1) })), ...extra };
}

const alpha = fakeSet("alpha", "2024-01-01", "Old");
const beta = fakeSet("beta", "2025-01-01", "Middle");
const newest = fakeSet("newest", "2026-01-01", "New");

test("new users and guests receive the dynamically newest openable set", () => {
  const result = buildOpenRecommendations({ sets: [alpha, newest, beta] });
  assert.equal(result.primary.category, "latest");
  assert.equal(result.primary.setId, "newest");
  assert.ok(result.recommendations.some((item) => item.category === "new-era"));
  assert.ok(result.surprise);
});

test("newest selection uses release metadata and excludes unavailable sets", () => {
  const pitchBlack = fakeSet("future-title", "2027-02-01", "Future");
  assert.equal(buildOpenRecommendations({ sets: [newest, pitchBlack] }).primary.setId, "future-title");
  assert.equal(buildOpenRecommendations({ sets: [newest, { ...pitchBlack, isLocked: true }] }).primary.setId, "newest");
});

test("wishlist, near-completion, continuation, and unexplored-era signals produce distinct deterministic recommendations", () => {
  const collection = {
    [alpha.id]: Object.fromEntries(alpha.cards.slice(0, 9).map((card, index) => [getCardCollectionKey(card, alpha.id), { count: index === 0 ? 8 : 1, lastCollectedAt: 100 + index }])),
    [beta.id]: { [getCardCollectionKey(beta.cards[0], beta.id)]: { count: 1, lastCollectedAt: 500 } },
  };
  const input = { sets: [alpha, beta, newest], collection, wishlistEntries: [{ setId: newest.id, cardId: newest.cards[2].id }, { setId: newest.id, cardId: newest.cards[3].id }] };
  const first = buildOpenRecommendations(input);
  const second = buildOpenRecommendations(input);
  assert.deepEqual(first, second);
  assert.ok(first.recommendations.some((item) => item.category === "wishlist" && item.setId === newest.id));
  assert.ok(first.recommendations.some((item) => item.category === "completion" && item.setId === alpha.id));
  assert.equal(new Set(first.recommendations.map((item) => item.setId)).size, first.recommendations.length);
  assert.equal(first.recommendations.find((item) => item.category === "completion").signals.owned, 9, "duplicates do not inflate unique completion");
});

test("empty, incomplete, and prohibited financial or odds language are handled safely", () => {
  assert.deepEqual(buildOpenRecommendations({ sets: [] }), { primary: null, recommendations: [], surprise: null });
  const result = buildOpenRecommendations({ sets: [alpha], collection: { alpha: null }, wishlistEntries: [] });
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /best odds|highest chance|guaranteed pull|expected (?:profit|return)|investment/i);
});
