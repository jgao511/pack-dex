import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getCardCollectionKey, getSetCollectionProgress } from "../src/utils/collectionStorage.js";
import { buildExplorePath, parseExploreRoute } from "../mobile-app/src/explore/exploreRouting.js";
import { catalogCards, exploreEras, explorePokemon, getEraProgress, groupedExploreSearch } from "../mobile-app/src/explore/exploreData.js";

test("generated Explore data is complete and representative catalog relationships resolve", () => {
  assert.equal(explorePokemon.length, 1025);
  assert.ok(exploreEras.length >= 10);
  for (const name of ["Pikachu", "Gengar", "Mr. Mime"]) assert.ok(catalogCards.some((entry) => entry.card.name === name && entry.speciesIds.length), name);
  assert.ok(catalogCards.some((entry) => normalizeName(entry.card.name) === "type null" && entry.speciesIds.includes(772)));
  assert.ok(catalogCards.some((entry) => /nidoran/i.test(entry.card.name) && entry.speciesIds.includes(29)));
  assert.ok(catalogCards.some((entry) => /nidoran/i.test(entry.card.name) && entry.speciesIds.includes(32)));
  assert.equal(catalogCards.filter((entry) => /Professor's Research|Lightning Energy/i.test(entry.card.name) && entry.speciesIds.length).length, 0);
});

test("grouped local search handles aliases, sets, eras, cards, and collector numbers", () => {
  assert.equal(groupedExploreSearch("Mr Mime").pokemon[0].displayName, "Mr. Mime");
  assert.ok(groupedExploreSearch("Sword Shield").sets.some((set) => set.id === "sword-shield"));
  assert.ok(groupedExploreSearch("Scarlet Violet").eras.some((era) => era.name === "Scarlet & Violet"));
  assert.ok(groupedExploreSearch("base set 4").cards.some((entry) => entry.card.number === "4"));
});

test("set and era progress count unique owned cards only", () => {
  const setA = { id: "a", cards: [{ id: "1", name: "Pikachu" }, { id: "2", name: "Gengar" }] };
  const setB = { id: "b", cards: [{ id: "3", name: "Eevee" }] };
  const collection = { a: { [getCardCollectionKey(setA.cards[0], "a")]: { count: 9 } }, b: { [getCardCollectionKey(setB.cards[0], "b")]: { count: 2 } } };
  assert.deepEqual(getSetCollectionProgress(collection, setA), { collected: 1, total: 2, percent: 50 });
  assert.deepEqual(getEraProgress({ sets: [setA, setB] }, collection), { owned: 2, total: 3, missing: 1, percent: 67 });
});

test("Explore routes round-trip for browser and native-style paths", () => {
  assert.equal(buildExplorePath({ kind: "pokemon", id: 94 }, "/mobile-app/"), "/mobile-app/explore/pokemon/94");
  assert.deepEqual(parseExploreRoute({ pathname: "/mobile-app/explore/pokemon/94", search: "" }), { kind: "pokemon", id: 94 });
  assert.equal(buildExplorePath({ kind: "set", id: "base-set" }, "/"), "/explore/sets/base-set");
  assert.deepEqual(parseExploreRoute({ pathname: "/explore/search", search: "?q=Mr%20Mime" }), { kind: "search", query: "Mr Mime" });
});

test("Explore presentation supports guest, collection, missing metadata, and lazy images", async () => {
  const source = await readFile(new URL("../mobile-app/src/explore/ExploreScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /collection = \{\}/);
  assert.doesNotMatch(source, /Continue Exploring/);
  assert.match(source, /Recently Viewed/);
  assert.match(source, /RecentExploreSearch/);
  assert.match(source, /No supported PackDex cards yet/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /const \[homeQuery, setHomeQuery\] = useState\(""\)/);
  assert.match(source, /<ExploreHome[\s\S]*query=\{homeQuery\}[\s\S]*onQueryChange=\{setHomeQuery\}/);
  assert.doesNotMatch(source, /Quick Add|manual(?:ly)? add/i);
});

function normalizeName(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
