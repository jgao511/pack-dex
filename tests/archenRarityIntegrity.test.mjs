import assert from "node:assert/strict";
import test from "node:test";
import { sets } from "../src/data/sets.js";
import {
  generateNormalPackOnly,
  getFinalSlotWeight,
  getPackPools,
  getRarityCategory,
} from "../src/utils/packGenerator.js";

test("White Flare Archen identities remain distinct and use their canonical pools", () => {
  const set = sets.find((candidate) => candidate.id === "white-flare");
  const archen50 = set.cards.find((card) => card.name === "Archen" && String(card.number) === "50");
  const archen131 = set.cards.find((card) => card.name === "Archen" && String(card.number) === "131");
  assert.ok(archen50);
  assert.ok(archen131);
  assert.notEqual(archen50.id, archen131.id);
  assert.equal(getRarityCategory(archen50, set), "uncommon");
  assert.equal(getRarityCategory(archen131, set), "illustrationRare");

  const pools = getPackPools(set);
  assert.ok(pools.uncommonPool.some((card) => card.id === archen50.id));
  assert.ok(!pools.commonPool.some((card) => card.id === archen131.id));
  assert.ok(!pools.uncommonPool.some((card) => card.id === archen131.id));
  assert.ok(pools.finalSlotPool.some((card) => card.id === archen131.id));
  assert.ok(getFinalSlotWeight(archen131, undefined, set) > 0);
});

test("large White Flare simulation never emits Archen 131 as common or uncommon", () => {
  const set = sets.find((candidate) => candidate.id === "white-flare");
  for (let index = 0; index < 200; index += 1) {
    for (const card of generateNormalPackOnly(set)) {
      if (String(card.number) !== "131" || card.name !== "Archen") continue;
      assert.equal(getRarityCategory(card, set), "illustrationRare");
    }
  }
});
