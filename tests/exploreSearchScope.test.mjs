import assert from "node:assert/strict";
import test from "node:test";
import { groupedExploreSearch } from "../mobile-app/src/explore/exploreData.js";

test("Explore search returns species, Pokémon cards, sets, and eras", () => {
  assert.ok(groupedExploreSearch("Pikachu").pokemon.some((item) => item.id === 25));
  assert.ok(groupedExploreSearch("Pikachu").cards.every((entry) => entry.speciesIds.length > 0));
  assert.ok(groupedExploreSearch("Base Set").sets.some((set) => set.id === "base-set"));
  assert.ok(groupedExploreSearch("Sword Shield").eras.some((era) => era.name === "Sword & Shield"));
});

test("Explore search excludes exact non-Pokémon card names", () => {
  for (const query of ["Professor's Research", "Rare Candy", "Path to the Peak", "Choice Belt", "Basic Energy", "Double Colorless Energy"]) {
    assert.deepEqual(groupedExploreSearch(query).cards, [], query);
  }
});

test("every Explore card result is backed by a Pokémon relationship", () => {
  for (const query of ["ex", "rare", "base set", "energy", "professor", "stadium", "tool", "supporter", "item"]) {
    assert.ok(groupedExploreSearch(query, 100).cards.every((entry) => entry.speciesIds.length > 0), query);
  }
});
