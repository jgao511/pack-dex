import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getCardCollectionKey, getCardCount } from "../src/utils/collectionStorage.js";
import { searchCollectionCatalog } from "../mobile-app/src/explore/exploreData.js";

test("Collection catalog search finds Pokémon, Trainer, Item, Stadium, Tool, and Energy cards", () => {
  for (const query of ["Pikachu", "Professor's Research", "Rare Candy", "Path to the Peak", "Choice Belt", "Double Colorless Energy"]) {
    assert.ok(searchCollectionCatalog(query).length > 0, query);
  }
});

test("Collection catalog search supports punctuation, set name, collector number, rarity, and dependable category", () => {
  assert.ok(searchCollectionCatalog("Professors Research").some((entry) => entry.card.name.includes("Professor")));
  assert.ok(searchCollectionCatalog("Sword & Shield").every((entry) => entry.set.name.includes("Sword") || entry.searchText.includes("sword shield")));
  assert.ok(searchCollectionCatalog("#4").some((entry) => String(entry.card.number) === "4"));
  assert.ok(searchCollectionCatalog("Secret Rare").some((entry) => /secret/i.test(entry.card.rarity)));
  assert.ok(searchCollectionCatalog("Energy").some((entry) => entry.category === "Energy"));
  assert.ok(searchCollectionCatalog("Trainer").some((entry) => entry.category === "Trainer"));
});

test("Collection results expose accurate owned quantity and missing state without mutation", () => {
  const [ownedEntry, missingEntry] = searchCollectionCatalog("Pikachu", 2);
  const key = getCardCollectionKey(ownedEntry.card, ownedEntry.set.id);
  const collection = { [ownedEntry.set.id]: { [key]: { count: 4 } } };
  const before = structuredClone(collection);
  assert.equal(getCardCount(collection, ownedEntry.card, ownedEntry.set.id), 4);
  assert.equal(getCardCount(collection, missingEntry.card, missingEntry.set.id), 0);
  searchCollectionCatalog("Pikachu");
  assert.deepEqual(collection, before);
});

test("Collection search UI is global, compact, and remains mounted behind card detail", async () => {
  const source = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /placeholder="Search cards, sets, or collector numbers"/);
  assert.doesNotMatch(source, /Complete Card Catalog|Find any card|Search all cards|Search Sets/);
  assert.match(source, /<span>Era<\/span>[\s\S]*Latest Sets/);
  assert.match(source, /import\("\.\/explore\/exploreData\.js"\)[\s\S]*searchCollectionCatalog/);
  assert.match(source, /onClick=\{\(\) => onInspectCard\?\.\(entry\.card, entry\.set\)\}/);
  assert.doesNotMatch(source.match(/function CollectionCards\([\s\S]*?\n\}/)?.[0] || "", /markCardsCollected|persistSessionCollection/);
});
