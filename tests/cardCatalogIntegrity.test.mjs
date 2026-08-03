import assert from "node:assert/strict";
import test from "node:test";
import { getSetCardById, legacyCardsById, sets } from "../src/data/sets.js";
import {
  getCardCount,
  getCollectionVisibleCards,
  getPullableCollectionCards,
  getSetCollectionProgress,
  resolveSavedCollectionCard,
} from "../src/utils/collectionStorage.js";
import {
  generateForcedGodPack,
  generateNormalPackOnly,
  getDisplayRarity,
  getFinalSlotWeights,
  getMegaRareSlotWeights,
  getMegaSecondFoilSlotWeights,
  getModernSVRareSlotWeights,
  getModernSVSecondFoilSlotWeights,
  getPackPools,
  getRarityCategory,
  getSubsetSlotConfig,
  getSubsetSlotWeight,
  getSubsetType,
  isCardAllowedInPackSlot,
  pickFinalSlotCard,
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

test("wrong-set identities live only in the legacy compatibility catalog", () => {
  for (const [setId, expected] of Object.entries(WRONG_SET_CARDS)) {
    const set = findSet(setId);
    const eligibleIds = new Set(getPackPools(set).cleanCards.map((card) => card.id));

    for (const cardId of expected.excluded) {
      assert.equal(findCard(setId, cardId), undefined, `${cardId} remained in canonical set.cards`);
      assert.equal(getSetCardById(set, cardId), null, `${cardId} resolved without legacy opt-in`);

      const card = getSetCardById(set, cardId, { includeLegacy: true });
      assert.ok(card, `${cardId} must remain addressable for historical references`);
      assert.equal(card.legacyQuarantine, true);
      assert.equal(set.legacyCards.includes(card), true);
      assert.equal(legacyCardsById.get(cardId)?.legacyQuarantine, true);
      assert.equal(eligibleIds.has(cardId), false, `${cardId} entered a pull pool`);
    }

    for (const cardId of expected.canonical) {
      const card = findCard(setId, cardId);
      assert.ok(card, `${cardId} canonical card is missing`);
      assert.equal(eligibleIds.has(cardId), true, `${cardId} canonical card was removed`);
    }
  }
});

test("saved legacy collection rows remain visible without affecting canonical progress", () => {
  const set = findSet("team-up");
  const cardId = "team-up-95-team-rocket-s-pupitar";
  const collection = {
    [set.id]: {
      [cardId]: { count: 2, firstCollectedAt: 1, lastCollectedAt: 2 },
    },
  };
  const legacyCard = resolveSavedCollectionCard(set, cardId);
  const pullableCards = getPullableCollectionCards(set);
  const visibleCards = getCollectionVisibleCards(set, collection);

  assert.ok(legacyCard);
  assert.equal(legacyCard.legacyQuarantine, true);
  assert.equal(getCardCount(collection, legacyCard, set.id), 2);
  assert.equal(visibleCards.some((card) => card.id === cardId), true);
  assert.equal(visibleCards.length, pullableCards.length + 1);
  assert.deepEqual(getSetCollectionProgress(collection, set), {
    collected: 0,
    total: pullableCards.length,
    percent: 0,
  });
});

test("affected-set simulations never award a preserved contaminant identity", () => {
  for (const [setId, expected] of Object.entries(WRONG_SET_CARDS)) {
    const set = findSet(setId);
    const excluded = new Set(expected.excluded);
    for (let index = 0; index < 100; index += 1) {
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

const SUBSET_REACHABILITY = {
  "astral-radiance": {
    rate: 4.88,
    ids: [
      "astral-radiance-27-radiant-heatran-radiant",
      "astral-radiance-46-radiant-greninja-radiant",
      "astral-radiance-81-radiant-hawlucha-radiant",
    ],
  },
  "lost-origin": {
    rate: 5.01,
    ids: [
      "lost-origin-69-radiant-gardevoir-radiant",
      "lost-origin-123-radiant-hisuian-sneasler-radiant",
      "lost-origin-124-radiant-steelix-radiant",
    ],
  },
  "silver-tempest": {
    rate: 4.55,
    ids: [
      "silver-tempest-16-radiant-tsareena-radiant",
      "silver-tempest-59-radiant-alakazam-radiant",
      "silver-tempest-120-radiant-jirachi-radiant",
    ],
  },
  "crown-zenith": {
    rate: 4.55,
    ids: [
      "crown-zenith-20-radiant-charizard-radiant",
      "crown-zenith-51-radiant-charjabug-radiant",
      "crown-zenith-105-radiant-eternatus-radiant",
    ],
  },
  "shrouded-fable": {
    rate: 5,
    ids: [
      "shrouded-fable-58-dangerous-laser-ace-spec",
      "shrouded-fable-60-neutralization-zone-ace-spec",
      "shrouded-fable-62-pok-vital-a-ace-spec",
    ],
  },
};

test("Radiant and ACE SPEC cards have a positive configured subset path", () => {
  for (const [setId, expected] of Object.entries(SUBSET_REACHABILITY)) {
    const set = findSet(setId);
    const pools = getPackPools(set);
    const subsetIds = new Set(pools.subsetPool.map((card) => card.id));

    for (const cardId of expected.ids) {
      const card = findCard(setId, cardId);
      assert.ok(card, `${cardId} is missing`);
      assert.match(getSubsetType(card, set), /^(?:radiant|aceSpec)$/u);
      assert.equal(getSubsetSlotWeight(card, set), expected.rate);
      assert.equal(subsetIds.has(cardId), true, `${cardId} is absent from the subset pool`);
      assert.equal(pools.mainCards.some((item) => item.id === cardId), false);
    }
  }
});

test("all 27 Sun & Moon Prism Stars use their set-specific reverse-slot rate", () => {
  const expectations = {
    "ultra-prism": [6, 8.72],
    "forbidden-light": [5, 7.91],
    "celestial-storm": [3, 5.47],
    "dragon-majesty": [2, 10.8],
    "lost-thunder": [7, 12.17],
    "team-up": [4, 5.96],
  };
  let total = 0;

  for (const [setId, [expectedCount, expectedRate]] of Object.entries(expectations)) {
    const set = findSet(setId);
    const prismCards = set.cards.filter((card) => getRarityCategory(card, set) === "prismStar");
    assert.equal(prismCards.length, expectedCount, `${setId} Prism Star count`);
    for (const card of prismCards) {
      assert.equal(getSubsetType(card, set), "prismStar");
      assert.equal(getSubsetSlotWeight(card, set), expectedRate, `${setId}:${card.id}`);
    }
    total += prismCards.length;
  }

  assert.equal(total, 27);
});

test("Cosmic Eclipse character secrets use only the configured reverse subset slot", () => {
  const set = findSet("cosmic-eclipse");
  const pools = getPackPools(set);
  const characterSecrets = set.cards.filter((card) => {
    const number = Number.parseInt(String(card.number), 10);
    return number >= 237 && number <= 248;
  });
  const goldSecrets = set.cards.filter((card) => {
    const number = Number.parseInt(String(card.number), 10);
    return number >= 263 && number <= 271;
  });

  assert.equal(characterSecrets.length, 12);
  for (const card of characterSecrets) {
    assert.equal(getSubsetType(card, set), "characterSecret", card.id);
    assert.equal(getSubsetSlotWeight(card, set), 10, card.id);
    assert.equal(pools.subsetPool.some((item) => item.id === card.id), true, card.id);
    assert.equal(pools.mainCards.some((item) => item.id === card.id), false, card.id);
    assert.equal(isCardAllowedInPackSlot(card, 8, set), true, `${card.id} reverse/subset slot`);
    assert.equal(isCardAllowedInPackSlot(card, 9, set), false, `${card.id} final slot`);
  }

  assert.equal(goldSecrets.length, 9);
  for (const card of goldSecrets) {
    assert.equal(getSubsetType(card, set), "", card.id);
    assert.equal(getSubsetSlotWeight(card, set), 0, card.id);
    assert.equal(pools.finalSlotPool.some((item) => item.id === card.id), true, card.id);
    assert.equal(isCardAllowedInPackSlot(card, 8, set), false, `${card.id} reverse/subset slot`);
    assert.equal(isCardAllowedInPackSlot(card, 9, set), true, `${card.id} final slot`);
  }
});

test("Shining Fates SV105-SV122 share the premium Shiny Vault bucket", () => {
  const set = findSet("shining-fates");
  const pools = getPackPools(set);
  const vaultCards = set.cards.filter((card) => /^SV\d+$/u.test(String(card.number)));
  const premiumCards = vaultCards.filter((card) => {
    const number = Number.parseInt(String(card.number).slice(2), 10);
    return number >= 105 && number <= 122;
  });
  const babyShinies = vaultCards.filter(
    (card) => Number.parseInt(String(card.number).slice(2), 10) < 105
  );

  assert.equal(premiumCards.length, 18);
  for (const card of premiumCards) {
    assert.equal(getSubsetType(card, set), "shinyVault", card.id);
    assert.equal(getSubsetSlotWeight(card, set), 8, card.id);
    assert.equal(pools.subsetPool.some((item) => item.id === card.id), true, card.id);
    assert.equal(pools.mainCards.some((item) => item.id === card.id), false, card.id);
    assert.equal(isCardAllowedInPackSlot(card, 8, set), true, `${card.id} reverse/subset slot`);
    assert.equal(isCardAllowedInPackSlot(card, 9, set), false, `${card.id} final slot`);
  }

  assert.equal(babyShinies.length, 104);
  for (const card of babyShinies) {
    assert.equal(getRarityCategory(card, set), "shinyRare", card.id);
    assert.equal(getSubsetSlotWeight(card, set), 20.2, card.id);
  }
});

test("ordinary Poké Ball and XY holo names stay in their normal pack channels", () => {
  for (const [setId, cardId, expectedPool] of [
    ["xy0", "xy0-35-poke_ball", "commonPool"],
    ["g1", "g1-67-poke_ball", "uncommonPool"],
    ["xy1", "xy1-17-vivillon", "finalSlotPool"],
    ["xy3", "xy3-3-victreebel", "finalSlotPool"],
    ["xy7", "xy7-12-virizion", "finalSlotPool"],
    ["xy7", "xy7-17-volcarona", "finalSlotPool"],
    ["xy8", "xy8-15-vivillon", "finalSlotPool"],
  ]) {
    const set = findSet(setId);
    const card = findCard(setId, cardId);
    const pools = getPackPools(set);
    assert.equal(getSubsetType(card, set), "", `${setId}:${cardId} was misclassified as a subset`);
    assert.equal(pools[expectedPool].some((item) => item.id === cardId), true, `${setId}:${cardId}`);
  }
});

test("Paldean Fates models its three independent foil/rare slots", () => {
  const set = findSet("paldean-fates");
  assert.deepEqual(getFinalSlotWeights(undefined, set), {
    rare: 77.5,
    doubleRare: 15.89,
    ultraRare: 6.61,
  });
  assert.deepEqual(getModernSVSecondFoilSlotWeights(set), {
    normal: 89.45,
    illustrationRare: 7.22,
    specialIllustrationRare: 1.72,
    hyperRare: 1.61,
  });
  assert.deepEqual(getSubsetSlotConfig(set).rates, {
    normal: 66.84,
    shinyRare: 25.44,
    shinyUltraRare: 7.72,
  });

  for (const number of ["224", "225", "226"]) {
    const card = set.cards.find((item) => String(item.number) === number);
    assert.equal(getRarityCategory(card, set), "illustrationRare");
    assert.equal(getModernSVSecondFoilSlotWeights(set).illustrationRare, 7.22);
    assert.equal(getPackPools(set).finalSlotPool.some((item) => item.id === card.id), true);
  }

  const shinyUltraCards = set.cards.filter((card) => getRarityCategory(card, set) === "shinyUltraRare");
  assert.equal(shinyUltraCards.length, 12);
  for (const card of shinyUltraCards) assert.equal(getSubsetSlotWeight(card, set), 7.72, card.id);
});

test("Scarlet and Violet simulator tuning is split across its two physical hit slots", () => {
  const set = findSet("scarlet-violet");

  assert.deepEqual(getFinalSlotWeights(undefined, set), {
    rare: 60,
    doubleRare: 18,
    ultraRare: 6,
    illustrationRare: 6,
    specialIllustrationRare: 2,
    hyperRare: 1,
  });
  assert.deepEqual(getModernSVSecondFoilSlotWeights(set), {
    normal: 91,
    illustrationRare: 6,
    specialIllustrationRare: 2,
    hyperRare: 1,
  });
  assert.deepEqual(getModernSVRareSlotWeights(set), {
    rare: 76,
    doubleRare: 18,
    ultraRare: 6,
  });
});

test("a configured modern hit with no card pool falls back to an ordinary Rare", () => {
  const set = { id: "scarlet-violet", name: "missing-category fixture" };
  const rare = {
    id: "fixture-rare",
    name: "Fixture Rare",
    number: "1",
    rarity: "Rare",
    rarityCategory: "rare",
  };
  const ultra = {
    id: "fixture-ultra",
    name: "Fixture Ultra Rare",
    number: "2",
    rarity: "Ultra Rare",
    rarityCategory: "ultraRare",
  };
  const originalRandom = Math.random;

  try {
    // 80% lands inside the configured 18% Double Rare interval. This fixture
    // has no Double Rare, so its weight must become an ordinary Rare outcome.
    Math.random = () => 0.8;
    assert.equal(pickFinalSlotCard([rare, ultra], set).id, rare.id);
  } finally {
    Math.random = originalRandom;
  }
});

test("modern subset, art, Hyper Rare, and final-hit cards stay in distinct slots", () => {
  for (const setId of [
    "paldean-fates",
    "temporal-forces",
    "twilight-masquerade",
    "shrouded-fable",
    "stellar-crown",
    "surging-sparks",
  ]) {
    const set = findSet(setId);
    const subsetCard = set.cards.find((card) => getSubsetSlotWeight(card, set) > 0);
    const artCard = set.cards.find((card) => getRarityCategory(card, set) === "illustrationRare");
    const hyperCard = set.cards.find((card) => getRarityCategory(card, set) === "hyperRare");
    const finalHitCard = set.cards.find((card) => getRarityCategory(card, set) === "doubleRare");

    assert.ok(subsetCard, `${setId} subset card`);
    assert.ok(artCard, `${setId} Illustration Rare`);
    assert.ok(hyperCard, `${setId} Hyper Rare`);
    assert.ok(finalHitCard, `${setId} Double Rare`);

    assert.equal(isCardAllowedInPackSlot(subsetCard, 7, set), true, `${setId} subset slot`);
    assert.equal(isCardAllowedInPackSlot(subsetCard, 8, set), false, `${setId} subset leaked into second foil`);
    assert.equal(isCardAllowedInPackSlot(artCard, 7, set), false, `${setId} art leaked into subset slot`);
    assert.equal(isCardAllowedInPackSlot(artCard, 8, set), true, `${setId} art slot`);
    assert.equal(isCardAllowedInPackSlot(artCard, 9, set), false, `${setId} art leaked into final slot`);
    assert.equal(isCardAllowedInPackSlot(hyperCard, 8, set), true, `${setId} Hyper Rare slot`);
    assert.equal(isCardAllowedInPackSlot(hyperCard, 9, set), false, `${setId} Hyper Rare leaked into final slot`);
    assert.equal(isCardAllowedInPackSlot(finalHitCard, 9, set), true, `${setId} final rare slot`);
  }
});

test("Paldean Fates realized slot frequencies stay near the measured per-pack rates", () => {
  const makeCards = (category, rarity, count) => Array.from({ length: count }, (_, index) => ({
    id: `paldean-fixture-${category}-${index}`,
    name: `${rarity} ${index}`,
    number: `${category}-${index}`,
    rarity,
    rarityCategory: category,
    image: `/cards/paldean-fixture-${category}-${index}.png`,
  }));
  const set = {
    id: "paldean-fates",
    name: "Paldean Fates slot-rate fixture",
    cards: [
      ...makeCards("common", "Common", 6),
      ...makeCards("uncommon", "Uncommon", 5),
      ...makeCards("rare", "Rare", 4),
      ...makeCards("shinyRare", "Shiny Rare", 2),
      ...makeCards("shinyUltraRare", "Shiny Ultra Rare", 2),
      ...makeCards("illustrationRare", "Illustration Rare", 2),
      ...makeCards("specialIllustrationRare", "Special Illustration Rare", 2),
      ...makeCards("hyperRare", "Hyper Rare", 2),
      ...makeCards("doubleRare", "Double Rare", 2),
      ...makeCards("ultraRare", "Ultra Rare", 2),
    ],
  };
  const originalRandom = Math.random;
  const packs = 10_000;
  const observed = {
    firstShinyRare: 0,
    firstShinyUltraRare: 0,
    secondIllustrationRare: 0,
    secondSpecialIllustrationRare: 0,
    secondHyperRare: 0,
    finalDoubleRare: 0,
    finalUltraRare: 0,
  };

  try {
    let state = 0x5eedc0de;
    Math.random = () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 2 ** 32;
    };

    for (let index = 0; index < packs; index += 1) {
      const pack = generateNormalPackOnly(set);
      const firstCategory = getRarityCategory(pack[7], set);
      const secondCategory = getRarityCategory(pack[8], set);
      const finalCategory = getRarityCategory(pack[9], set);

      if (firstCategory === "shinyRare") observed.firstShinyRare += 1;
      if (firstCategory === "shinyUltraRare") observed.firstShinyUltraRare += 1;
      if (secondCategory === "illustrationRare") observed.secondIllustrationRare += 1;
      if (secondCategory === "specialIllustrationRare") observed.secondSpecialIllustrationRare += 1;
      if (secondCategory === "hyperRare") observed.secondHyperRare += 1;
      if (finalCategory === "doubleRare") observed.finalDoubleRare += 1;
      if (finalCategory === "ultraRare") observed.finalUltraRare += 1;
    }
  } finally {
    Math.random = originalRandom;
  }

  for (const [key, expected] of Object.entries({
    firstShinyRare: 25.44,
    firstShinyUltraRare: 7.72,
    secondIllustrationRare: 7.22,
    secondSpecialIllustrationRare: 1.72,
    secondHyperRare: 1.61,
    finalDoubleRare: 15.89,
    finalUltraRare: 6.61,
  })) {
    const actual = observed[key] / packs * 100;
    // One percentage point is more than four standard deviations for the
    // lower-rate categories in this deterministic 10,000-pack sample.
    assert.ok(Math.abs(actual - expected) <= 1, key + ": " + actual.toFixed(3) + "% vs " + expected + "%");
  }
});

test("Crown Zenith gallery numbers select regular, premium, and gold rates", () => {
  const set = findSet("crown-zenith");
  for (const [number, expectedRate] of [["GG01", 22.4], ["GG35", 12], ["GG67", 0.8]]) {
    const card = set.cards.find((item) => String(item.number).toUpperCase() === number);
    assert.ok(card, number);
    assert.equal(getSubsetSlotWeight(card, set), expectedRate, number);
  }
});

test("Ascended Heroes Mega Attack Rares use the measured normal rare slot", () => {
  const set = findSet("ascended-heroes");
  assert.deepEqual(getMegaSecondFoilSlotWeights(set), {
    normal: 87.12,
    illustrationRare: 11.25,
    specialIllustrationRare: 1.44,
    megaHyperRare: 0.19,
  });
  assert.deepEqual(getMegaRareSlotWeights(set), {
    rare: 71.35,
    doubleRare: 13.58,
    megaDoubleRare: 6.79,
    ultraRare: 4.81,
    megaAttackRare: 3.47,
  });

  const pools = getPackPools(set);
  const attackRares = set.cards.filter((card) => getRarityCategory(card, set) === "megaAttackRare");
  assert.equal(attackRares.length, 7);
  for (const card of attackRares) {
    assert.equal(pools.finalSlotPool.some((candidate) => candidate.id === card.id), true, card.id);
  }
});

test("Prismatic rare packs use the full SIR pool and retain the Master Ball marker", () => {
  const set = findSet("prismatic-evolutions");
  const originalRandom = Math.random;

  try {
    Math.random = () => 0.999999;
    const demiPack = generateForcedGodPack(set, undefined, "PRISMATIC_DEMI_GOD_PACK");
    const demiHits = demiPack.slice(-3);
    assert.equal(demiHits.length, 3);
    assert.equal(demiHits.every((card) => getRarityCategory(card, set) === "specialIllustrationRare"), true);
    assert.equal(
      demiHits.some((card) => !/^(?:eevee|vaporeon|jolteon|flareon|espeon|umbreon|leafeon|glaceon|sylveon) ex$/iu.test(card.name)),
      true,
      "Demigod sampling remained restricted to Eeveelutions"
    );

    const fullPack = generateForcedGodPack(set, undefined, "PRISMATIC_FULL_EEVEELUTION_PACK");
    assert.equal(fullPack[0].name, "Eevee");
    assert.equal(fullPack[0].parallelType, "masterBall");
    assert.equal(fullPack[0].parallelLabel, "Master Ball Foil");
  } finally {
    Math.random = originalRandom;
  }
});
