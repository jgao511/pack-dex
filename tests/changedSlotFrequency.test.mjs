import assert from "node:assert/strict";
import test from "node:test";

import { sets } from "../src/data/sets.js";
import {
  generateForcedGodPack,
  generateNormalPackOnly,
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
  pickRegularOrSubsetSlot,
} from "../src/utils/packGenerator.js";

// Six standard deviations is a two-sided normal-approximation confidence level
// above 99.999999%. The generator is seeded, so these bounds are deterministic;
// the binomial calculation documents sampling precision without flaky cutoffs.
const CONFIDENCE_Z = 6;
const SUBSET_TRIALS = 15_000;
const PALDEAN_TRIALS = 15_000;
const ASCENDED_TRIALS = 25_000;

const CATEGORY_RARITIES = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  gx: "Rare Holo GX",
  doubleRare: "Double Rare",
  megaDoubleRare: "Double Rare",
  ultraRare: "Ultra Rare",
  fullArt: "Full Art",
  illustrationRare: "Illustration Rare",
  specialIllustrationRare: "Special Illustration Rare",
  hyperRare: "Hyper Rare",
  shinyRare: "Shiny Rare",
  shinyUltraRare: "Shiny Ultra Rare",
  trainerGallery: "Trainer Gallery",
  radiantRare: "Radiant Rare",
  prismStar: "Prism Star",
  aceSpecRare: "ACE SPEC Rare",
  secretRare: "Secret Rare",
  rainbowRare: "Rainbow Rare",
  megaAttackRare: "Mega Attack Rare",
  megaHyperRare: "Mega Hyper Rare",
};

function makeCard(id, rarityCategory, overrides = {}) {
  return {
    id,
    name: `${CATEGORY_RARITIES[rarityCategory] || rarityCategory} ${id}`,
    number: id,
    rarity: CATEGORY_RARITIES[rarityCategory] || rarityCategory,
    rarityCategory,
    image: `/cards/${id}.png`,
    ...overrides,
  };
}

function makeBaseCards(prefix) {
  return [
    ...Array.from({ length: 7 }, (_, index) => makeCard(`${prefix}-c${index}`, "common")),
    ...Array.from({ length: 6 }, (_, index) => makeCard(`${prefix}-u${index}`, "uncommon")),
    ...Array.from({ length: 5 }, (_, index) => makeCard(`${prefix}-r${index}`, "rare")),
  ];
}

function makeFixture(setId, extraCards) {
  return {
    id: setId,
    name: `${setId} changed-slot fixture`,
    cards: [...makeBaseCards(setId), ...extraCards],
  };
}

function findSet(setId) {
  const set = sets.find((candidate) => candidate.id === setId);
  assert.ok(set, `${setId} production set is missing`);
  return set;
}

function withSeed(seed, callback) {
  const originalRandom = Math.random;
  let state = seed >>> 0;

  Math.random = () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };

  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function sixSigmaHalfWidthPercent(targetPercent, trials) {
  const probability = targetPercent / 100;
  return CONFIDENCE_Z * Math.sqrt(probability * (1 - probability) / trials) * 100;
}

function assertBinomialRate({ actualHits, label, targetPercent, trials }) {
  const actualPercent = actualHits / trials * 100;
  const errorPercentPoints = actualPercent - targetPercent;
  const tolerancePercentPoints = sixSigmaHalfWidthPercent(targetPercent, trials);

  assert.ok(
    Math.abs(errorPercentPoints) <= tolerancePercentPoints,
    `${label}: ${actualPercent.toFixed(4)}% vs ${targetPercent.toFixed(4)}%; ` +
      `error ${errorPercentPoints.toFixed(4)}pp exceeds ${CONFIDENCE_Z}σ ` +
      `(${tolerancePercentPoints.toFixed(4)}pp)`
  );

  return {
    label,
    targetPercent,
    actualPercent,
    errorPercentPoints,
    tolerancePercentPoints,
  };
}

function formatDiagnostics(rows, trials) {
  return [
    `seeded trials=${trials}; confidence=${CONFIDENCE_Z}σ`,
    ...rows.map((row) =>
      `${row.label}: target=${row.targetPercent.toFixed(3)}% ` +
      `actual=${row.actualPercent.toFixed(3)}% error=${row.errorPercentPoints.toFixed(3)}pp ` +
      `tolerance=±${row.tolerancePercentPoints.toFixed(3)}pp`
    ),
  ].join("\n");
}

function simulateSubsetFixture(set, trials, seed) {
  const pools = getPackPools(set);
  const hitsById = new Map();
  const hitsByCategory = new Map();

  withSeed(seed, () => {
    for (let index = 0; index < trials; index += 1) {
      const card = pickRegularOrSubsetSlot(pools, set, new Set());
      const category = getRarityCategory(card, set);
      hitsById.set(card.id, (hitsById.get(card.id) || 0) + 1);
      hitsByCategory.set(category, (hitsByCategory.get(category) || 0) + 1);
    }
  });

  return { hitsByCategory, hitsById };
}

function simulatePackFixture(set, trials, seed) {
  const bySlot = Array.from({ length: 10 }, () => new Map());

  withSeed(seed, () => {
    for (let index = 0; index < trials; index += 1) {
      const pack = generateNormalPackOnly(set);
      assert.equal(pack.length, 10, `${set.id} fixture pack length`);
      pack.forEach((card, slotIndex) => {
        const category = getRarityCategory(card, set);
        bySlot[slotIndex].set(category, (bySlot[slotIndex].get(category) || 0) + 1);
      });
    }
  });

  return bySlot;
}

test("production catalogs expose every corrected changed category in its physical slot", () => {
  const prismExpectations = {
    "ultra-prism": [6, 8.72],
    "forbidden-light": [5, 7.91],
    "celestial-storm": [3, 5.47],
    "dragon-majesty": [2, 10.8],
    "lost-thunder": [7, 12.17],
    "team-up": [4, 5.96],
  };
  let prismTotal = 0;

  for (const [setId, [expectedCount, expectedRate]] of Object.entries(prismExpectations)) {
    const set = findSet(setId);
    const pools = getPackPools(set);
    const cards = set.cards.filter((card) => getRarityCategory(card, set) === "prismStar");
    assert.equal(cards.length, expectedCount, `${setId} Prism Star count`);
    for (const card of cards) {
      assert.equal(getSubsetSlotWeight(card, set), expectedRate, card.id);
      assert.equal(pools.subsetPool.some((candidate) => candidate.id === card.id), true, card.id);
      assert.equal(isCardAllowedInPackSlot(card, 8, set), true, `${card.id} reverse slot`);
      assert.equal(isCardAllowedInPackSlot(card, 9, set), false, `${card.id} final slot`);
    }
    prismTotal += cards.length;
  }
  assert.equal(prismTotal, 27);

  const radiantExpectations = {
    "astral-radiance": 4.88,
    "lost-origin": 5.01,
    "silver-tempest": 4.55,
    "crown-zenith": 4.55,
  };
  let newlyRoutedRadiants = 0;

  for (const [setId, expectedRate] of Object.entries(radiantExpectations)) {
    const set = findSet(setId);
    const pools = getPackPools(set);
    const cards = set.cards.filter((card) => getRarityCategory(card, set) === "radiantRare");
    assert.equal(cards.length, 3, `${setId} Radiant count`);
    for (const card of cards) {
      assert.equal(getSubsetSlotWeight(card, set), expectedRate, card.id);
      assert.equal(pools.subsetPool.some((candidate) => candidate.id === card.id), true, card.id);
      assert.equal(isCardAllowedInPackSlot(card, 8, set), true, `${card.id} reverse slot`);
      assert.equal(isCardAllowedInPackSlot(card, 9, set), false, `${card.id} final slot`);
    }
    newlyRoutedRadiants += cards.length;
  }
  assert.equal(newlyRoutedRadiants, 12);

  const shroudedFable = findSet("shrouded-fable");
  const aceSpecCards = shroudedFable.cards.filter(
    (card) => getRarityCategory(card, shroudedFable) === "aceSpecRare"
  );
  assert.equal(aceSpecCards.length, 3);
  for (const card of aceSpecCards) {
    assert.equal(getSubsetSlotWeight(card, shroudedFable), 5, card.id);
    assert.equal(isCardAllowedInPackSlot(card, 7, shroudedFable), true, `${card.id} first reverse`);
    assert.equal(isCardAllowedInPackSlot(card, 8, shroudedFable), false, `${card.id} second reverse`);
    assert.equal(isCardAllowedInPackSlot(card, 9, shroudedFable), false, `${card.id} final slot`);
  }

  const cosmicEclipse = findSet("cosmic-eclipse");
  const characterSecrets = cosmicEclipse.cards.filter((card) => {
    const number = Number.parseInt(String(card.number), 10);
    return number >= 237 && number <= 248;
  });
  assert.equal(characterSecrets.length, 12);
  for (const card of characterSecrets) {
    assert.equal(getSubsetType(card, cosmicEclipse), "characterSecret", card.id);
    assert.equal(getSubsetSlotWeight(card, cosmicEclipse), 10, card.id);
    assert.equal(isCardAllowedInPackSlot(card, 8, cosmicEclipse), true, `${card.id} reverse slot`);
    assert.equal(isCardAllowedInPackSlot(card, 9, cosmicEclipse), false, `${card.id} final slot`);
  }

  const shiningFates = findSet("shining-fates");
  const shinyVault = shiningFates.cards.filter((card) => /^SV\d+$/u.test(String(card.number)));
  const babyShinies = shinyVault.filter(
    (card) => Number.parseInt(String(card.number).slice(2), 10) < 105
  );
  const premiumShinies = shinyVault.filter((card) => {
    const number = Number.parseInt(String(card.number).slice(2), 10);
    return number >= 105 && number <= 122;
  });
  assert.equal(babyShinies.length, 104);
  assert.equal(premiumShinies.length, 18);
  for (const card of babyShinies) assert.equal(getSubsetSlotWeight(card, shiningFates), 20.2, card.id);
  for (const card of premiumShinies) assert.equal(getSubsetSlotWeight(card, shiningFates), 8, card.id);

  const paldeanFates = findSet("paldean-fates");
  const paldeanIllustrationRares = paldeanFates.cards.filter((card) =>
    ["224", "225", "226"].includes(String(card.number))
  );
  assert.equal(paldeanIllustrationRares.length, 3);
  for (const card of paldeanIllustrationRares) {
    assert.equal(getRarityCategory(card, paldeanFates), "illustrationRare", card.id);
    assert.equal(isCardAllowedInPackSlot(card, 8, paldeanFates), true, `${card.id} second reverse`);
    assert.equal(isCardAllowedInPackSlot(card, 9, paldeanFates), false, `${card.id} final slot`);
  }
  assert.equal(
    paldeanFates.cards.filter((card) => getRarityCategory(card, paldeanFates) === "shinyUltraRare").length,
    12
  );

  const ascendedHeroes = findSet("ascended-heroes");
  const megaAttackRares = ascendedHeroes.cards.filter(
    (card) => getRarityCategory(card, ascendedHeroes) === "megaAttackRare"
  );
  assert.equal(megaAttackRares.length, 7);
  for (const card of megaAttackRares) {
    assert.equal(isCardAllowedInPackSlot(card, 8, ascendedHeroes), false, `${card.id} second foil`);
    assert.equal(isCardAllowedInPackSlot(card, 9, ascendedHeroes), true, `${card.id} final rare`);
  }

  const megaHyperExpectations = {
    "mega-evolution": 2,
    "phantasmal-flames": 1,
    "ascended-heroes": 2,
    "perfect-order": 1,
    "chaos-rising": 1,
    "pitch-black": 1,
  };
  for (const [setId, expectedCount] of Object.entries(megaHyperExpectations)) {
    const set = findSet(setId);
    const cards = set.cards.filter((card) => getRarityCategory(card, set) === "megaHyperRare");
    assert.equal(cards.length, expectedCount, `${setId} Mega Hyper Rare count`);
    for (const card of cards) {
      assert.equal(isCardAllowedInPackSlot(card, 8, set), true, `${card.id} second foil`);
      assert.equal(isCardAllowedInPackSlot(card, 9, set), false, `${card.id} final rare`);
    }
  }
});

test("Prism Star, Radiant, ACE SPEC, Cosmic, and Shining subset rates are realized", (t) => {
  const cases = [
    {
      label: "Ultra Prism / Prism Star",
      seed: 0x51a71e01,
      set: makeFixture("ultra-prism", [
        makeCard("ultra-prism-prism", "prismStar", { name: "Fixture Prism Star" }),
      ]),
      expectations: [{ id: "ultra-prism-prism", targetPercent: 8.72 }],
    },
    {
      label: "Forbidden Light / Prism Star",
      seed: 0x51a71e02,
      set: makeFixture("forbidden-light", [
        makeCard("forbidden-light-prism", "prismStar", { name: "Fixture Prism Star" }),
      ]),
      expectations: [{ id: "forbidden-light-prism", targetPercent: 7.91 }],
    },
    {
      label: "Celestial Storm / Prism Star",
      seed: 0x51a71e03,
      set: makeFixture("celestial-storm", [
        makeCard("celestial-storm-prism", "prismStar", { name: "Fixture Prism Star" }),
      ]),
      expectations: [{ id: "celestial-storm-prism", targetPercent: 5.47 }],
    },
    {
      label: "Dragon Majesty / Prism Star",
      seed: 0x51a71e04,
      set: makeFixture("dragon-majesty", [
        makeCard("dragon-majesty-prism", "prismStar", { name: "Fixture Prism Star" }),
      ]),
      expectations: [{ id: "dragon-majesty-prism", targetPercent: 10.8 }],
    },
    {
      label: "Lost Thunder / Prism Star",
      seed: 0x51a71e05,
      set: makeFixture("lost-thunder", [
        makeCard("lost-thunder-prism", "prismStar", { name: "Fixture Prism Star" }),
      ]),
      expectations: [{ id: "lost-thunder-prism", targetPercent: 12.17 }],
    },
    {
      label: "Team Up / Prism Star",
      seed: 0x51a71e06,
      set: makeFixture("team-up", [
        makeCard("team-up-prism", "prismStar", { name: "Fixture Prism Star" }),
      ]),
      expectations: [{ id: "team-up-prism", targetPercent: 5.96 }],
    },
    {
      label: "Astral Radiance / Radiant + Trainer Gallery",
      seed: 0x51a71e07,
      set: makeFixture("astral-radiance", [
        makeCard("astral-radiance-radiant", "radiantRare", { name: "Radiant Fixture" }),
        makeCard("astral-radiance-gallery", "trainerGallery", { number: "TG01" }),
      ]),
      expectations: [
        { id: "astral-radiance-radiant", targetPercent: 4.88 },
        { id: "astral-radiance-gallery", targetPercent: 12.58 },
      ],
    },
    {
      label: "Lost Origin / Radiant + Trainer Gallery",
      seed: 0x51a71e08,
      set: makeFixture("lost-origin", [
        makeCard("lost-origin-radiant", "radiantRare", { name: "Radiant Fixture" }),
        makeCard("lost-origin-gallery", "trainerGallery", { number: "TG01" }),
      ]),
      expectations: [
        { id: "lost-origin-radiant", targetPercent: 5.01 },
        { id: "lost-origin-gallery", targetPercent: 12.31 },
      ],
    },
    {
      label: "Silver Tempest / Radiant + Trainer Gallery",
      seed: 0x51a71e09,
      set: makeFixture("silver-tempest", [
        makeCard("silver-tempest-radiant", "radiantRare", { name: "Radiant Fixture" }),
        makeCard("silver-tempest-gallery", "trainerGallery", { number: "TG01" }),
      ]),
      expectations: [
        { id: "silver-tempest-radiant", targetPercent: 4.55 },
        { id: "silver-tempest-gallery", targetPercent: 12.23 },
      ],
    },
    {
      label: "Crown Zenith / Radiant + gallery tiers",
      seed: 0x51a71e0a,
      set: makeFixture("crown-zenith", [
        makeCard("crown-radiant", "radiantRare", { name: "Radiant Fixture" }),
        makeCard("crown-gallery", "galarianGallery", { number: "GG01" }),
        makeCard("crown-premium", "galarianGallery", { number: "GG35" }),
        makeCard("crown-gold", "galarianGallery", { number: "GG67" }),
      ]),
      expectations: [
        { id: "crown-radiant", targetPercent: 4.55 },
        { id: "crown-gallery", targetPercent: 22.4 },
        { id: "crown-premium", targetPercent: 12 },
        { id: "crown-gold", targetPercent: 0.8 },
      ],
    },
    {
      label: "Shrouded Fable / ACE SPEC",
      seed: 0x51a71e0b,
      set: makeFixture("shrouded-fable", [
        makeCard("shrouded-fable-ace", "aceSpecRare", { name: "Fixture ACE SPEC" }),
      ]),
      expectations: [{ id: "shrouded-fable-ace", targetPercent: 5 }],
    },
    {
      label: "Cosmic Eclipse / character secret",
      seed: 0x51a71e0c,
      set: makeFixture("cosmic-eclipse", [
        makeCard("cosmic-character", "secretRare", { number: "237" }),
      ]),
      expectations: [{ id: "cosmic-character", targetPercent: 10 }],
    },
    {
      label: "Shining Fates / Shiny Vault tiers",
      seed: 0x51a71e0d,
      set: makeFixture("shining-fates", [
        makeCard("shining-baby", "shinyRare", { number: "SV001", subset: "Shiny Vault" }),
        makeCard("shining-premium", "doubleRare", { number: "SV105", subset: "Shiny Vault" }),
      ]),
      expectations: [
        { id: "shining-baby", targetPercent: 20.2 },
        { id: "shining-premium", targetPercent: 8 },
      ],
    },
  ];
  const rows = [];

  for (const item of cases) {
    const { hitsById } = simulateSubsetFixture(item.set, SUBSET_TRIALS, item.seed);
    for (const expectation of item.expectations) {
      rows.push(assertBinomialRate({
        actualHits: hitsById.get(expectation.id) || 0,
        label: `${item.label} / ${expectation.id}`,
        targetPercent: expectation.targetPercent,
        trials: SUBSET_TRIALS,
      }));
    }
  }

  t.diagnostic(formatDiagnostics(rows, SUBSET_TRIALS));
});

test("Paldean Fates realizes all three independent physical-slot distributions", (t) => {
  const set = makeFixture("paldean-fates", [
    makeCard("paldean-shiny", "shinyRare", { name: "Shiny Fixture" }),
    makeCard("paldean-shiny-ultra", "shinyUltraRare", { name: "Shiny Ultra Fixture" }),
    makeCard("paldean-ir", "illustrationRare"),
    makeCard("paldean-sir", "specialIllustrationRare"),
    makeCard("paldean-hyper", "hyperRare"),
    makeCard("paldean-double", "doubleRare"),
    makeCard("paldean-ultra", "ultraRare"),
  ]);
  const bySlot = simulatePackFixture(set, PALDEAN_TRIALS, 0x0fa1dea5);
  const expectations = [
    [7, "shinyRare", 25.44],
    [7, "shinyUltraRare", 7.72],
    [8, "illustrationRare", 7.22],
    [8, "specialIllustrationRare", 1.72],
    [8, "hyperRare", 1.61],
    [9, "doubleRare", 15.89],
    [9, "ultraRare", 6.61],
  ];
  const rows = expectations.map(([slot, category, targetPercent]) => assertBinomialRate({
    actualHits: bySlot[slot].get(category) || 0,
    label: `Paldean Fates slot ${slot + 1} ${category}`,
    targetPercent,
    trials: PALDEAN_TRIALS,
  }));

  assert.deepEqual(getSubsetSlotConfig(set).rates, {
    normal: 66.84,
    shinyRare: 25.44,
    shinyUltraRare: 7.72,
  });
  assert.deepEqual(getModernSVSecondFoilSlotWeights(set), {
    normal: 89.45,
    illustrationRare: 7.22,
    specialIllustrationRare: 1.72,
    hyperRare: 1.61,
  });
  assert.deepEqual(getModernSVRareSlotWeights(set), {
    rare: 77.5,
    doubleRare: 15.89,
    ultraRare: 6.61,
  });
  t.diagnostic(formatDiagnostics(rows, PALDEAN_TRIALS));
});

test("Cosmic character secrets move to reverse without diluting gold secrets", (t) => {
  const set = makeFixture("cosmic-eclipse", [
    makeCard("cosmic-fixture-character", "secretRare", { number: "237" }),
    makeCard("cosmic-fixture-gold", "secretRare", { number: "263" }),
    makeCard("cosmic-fixture-gx", "gx"),
    makeCard("cosmic-fixture-full-art", "fullArt"),
    makeCard("cosmic-fixture-rainbow", "rainbowRare"),
  ]);
  const trials = 15_000;
  const bySlot = simulatePackFixture(set, trials, 0xc05c1c01);
  const rows = [
    assertBinomialRate({
      actualHits: bySlot[8].get("secretRare") || 0,
      label: "Cosmic Eclipse slot 9 character secret",
      targetPercent: 10,
      trials,
    }),
    assertBinomialRate({
      actualHits: bySlot[9].get("secretRare") || 0,
      label: "Cosmic Eclipse slot 10 gold secret",
      targetPercent: 3,
      trials,
    }),
  ];

  t.diagnostic(formatDiagnostics(rows, trials));
});

test("Ascended Heroes realizes MAR and MHR alongside source companion rarity weights", (t) => {
  const set = makeFixture("ascended-heroes", [
    makeCard("ascended-ir", "illustrationRare"),
    makeCard("ascended-sir", "specialIllustrationRare"),
    makeCard("ascended-mhr", "megaHyperRare"),
    makeCard("ascended-double", "doubleRare"),
    makeCard("ascended-mega-double", "megaDoubleRare"),
    makeCard("ascended-ultra", "ultraRare"),
    makeCard("ascended-mar", "megaAttackRare"),
  ]);
  const bySlot = simulatePackFixture(set, ASCENDED_TRIALS, 0xa5ce0ded);
  const expectations = [
    [8, "illustrationRare", 11.25],
    [8, "specialIllustrationRare", 1.44],
    [8, "megaHyperRare", 0.19],
    [9, "doubleRare", 13.58],
    [9, "megaDoubleRare", 6.79],
    [9, "ultraRare", 4.81],
    [9, "megaAttackRare", 3.47],
  ];
  const rows = expectations.map(([slot, category, targetPercent]) => assertBinomialRate({
    actualHits: bySlot[slot].get(category) || 0,
    label: `Ascended Heroes slot ${slot + 1} ${category}`,
    targetPercent,
    trials: ASCENDED_TRIALS,
  }));

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
  t.diagnostic(formatDiagnostics(rows, ASCENDED_TRIALS));
});

test("Mega Evolution moves MHR to the second foil while preserving simulator weights", (t) => {
  const set = makeFixture("mega-evolution", [
    makeCard("mega-evolution-ir", "illustrationRare"),
    makeCard("mega-evolution-sir", "specialIllustrationRare"),
    makeCard("mega-evolution-mhr", "megaHyperRare"),
    makeCard("mega-evolution-double", "megaDoubleRare"),
    makeCard("mega-evolution-ultra", "ultraRare"),
  ]);
  const trials = 25_000;
  const bySlot = simulatePackFixture(set, trials, 0x4d454741);
  const expectations = [
    [8, "illustrationRare", 6],
    [8, "specialIllustrationRare", 2],
    [8, "megaHyperRare", 0.2],
    [9, "megaDoubleRare", 18],
    [9, "ultraRare", 6],
  ];
  const rows = expectations.map(([slot, category, targetPercent]) => assertBinomialRate({
    actualHits: bySlot[slot].get(category) || 0,
    label: `Mega Evolution slot ${slot + 1} ${category}`,
    targetPercent,
    trials,
  }));

  t.diagnostic(formatDiagnostics(rows, trials));
});

test("Prismatic demi-god packs realize the complete 32-card SIR pool", (t) => {
  const set = findSet("prismatic-evolutions");
  const sirCards = set.cards.filter(
    (card) => getRarityCategory(card, set) === "specialIllustrationRare"
  );
  const expectedIds = new Set(sirCards.map((card) => card.id));
  const observedIds = new Set();
  const packs = 256;

  assert.equal(sirCards.length, 32, "production Prismatic SIR count");
  withSeed(0xd3a190d5, () => {
    for (let index = 0; index < packs; index += 1) {
      const pack = generateForcedGodPack(set, undefined, "PRISMATIC_DEMI_GOD_PACK");
      const hits = pack.slice(-3);
      assert.equal(hits.length, 3);
      assert.equal(new Set(hits.map((card) => card.id)).size, 3, `pack ${index} duplicate SIR`);
      for (const card of hits) {
        assert.equal(getRarityCategory(card, set), "specialIllustrationRare", card.id);
        assert.equal(expectedIds.has(card.id), true, `${card.id} is outside the production SIR pool`);
        observedIds.add(card.id);
      }
    }
  });

  assert.deepEqual([...observedIds].sort(), [...expectedIds].sort());
  t.diagnostic(`seeded forced packs=${packs}; observed production SIRs=${observedIds.size}/32`);
});
