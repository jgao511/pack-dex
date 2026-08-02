import assert from "node:assert/strict";
import test from "node:test";
import { sets } from "../src/data/sets.js";
import {
  generateNormalPackOnly,
  getDisplayRarity,
  getPackPools,
  getRarityCategory,
  isPullEligibleCard,
} from "../src/utils/packGenerator.js";

const WRONG_SET_CARDS = {
  "sun-moon": {
    excluded: ["sun-moon-151-moon-sun-badge"],
    canonical: ["sun-moon-151-lapras-gx"],
  },
  "ultra-prism": {
    excluded: [
      "ultra-prism-111-prism-tower",
      "ultra-prism-132-amarys",
      "ultra-prism-133-atticus",
      "ultra-prism-134-atticus",
      "ultra-prism-135-brassius",
      "ultra-prism-136-eri",
      "ultra-prism-137-friends-in-paldea",
      "ultra-prism-138-giacomo",
      "ultra-prism-139-larry-s-skill",
      "ultra-prism-140-mela",
      "ultra-prism-141-ortega",
      "ultra-prism-142-raifort",
      "ultra-prism-143-tyme",
    ],
    canonical: [
      "ultra-prism-111-shaymin",
      "ultra-prism-132-pal-pad",
      "ultra-prism-133-pok-mon-fan-club",
      "ultra-prism-134-unidentified-fossil",
      "ultra-prism-135-volkner",
      "ultra-prism-136-super-boost-energy",
      "ultra-prism-137-unit-energy-grassfirewater",
      "ultra-prism-138-unit-energy-lightningpsychicmetal",
      "ultra-prism-139-leafeon-gx",
      "ultra-prism-140-pheromosa-gx",
      "ultra-prism-141-glaceon-gx",
      "ultra-prism-142-xurkitree-gx",
      "ultra-prism-143-dawn-wings-necrozma-gx",
    ],
  },
  "team-up": {
    excluded: ["team-up-95-team-rocket-s-pupitar"],
    canonical: ["team-up-95-yveltal"],
  },
  151: {
    excluded: ["151-151-audino"],
    canonical: ["151-151-mew-ex"],
  },
};

const findSet = (setId) => sets.find((set) => set.id === setId);
const findCard = (setId, cardId) => findSet(setId)?.cards.find((card) => card.id === cardId);

test("wrong-set identities remain addressable but cannot enter future pull pools", () => {
  for (const [setId, expected] of Object.entries(WRONG_SET_CARDS)) {
    const set = findSet(setId);
    const eligibleIds = new Set(getPackPools(set).cleanCards.map((card) => card.id));

    for (const cardId of expected.excluded) {
      const card = findCard(setId, cardId);
      assert.ok(card, `${cardId} must remain in the catalog for historical references`);
      assert.equal(card.excludeFromPulls, true);
      assert.equal(isPullEligibleCard(card), false);
      assert.equal(eligibleIds.has(cardId), false, `${cardId} entered a pull pool`);
    }

    for (const cardId of expected.canonical) {
      const card = findCard(setId, cardId);
      assert.ok(card, `${cardId} canonical card is missing`);
      assert.equal(isPullEligibleCard(card), true);
      assert.equal(eligibleIds.has(cardId), true, `${cardId} canonical card was removed`);
    }
  }
});

test("affected-set simulations never award a preserved contaminant identity", () => {
  for (const [setId, expected] of Object.entries(WRONG_SET_CARDS)) {
    const set = findSet(setId);
    const excluded = new Set(expected.excluded);
    for (let index = 0; index < 1_000; index += 1) {
      for (const card of generateNormalPackOnly(set)) {
        assert.equal(excluded.has(card.id), false, `${card.id} was awarded from ${setId}`);
      }
    }
  }
});

test("special rarity metadata is explicit and displays canonically", () => {
  const expectations = [
    ["vivid-voltage", "vivid-voltage-9-celebi-amazing", "Amazing Rare", "ultraRare"],
    ["astral-radiance", "astral-radiance-27-radiant-heatran-radiant", "Radiant Rare", "radiantRare"],
    ["black-bolt", "black-bolt-171-victini", "Black White Rare", "victiniRare"],
    ["white-flare", "white-flare-172-victini", "Black White Rare", "victiniRare"],
    ["mega-evolution", "mega-evolution-187-mega-gardevoir-ex-mega-hyper", "Mega Hyper Rare", "megaHyperRare"],
    ["ascended-heroes", "ascended-heroes-265-mega-froslass-ex-mega-att", "Mega Attack Rare", "megaAttackRare"],
    ["ultra-prism", "ultra-prism-136-super-boost-energy", "Prism Star", "prismStar"],
  ];

  for (const [setId, cardId, rarity, category] of expectations) {
    const set = findSet(setId);
    const card = findCard(setId, cardId);
    assert.equal(card.rarity, rarity);
    assert.equal(card.rarityCategory, category);
    assert.equal(getRarityCategory(card, set), category);
    assert.equal(getDisplayRarity(card, set), rarity);
  }
});

test("Golduck and ordinary Victini cards are not promoted by names or filenames", () => {
  const golduck = findCard("sun-moon", "sun-moon-29-golduck");
  assert.equal(getRarityCategory(golduck, findSet("sun-moon")), "rare");

  const ordinaryVictini = [
    ["guardians-rising", "guardians-rising-10-victini", "holoRare"],
    ["lost-thunder", "lost-thunder-49-victini", "rare"],
    ["obsidian-flames", "obsidian-flames-33-victini-ex", "doubleRare"],
    ["black-bolt", "black-bolt-12-victini", "rare"],
  ];
  for (const [setId, cardId, category] of ordinaryVictini) {
    assert.equal(getRarityCategory(findCard(setId, cardId), findSet(setId)), category);
  }
});

test("no explicit chase rarity enters a Common or Uncommon pool", () => {
  const chaseCategories = new Set([
    "illustrationRare",
    "specialIllustrationRare",
    "ultraRare",
    "secretRare",
    "hyperRare",
    "rainbowRare",
    "blackWhiteRare",
    "victiniRare",
    "megaHyperRare",
    "megaAttackRare",
    "prismStar",
  ]);

  for (const set of sets) {
    const pools = getPackPools(set);
    for (const card of [...pools.commonPool, ...pools.uncommonPool]) {
      assert.equal(chaseCategories.has(getRarityCategory(card, set)), false, `${set.id}:${card.id}`);
    }
  }
});
