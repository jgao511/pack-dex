import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generatePack,
  getDisplayRarity,
  getMegaRareSlotWeights,
  getMegaSecondFoilSlotWeights,
  getRarityCategory,
} from "../src/utils/packGenerator.js";
import { getFoilProfile, getHitSoundType } from "../src/utils/foil.js";
import { getRarityVisualLevel } from "../mobile-app/src/utils/rarityPresentation.js";

const ORDINARY_CATEGORIES = new Set(["common", "uncommon", "rare"]);
const SLOT_9_CATEGORIES = new Set([...ORDINARY_CATEGORIES, "illustrationRare", "specialIllustrationRare"]);
const SLOT_10_CATEGORIES = new Set(["rare", "doubleRare", "megaDoubleRare", "ultraRare", "megaHyperRare"]);
const EXISTING_MEGA_SET_IDS = [
  "mega-evolution",
  "phantasmal-flames",
  "ascended-heroes",
  "perfect-order",
  "chaos-rising",
];
const PITCH_BLACK_DOUBLE_RARES = [
  ["4", "Lurantis ex"],
  ["8", "Mega Delphox ex"],
  ["16", "Wailord ex"],
  ["27", "Mega Zeraora ex"],
  ["31", "Mega Slowbro ex"],
  ["38", "Mega Chandelure ex"],
  ["45", "Rampardos ex"],
  ["48", "Mega Darkrai ex"],
  ["55", "Morpeko ex"],
  ["65", "Mega Excadrill ex"],
];

function makeCard(id, rarityCategory, rarity, name = `${rarity} ${id}`) {
  return { id, name, number: id, rarity, rarityCategory, image: `/cards/${id}.png` };
}

function makePitchBlackFixture(finalCategory, slot9Category = "normal") {
  const cards = [
    ...Array.from({ length: 8 }, (_, index) => makeCard(`c${index + 1}`, "common", "Common")),
    ...Array.from({ length: 6 }, (_, index) => makeCard(`u${index + 1}`, "uncommon", "Uncommon")),
    makeCard("ir", "illustrationRare", "Illustration Rare", "Fomantis"),
    makeCard("sir", "specialIllustrationRare", "Special Illustration Rare", "Mega Darkrai ex"),
  ];
  const finalRarities = {
    rare: ["Rare", "Darkrai"],
    doubleRare: ["Double Rare", "Lurantis ex"],
    megaDoubleRare: ["Double Rare", "Mega Delphox ex"],
    ultraRare: ["Ultra Rare", "Misty's Vitality"],
    megaHyperRare: ["Mega Hyper Rare", "Mega Darkrai ex"],
  };
  const [rarity, name] = finalRarities[finalCategory];
  const finalCount = finalCategory === "rare" ? 3 : 1;

  cards.push(
    ...Array.from({ length: finalCount }, (_, index) =>
      makeCard(`final-${index + 1}`, finalCategory, rarity, index === 0 ? name : `${name} ${index + 1}`)
    )
  );

  return {
    set: {
      id: "pitch-black",
      name: "Pitch Black slot fixture",
      pullRateProfile: "megaEvolutionStandard",
      cards,
    },
    slot9Roll: slot9Category === "illustrationRare" ? 0.9 : slot9Category === "specialIllustrationRare" ? 0.995 : 0.5,
  };
}

function withRandomSequence(values, callback) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => values[index++] ?? 0.5;

  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function generateFixturePack(finalCategory, slot9Category = "normal") {
  const { set, slot9Roll } = makePitchBlackFixture(finalCategory, slot9Category);
  const rolls = Array(16).fill(0.5);
  rolls[8] = slot9Roll;
  const pack = withRandomSequence(rolls, () => generatePack(set));

  return { set, pack, categories: pack.map((card) => getRarityCategory(card, set)) };
}

function assertMegaLayout(pack, set) {
  const categories = pack.map((card) => getRarityCategory(card, set));

  assert.equal(pack.length, 10);
  assert.deepEqual(categories.slice(0, 4), ["common", "common", "common", "common"]);
  assert.deepEqual(categories.slice(4, 7), ["uncommon", "uncommon", "uncommon"]);
  assert.ok(ORDINARY_CATEGORIES.has(categories[7]), `slot 8 was ${categories[7]}`);
  assert.ok(SLOT_9_CATEGORIES.has(categories[8]), `slot 9 was ${categories[8]}`);
  assert.ok(SLOT_10_CATEGORIES.has(categories[9]), `slot 10 was ${categories[9]}`);
  assert.ok(pack.slice(7, 9).every((card) => !card.isReverseHolo && !card.variant));
}

test("Pitch Black has exact independent slot-9 and slot-10 fallback weights", () => {
  const { set } = makePitchBlackFixture("rare");
  const slot9 = getMegaSecondFoilSlotWeights(set);
  const slot10 = getMegaRareSlotWeights(set);

  assert.deepEqual(slot9, { normal: 87.89, illustrationRare: 11, specialIllustrationRare: 1.11 });
  assert.deepEqual(slot10, { rare: 71.144, doubleRare: 8.2, megaDoubleRare: 12.3, ultraRare: 8.3, megaHyperRare: 0.056 });
  assert.equal(Object.values(slot9).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(Object.values(slot10).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(slot10.doubleRare + slot10.megaDoubleRare, 20.5);
  assert.ok(Math.abs(slot10.doubleRare / 20.5 - 4 / 10) < Number.EPSILON);
  assert.ok(Math.abs(slot10.megaDoubleRare / 20.5 - 6 / 10) < Number.EPSILON);
});

test("Pitch Black's 20.5% Double Rare rate uses the official 4/6 eligible-card split", () => {
  const set = { id: "pitch-black", pullRateProfile: "megaEvolutionStandard" };
  const classified = PITCH_BLACK_DOUBLE_RARES.map(([number, name]) => ({
    number,
    category: getRarityCategory({ id: `pitch-black-${number}`, number, name, rarity: "Double Rare" }, set),
  }));

  assert.deepEqual(classified.filter(({ category }) => category === "doubleRare").map(({ number }) => number), ["4", "16", "45", "55"]);
  assert.deepEqual(classified.filter(({ category }) => category === "megaDoubleRare").map(({ number }) => number), ["8", "27", "31", "38", "48", "65"]);
});

for (const finalCategory of SLOT_10_CATEGORIES) {
  test(`Pitch Black keeps ${finalCategory} as the exclusive slot-10 outcome`, () => {
    const { set, pack, categories } = generateFixturePack(finalCategory);

    assertMegaLayout(pack, set);
    assert.equal(categories[8] === "illustrationRare" || categories[8] === "specialIllustrationRare", false);
    assert.equal(categories[9], finalCategory);
  });
}

for (const slot9Category of ["illustrationRare", "specialIllustrationRare"]) {
  for (const finalCategory of SLOT_10_CATEGORIES) {
    test(`${slot9Category} can coexist with ${finalCategory}`, () => {
      const { set, pack, categories } = generateFixturePack(finalCategory, slot9Category);

      assertMegaLayout(pack, set);
      assert.equal(categories[8], slot9Category);
      assert.equal(categories[9], finalCategory);
      assert.equal(categories.filter((category) => ["illustrationRare", "specialIllustrationRare"].includes(category)).length, 1);
    });
  }
}

test("slot 9 has one mutually exclusive outcome and slot 10 cannot contain IR or SIR", () => {
  for (const slot9Category of ["normal", "illustrationRare", "specialIllustrationRare"]) {
    const { set, pack, categories } = generateFixturePack("ultraRare", slot9Category);

    assertMegaLayout(pack, set);
    assert.equal(categories.slice(8, 9).length, 1);
    assert.ok(!["illustrationRare", "specialIllustrationRare"].includes(categories[9]));
  }
});

test("the Mega correction does not move an older profile's final art hit into slot 9", () => {
  const cards = [
    ...Array.from({ length: 8 }, (_, index) => makeCard(`legacy-c${index + 1}`, "common", "Common")),
    ...Array.from({ length: 6 }, (_, index) => makeCard(`legacy-u${index + 1}`, "uncommon", "Uncommon")),
    makeCard("legacy-sir", "specialIllustrationRare", "Special Illustration Rare", "Legacy final art hit"),
  ];
  const set = { id: "legacy-fixture", name: "Legacy fixture", pullRateProfile: "swordShieldStandard", cards };
  const pack = withRandomSequence(Array(20).fill(0.5), () => generatePack(set));
  const categories = pack.map((card) => getRarityCategory(card, set));

  assert.ok(ORDINARY_CATEGORIES.has(categories[8]));
  assert.equal(categories[9], "specialIllustrationRare");
});

for (const setId of EXISTING_MEGA_SET_IDS) {
  test(`${setId} uses the corrected shared Mega normal-pack slots`, async () => {
    const cards = JSON.parse(await readFile(new URL(`../src/data/${setId}.json`, import.meta.url), "utf8"));
    const set = { id: setId, name: setId, pullRateProfile: "megaEvolutionStandard", cards };
    const pack = withRandomSequence(Array(32).fill(0.5), () => generatePack(set));

    assert.equal(pack.isGodPack, false);
    assertMegaLayout(pack, set);
  });
}

test("IR and SIR keep penultimate presentation classifications without becoming final", () => {
  const ir = generateFixturePack("ultraRare", "illustrationRare");
  const sir = generateFixturePack("doubleRare", "specialIllustrationRare");

  assert.equal(ir.categories[8], "illustrationRare");
  assert.equal(getDisplayRarity(ir.pack[8], ir.set), "Illustration Rare");
  assert.equal(getRarityVisualLevel(ir.pack[8], ir.set), "illustration");
  assert.equal(getFoilProfile(ir.pack[8], ir.set), "illustrationRare");
  assert.equal(getHitSoundType(ir.pack[8], ir.set), "bigHit");
  assert.equal(sir.categories[8], "specialIllustrationRare");
  assert.equal(getDisplayRarity(sir.pack[8], sir.set), "Special Illustration Rare");
  assert.equal(getRarityVisualLevel(sir.pack[8], sir.set), "major");
  assert.equal(getFoilProfile(sir.pack[8], sir.set), "specialIllustrationRare");
  assert.equal(getHitSoundType(sir.pack[8], sir.set), "bigHit");
});

test("mobile reveal follows pack order, classifies slot 9 normally, and slows only slot 10", async () => {
  const [appSource, hapticsSource] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/utils/mobileHaptics.js", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /pack\.map\(\(card, index\) =>/);
  assert.match(appSource, /const isFinal = index === pack\.length - 1;/);
  assert.match(appSource, /setRevealedCount\(index \+ 1\);/);
  assert.match(appSource, /const CARD_FLIP_STAGGER_MS = 330;/);
  assert.match(appSource, /const LAST_CARD_EXTRA_DELAY_MS = 850;/);
  assert.match(appSource, /return index === totalCards - 1 \? baseDelay \+ LAST_CARD_EXTRA_DELAY_MS : baseDelay;/);
  assert.match(hapticsSource, /illustration: \[16, 42, 16\]/);
  assert.match(hapticsSource, /major: \[28, 38, 22, 38, 28\]/);

  assert.ok(9 * 330 + 850 > 8 * 330);
});
