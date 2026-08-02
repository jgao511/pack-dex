import assert from "node:assert/strict";
import test from "node:test";
import { activeSets } from "../src/data/sets.js";
import {
  generatePack,
  generateNormalPackOnly,
  getPackPools,
  getRarityCategory,
  isCardAllowedInPackSlot,
} from "../src/utils/packGenerator.js";
import {
  getCardCollectionKey,
  getCardCount,
  getPullableCollectionCards,
  getSetCollectionProgress,
  loadCollection,
  markCardsCollected,
  saveCollection,
} from "../src/utils/collectionStorage.js";
import {
  isEnergyCard,
  isGenericBonusEnergyCard,
  isNumberedSetEnergyCard,
} from "../src/utils/energyCardPolicy.js";
import { savePulledCardsToCloud } from "../src/lib/cloudCollection.js";

class MemoryStorage {
  constructor() { this.entries = new Map(); }
  getItem(key) { return this.entries.get(key) ?? null; }
  removeItem(key) { this.entries.delete(key); }
  setItem(key, value) { this.entries.set(key, String(value)); }
}

const baseSet = activeSets.find((set) => set.id === "base-set");
const sunMoon = activeSets.find((set) => set.id === "sun-moon");
const baseBasicEnergy = baseSet.cards.filter(
  (card) => Number(card.number) >= 97 && Number(card.number) <= 102
);
const setsWithNumberedEnergy = activeSets
  .map((set) => ({ set, cards: set.cards.filter((card) => isNumberedSetEnergyCard(card, set)) }))
  .filter(({ cards }) => cards.length > 0);

test("Base Set exposes all 102 cards including Basic Energy 97-102", () => {
  assert.equal(getPullableCollectionCards(baseSet).length, 102);
  assert.deepEqual(baseBasicEnergy.map((card) => card.number), ["97", "98", "99", "100", "101", "102"]);
  assert.ok(baseBasicEnergy.every((card) => isNumberedSetEnergyCard(card, baseSet)));
});

test("every supported set includes each numbered Energy card in pools, visibility, and a normal slot", () => {
  assert.ok(setsWithNumberedEnergy.length > 0);

  for (const { set, cards } of setsWithNumberedEnergy) {
    const visibleIds = new Set(getPullableCollectionCards(set).map((card) => card.id));
    const poolIds = new Set(getPackPools(set).cleanCards.map((card) => card.id));

    for (const card of cards) {
      assert.ok(visibleIds.has(card.id), `${set.id} ${card.number} missing from collection`);
      assert.ok(poolIds.has(card.id), `${set.id} ${card.number} missing from generator pool`);
      assert.ok(
        Array.from({ length: 11 }, (_, index) => index).some((index) => isCardAllowedInPackSlot(card, index, set)),
        `${set.id} ${card.number} has no eligible normal pack slot`
      );
    }
  }
});

test("Base Set Basic Energy cards are naturally generated in its historical Energy slots", () => {
  const seen = new Set();

  for (let index = 0; index < 5_000 && seen.size < baseBasicEnergy.length; index += 1) {
    for (const card of generatePack(baseSet)) {
      if (baseBasicEnergy.some((energy) => energy.id === card.id)) seen.add(card.id);
    }
  }

  assert.deepEqual([...seen].sort(), baseBasicEnergy.map((card) => card.id).sort());
});

test("numbered Energy saves to guest storage and increases progress", () => {
  const storage = new MemoryStorage();
  const energy = baseBasicEnergy[0];
  const collection = markCardsCollected({}, [energy], baseSet.id, 1234);

  saveCollection(collection, storage);
  const restored = loadCollection(storage);
  const progress = getSetCollectionProgress(restored, baseSet);

  assert.equal(getCardCount(restored, energy, baseSet.id), 1);
  assert.equal(progress.collected, 1);
  assert.equal(progress.total, 102);
  assert.equal(progress.percent, 1);
});

test("numbered Energy reaches the signed-in collection RPC payload", async () => {
  const storage = new MemoryStorage();
  const energy = baseBasicEnergy[1];
  let submittedCards = [];
  const client = {
    async rpc(_name, payload) {
      submittedCards = payload.batches[0].cards;
      return {
        data: [{
          client_event_id: payload.batches[0].client_event_id,
          accepted: true,
          recorded: true,
          packs_opened: 1,
          total_cards_pulled: 1,
        }],
        error: null,
      };
    },
  };

  const result = await savePulledCardsToCloud([energy], baseSet.id, {
    userId: "energy-test-user",
    clientEventId: "pack-open:base-set:energy-test",
    client,
    storage,
    validateUser: false,
  });

  assert.equal(result.saved, 1);
  assert.deepEqual(submittedCards.map((card) => card.card_id), [energy.id]);
});

test("full ownership completes the exact visible total for every numbered-Energy set", () => {
  for (const { set } of setsWithNumberedEnergy) {
    const cards = getPullableCollectionCards(set);
    const collection = markCardsCollected({}, cards, set.id, 1234);
    const progress = getSetCollectionProgress(collection, set);

    assert.equal(progress.collected, cards.length, set.id);
    assert.equal(progress.total, cards.length, set.id);
    assert.equal(progress.percent, 100, set.id);
  }
});

test("sets without numbered Energy do not gain Energy in their totals", () => {
  const setsWithoutNumberedEnergy = activeSets.filter(
    (set) => !set.cards.some((card) => isNumberedSetEnergyCard(card, set))
  );

  for (const set of setsWithoutNumberedEnergy) {
    const expected = set.cards.filter((card) => !isEnergyCard(card)).length;
    const actual = getPullableCollectionCards(set);

    assert.equal(actual.filter(isEnergyCard).length, 0, set.id);
    assert.equal(actual.length, expected, set.id);
  }
});

test("modern packs stay at ten cards and never add Sun & Moon bonus Energy", () => {
  const bonusIds = new Set(
    sunMoon.cards.filter((card) => isGenericBonusEnergyCard(card, sunMoon)).map((card) => card.id)
  );

  assert.equal(bonusIds.size, 9);
  assert.equal(getPullableCollectionCards(sunMoon).some((card) => bonusIds.has(card.id)), false);

  for (let index = 0; index < 1_000; index += 1) {
    const pack = generatePack(sunMoon);
    assert.equal(pack.length, 10);
    assert.equal(pack.some((card) => bonusIds.has(card.id)), false);
  }
});

function makeDistributionFixture(includeEnergy) {
  const make = (id, rarity, name = id) => ({ id, number: id.replace(/\D/g, "") || "1", name, rarity });
  const cards = [
    ...Array.from({ length: 8 }, (_, index) => make(`common-${index + 1}`, "Common")),
    ...Array.from({ length: 6 }, (_, index) => make(`uncommon-${index + 1}`, "Uncommon")),
    ...Array.from({ length: 5 }, (_, index) => make(`rare-${index + 1}`, "Rare")),
    make("secret-19", "Secret Rare"),
    make("ultra-20", "Ultra Rare"),
  ];
  if (includeEnergy) cards.push(make("energy-21", "Secret Rare", "Psychic Energy"));
  return {
    id: includeEnergy ? "distribution-with-energy" : "distribution-without-energy",
    name: "Distribution fixture",
    pullRateProfile: "sunMoonStandard",
    officialChecklistTotal: 21,
    cards,
  };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("adding a numbered Energy to its rarity pool does not change rarity distributions", () => {
  const withoutEnergy = makeDistributionFixture(false);
  const withEnergy = makeDistributionFixture(true);
  const originalRandom = Math.random;

  try {
    Math.random = seededRandom(42);
    const baseline = Array.from({ length: 2_000 }, () =>
      getRarityCategory(generateNormalPackOnly(withoutEnergy).at(-1), withoutEnergy)
    );
    Math.random = seededRandom(42);
    const withNumberedEnergy = Array.from({ length: 2_000 }, () =>
      getRarityCategory(generateNormalPackOnly(withEnergy).at(-1), withEnergy)
    );

    assert.deepEqual(withNumberedEnergy, baseline);
  } finally {
    Math.random = originalRandom;
  }
});

test("numbered Energy identities and collection keys are unique within every set", () => {
  for (const { set, cards } of setsWithNumberedEnergy) {
    const ids = cards.map((card) => card.id);
    const keys = cards.map((card) => getCardCollectionKey(card, set.id));
    assert.equal(new Set(ids).size, ids.length, `${set.id} duplicate Energy id`);
    assert.equal(new Set(keys).size, keys.length, `${set.id} duplicate Energy collection key`);
  }
});
