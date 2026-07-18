import assert from "node:assert/strict";
import test from "node:test";
import { selectFeaturedPull } from "../src/utils/rarityRank.js";
import { sets } from "../src/data/sets.js";

const card = (rarity, name = rarity) => ({ id: `${name}-${rarity}`, name, rarity });

test("featured pull uses normalized significance before reveal position", () => {
  assert.equal(selectFeaturedPull([card("Special Illustration Rare"), card("Double Rare")]).index, 0);
  assert.equal(selectFeaturedPull([card("Illustration Rare"), card("Double Rare")]).index, 0);
  assert.equal(selectFeaturedPull([card("Special Illustration Rare"), card("Ultra Rare")]).index, 0);
  assert.equal(selectFeaturedPull([card("Illustration Rare"), card("Ultra Rare")]).index, 1);
  assert.equal(selectFeaturedPull([card("Mega Hyper Rare"), card("Special Illustration Rare")]).index, 0);
});

test("featured pull breaks equal tiers by later reveal and preserves pack order", () => {
  const cards = [card("Rare", "first"), card("Rare", "second")];
  const before = [...cards];
  assert.equal(selectFeaturedPull(cards).index, 1);
  assert.deepEqual(cards, before);
  assert.equal(selectFeaturedPull([card("Unknown"), card("")]).index, 1);
  assert.equal(selectFeaturedPull([]), null);
});

test("featured pull supports historical aliases and never uses price", () => {
  assert.equal(selectFeaturedPull([card("Rare Ultra"), card("Double Rare")]).index, 0);
  assert.equal(selectFeaturedPull([card("Secret Rare"), card("Rare Holo")]).index, 0);
  const cheapSir = { ...card("Special Illustration Rare"), marketPriceUsd: 1 };
  const expensiveDouble = { ...card("Double Rare"), marketPriceUsd: 9999 };
  assert.equal(selectFeaturedPull([cheapSir, expensiveDouble]).index, 0);
});

test("mobile pack summary and public share use the same featured-pull helper", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const share = await readFile(new URL("../mobile-app/src/PublicPullSharePage.jsx", import.meta.url), "utf8");
  assert.match(app, /selectFeaturedPull\(pack, selectedSet\)/);
  assert.match(app, /index === featuredPull\?\.index/);
  assert.match(share, /selectFeaturedPull\(state\.share\.cards/);
});

test("the supplied historical Pitch Black share features its slot-nine SIR", () => {
  const set = sets.find((entry) => entry.id === "pitch-black");
  const ids = [
    "pitch-black-32-jynx", "pitch-black-71-bombirdier", "pitch-black-13-goldeen", "pitch-black-69-type-null",
    "pitch-black-39-dhelmise", "pitch-black-34-banette", "pitch-black-68-toucannon", "pitch-black-46-drilbur",
    "pitch-black-114-mega-zeraora-ex", "pitch-black-12-armarouge",
  ];
  const cardMap = new Map(set.cards.map((entry) => [entry.id, entry]));
  const featured = selectFeaturedPull(ids.map((id) => cardMap.get(id)), set);
  assert.equal(featured.index, 8);
  assert.equal(featured.card.name, "Mega Zeraora ex");
  assert.equal(featured.card.rarity, "Special Illustration Rare");
});
