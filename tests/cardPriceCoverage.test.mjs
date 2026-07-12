import assert from "node:assert/strict";
import test from "node:test";
import { calculateValueCoverage } from "../src/lib/priceCoverage.js";

const cards = [
  { setId: "test", card: { id: "test-1", number: "1", name: "Priced" }, count: 2 },
  { setId: "test", card: { id: "test-2", number: "2", name: "Missing" }, count: 1 },
];
const prices = new Map([["test-1", 3.5]]);
const coverage = (items, priceMap = prices) => calculateValueCoverage(items, (item) => priceMap.get(item.card.id));

test("reports complete totals only when every card has a valid price", () => {
  const complete = coverage([cards[0]]);
  assert.deepEqual(complete, { totalValue: 7, pricedCards: 1, totalCards: 1, isComplete: true });
});

test("reports partial coverage without treating missing prices as zero", () => {
  const partial = coverage(cards);
  assert.deepEqual(partial, { totalValue: 7, pricedCards: 1, totalCards: 2, isComplete: false });
});

test("an entirely unpriced group has no displayable dollar value", () => {
  const missing = coverage([cards[1]], new Map());
  assert.deepEqual(missing, { totalValue: 0, pricedCards: 0, totalCards: 1, isComplete: false });
});
