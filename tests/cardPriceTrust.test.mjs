import assert from "node:assert/strict";
import test from "node:test";
import {
  TRUSTED_PRICE_MAX_AGE_MS,
  getCardDisplayPrice,
  getCollectionEstimatedValue,
  getCollectionValueCoverage,
  indexPriceRows,
} from "../src/lib/cardPrices.js";

const now = Date.parse("2026-08-03T20:00:00Z");
const card = { id: "packdex-card", sourceCardId: "api-card", number: "1", name: "Card" };
const owned = [{ setId: "set", card, quantity: 2 }];

test("current accepted prices contribute to value and coverage exactly once", () => {
  const priceMap = indexPriceRows([{
    card_id: "api-card",
    set_id: "set",
    card_number: "1",
    name: "Card",
    market_price_usd: 12.5,
    synced_at: new Date(now - 1_000).toISOString(),
  }], { now });
  assert.equal(getCollectionEstimatedValue(owned, { set: priceMap }), 25);
  assert.deepEqual(getCollectionValueCoverage(owned, { set: priceMap }), {
    totalValue: 25,
    pricedCards: 1,
    totalCards: 1,
    isComplete: true,
  });
});

test("stale prices are unavailable but retain their canonical marketplace link", () => {
  const priceMap = indexPriceRows([{
    card_id: "api-card",
    set_id: "set",
    card_number: "1",
    name: "Card",
    market_price_usd: 99,
    tcgplayer_url: "https://prices.pokemontcg.io/tcgplayer/api-card",
    synced_at: new Date(now - TRUSTED_PRICE_MAX_AGE_MS - 1).toISOString(),
  }], { now });
  const price = getCardDisplayPrice(card, priceMap, "set");
  assert.equal(price.marketPriceUsd, null);
  assert.equal(price.tcgplayerUrl, "https://prices.pokemontcg.io/tcgplayer/api-card");
  assert.equal(getCollectionEstimatedValue(owned, { set: priceMap }), 0);
  assert.equal(getCollectionValueCoverage(owned, { set: priceMap }).pricedCards, 0);
});

test("URL-only identity rows are indexed without becoming zero-dollar prices", () => {
  const priceMap = indexPriceRows([{
    card_id: "api-card",
    set_id: "set",
    card_number: "1",
    name: "Card",
    market_price_usd: null,
    tcgplayer_url: "https://prices.pokemontcg.io/tcgplayer/api-card",
    synced_at: new Date(now).toISOString(),
  }], { now });
  const price = getCardDisplayPrice(card, priceMap, "set");
  assert.equal(price.marketPriceUsd, null);
  assert.equal(price.tcgplayerUrl.endsWith("/api-card"), true);
  assert.equal(getCollectionValueCoverage(owned, { set: priceMap }).isComplete, false);
});
