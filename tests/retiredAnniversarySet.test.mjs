import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { activeSets, isRetiredSet, sets } from "../src/data/sets.js";
import {
  getCardCollectionKey,
  getCardCount,
  getPullableCollectionCards,
} from "../src/utils/collectionStorage.js";
import {
  addCardsToBinder,
  createBinder,
  getBinderCardKey,
} from "../src/utils/binderStorage.js";
import { getOwnedBinderCards } from "../mobile-app/src/utils/binderCatalog.js";
import {
  catalogCards,
  exploreEras,
  exploreSets,
  groupedExploreSearch,
} from "../mobile-app/src/explore/exploreData.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const RETIRED_SET_ID = "30th-anniversary";

test("the retired anniversary set remains resolvable but is absent from public discovery", () => {
  const retiredSet = sets.find((set) => set.id === RETIRED_SET_ID);

  assert.ok(retiredSet);
  assert.equal(isRetiredSet(retiredSet), true);
  assert.equal(activeSets.some((set) => set.id === RETIRED_SET_ID), false);
  assert.equal(exploreSets.some((set) => set.id === RETIRED_SET_ID), false);
  assert.equal(exploreEras.some((era) => era.name === retiredSet.era), false);
  assert.equal(catalogCards.some((entry) => entry.set.id === RETIRED_SET_ID), false);
  assert.deepEqual(groupedExploreSearch("30th anniversary"), {
    pokemon: [],
    sets: [],
    eras: [],
    cards: [],
  });
});

test("already-owned anniversary cards still resolve and can be added to an existing custom binder", () => {
  const retiredSet = sets.find((set) => set.id === RETIRED_SET_ID);
  const card = getPullableCollectionCards(retiredSet)[0];
  const collectionKey = getCardCollectionKey(card, retiredSet.id);
  const collection = {
    [retiredSet.id]: {
      [collectionKey]: {
        count: 1,
        firstCollectedAt: 10,
        lastCollectedAt: 20,
      },
    },
  };
  const ownedCards = getOwnedBinderCards(
    sets,
    collection,
    getPullableCollectionCards,
    getCardCount,
    getBinderCardKey
  );
  const ownedRetiredCard = ownedCards.find((item) => item.set.id === RETIRED_SET_ID && item.card.id === card.id);

  assert.ok(ownedRetiredCard);
  assert.equal(ownedRetiredCard.quantity, 1);

  const binder = createBinder({ name: "Existing Binder", tag: "Custom Binder" });
  const updated = addCardsToBinder(
    [binder],
    binder.id,
    [{ card: ownedRetiredCard.card, setId: ownedRetiredCard.set.id }],
    30
  )[0];

  assert.equal(updated.cards.length, 1);
  assert.equal(updated.cards[0].setId, RETIRED_SET_ID);
  assert.equal(updated.cards[0].key, getBinderCardKey(card, RETIRED_SET_ID));
});

test("desktop and mobile public set surfaces use the active catalog and guard retired pack opening", async () => {
  const [desktopApp, mobileApp, exploreData, setSelect] = await Promise.all([
    read("../src/App.jsx"),
    read("../mobile-app/src/App.jsx"),
    read("../mobile-app/src/explore/exploreData.js"),
    read("../src/components/SetSelect.jsx"),
  ]);

  assert.match(desktopApp, /<SetSelect[\s\S]*?sets=\{activeSets\}/);
  assert.match(desktopApp, /activeSets\.map\(\(set\) => \(/);
  assert.match(desktopApp, /if \(!set \|\| isRetiredSet\(set\)\) return/);
  assert.match(mobileApp, /sortSetsByEra\(activeSets\)/);
  assert.match(mobileApp, /\(\) => activeSets[\s\S]*?master-set-/);
  assert.match(mobileApp, /if \(!set \|\| isRetiredSet\(set\)\) return/);
  assert.doesNotMatch(mobileApp, /anniversary-catalog-note|set-preview-note/);
  assert.match(exploreData, /activeSets/);
  assert.doesNotMatch(setSelect, /Pokemon 30th Anniversary|30th-anniversary/);
});
