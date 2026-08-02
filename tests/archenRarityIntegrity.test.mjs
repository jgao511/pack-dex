import assert from "node:assert/strict";
import test from "node:test";
import { sets } from "../src/data/sets.js";
import {
  generateNormalPackOnly,
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
});

test("large White Flare simulation never emits Archen 131 as common or uncommon", () => {
  const set = sets.find((candidate) => candidate.id === "white-flare");
  let observed = 0;
  for (let index = 0; index < 3_000; index += 1) {
    for (const card of generateNormalPackOnly(set)) {
      if (String(card.number) !== "131" || card.name !== "Archen") continue;
      observed += 1;
      assert.equal(getRarityCategory(card, set), "illustrationRare");
    }
  }
  assert.ok(observed > 0, "simulation should sample Archen 131 from the Illustration Rare pool");
});
