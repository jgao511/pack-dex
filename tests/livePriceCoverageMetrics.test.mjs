import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLivePriceCoverage } from "../scripts/live-price-coverage-metrics.mjs";

function upstream(id, name, number, prices, url = `https://prices.pokemontcg.io/tcgplayer/${id}`) {
  return {
    id,
    name,
    number,
    rarity: name === "Ambiguous Promo" ? "Promo" : "Common",
    set: { id: "audit1" },
    tcgplayer: { url, updatedAt: "2026/08/03", prices },
  };
}

test("coverage separates priced, URL-only, ambiguous, and unmatched cards", () => {
  const set = {
    id: "audit",
    name: "Audit",
    apiSetIds: ["audit1"],
    cards: [
      { id: "priced", name: "Priced", number: "1", rarity: "Common", sourceSetId: "audit1", sourceCardId: "audit1-1" },
      { id: "url-only", name: "URL Only", number: "2", rarity: "Common", sourceSetId: "audit1", sourceCardId: "audit1-2" },
      { id: "ambiguous-promo", name: "Ambiguous Promo", number: "3", rarity: "Promo", sourceSetId: "audit1", sourceCardId: "audit1-3" },
      { id: "collision-a", name: "Collision A", number: "4", sourceSetId: "audit1" },
      { id: "collision-b", name: "Collision B", number: "4", sourceSetId: "audit1" },
    ],
  };
  const result = summarizeLivePriceCoverage(set, [
    upstream("audit1-1", "Priced", "1", { normal: { market: 1.5 } }),
    upstream("audit1-2", "URL Only", "2", { normal: { market: null, low: 1 } }),
    upstream("audit1-3", "Ambiguous Promo", "3", { normal: { market: 2 }, holofoil: { market: 8 } }),
    upstream("audit1-unknown-4", "Unknown", "4", {}),
    upstream("audit1-unmapped", "Unmapped", "99", { normal: { market: 3 } }),
  ]);
  assert.equal(result.exactCardMatches, 3);
  assert.equal(result.exactApiIdMatches, 3);
  assert.equal(result.cardsWithAcceptedMarketPrice, 1);
  assert.equal(result.cardsWithUrlButNoAcceptedMarketPrice, 2);
  assert.equal(result.skippedVariants, 2);
  assert.equal(result.ambiguousApiCards, 1);
  assert.equal(result.apiCardsWithNoPackDexMapping, 2);
  assert.equal(result.acceptedMarketCoveragePercentage, 20);
});
