import assert from "node:assert/strict";
import test from "node:test";
import { buildEvolutionTree, createSpeciesLookup, getCardSpeciesCandidates, getUniqueOwnershipProgress, mapCardNameToSpeciesIds, normalizeExploreText } from "../mobile-app/src/explore/exploreNormalization.js";

const species = [
  { id: 25, name: "pikachu", displayName: "Pikachu", forms: [] },
  { id: 29, name: "nidoran-f", displayName: "Nidoran♀", forms: [] },
  { id: 32, name: "nidoran-m", displayName: "Nidoran♂", forms: [] },
  { id: 94, name: "gengar", displayName: "Gengar", forms: ["gengar-mega"] },
  { id: 122, name: "mr-mime", displayName: "Mr. Mime", forms: ["mr-mime-galar"] },
  { id: 250, name: "ho-oh", displayName: "Ho-Oh", forms: [] },
  { id: 483, name: "dialga", displayName: "Dialga", forms: [] },
  { id: 901, name: "ursaluna", displayName: "Ursaluna", forms: [] },
  { id: 1017, name: "ogerpon", displayName: "Ogerpon", forms: [] },
  { id: 669, name: "flabebe", displayName: "Flabébé", forms: [] },
  { id: 772, name: "type-null", displayName: "Type: Null", forms: [] },
];
const lookup = createSpeciesLookup(species, { "nidoran female": 29, "nidoran male": 32, "mr mime": 122 });

test("Explore normalization tolerates punctuation, accents, gender marks, and catalog mojibake", () => {
  assert.equal(normalizeExploreText("Mr. Mime"), "mr mime");
  assert.equal(normalizeExploreText("Flabébé"), "flabebe");
  assert.equal(normalizeExploreText("Nidoran♀"), "nidoran female");
  assert.equal(normalizeExploreText("Nidoran â™‚"), "nidoran male");
  assert.equal(normalizeExploreText("Ho-Oh"), "ho oh");
});

test("card relationships strip EX/GX/V/VMAX/VSTAR/BREAK and Mega or regional forms", () => {
  for (const name of ["Gengar ex", "Gengar-EX", "Gengar GX", "Gengar V", "Gengar VMAX", "Gengar VSTAR", "Gengar BREAK", "M Gengar-EX", "Mega Gengar ex", "Galarian Mr. Mime"]) {
    assert.deepEqual(mapCardNameToSpeciesIds(name, lookup), [name.includes("Mime") ? 122 : 94], name);
  }
});

test("aliases, Trainer-owned names, gender symbols, and multi-Pokémon subjects map deterministically", () => {
  assert.deepEqual(mapCardNameToSpeciesIds("Team Rocket's Nidoran♀", lookup), [29]);
  assert.deepEqual(mapCardNameToSpeciesIds("Giovanni's Nidoran â™‚", lookup), [32]);
  assert.deepEqual(mapCardNameToSpeciesIds("Mr Mime", lookup), [122]);
  assert.deepEqual(mapCardNameToSpeciesIds("Type: Null", lookup), [772]);
  assert.deepEqual(mapCardNameToSpeciesIds("Pikachu & Ho-Oh GX", lookup), [25, 250]);
  assert.deepEqual(mapCardNameToSpeciesIds("Ho-Oh LEGEND", lookup), [250]);
  assert.deepEqual(mapCardNameToSpeciesIds("Dialga G LV.X", lookup), [483]);
  assert.deepEqual(mapCardNameToSpeciesIds("Bloodmoon Ursaluna ex", lookup), [901]);
  assert.deepEqual(mapCardNameToSpeciesIds("Teal Mask Ogerpon ex", lookup), [1017]);
  assert.deepEqual(mapCardNameToSpeciesIds("Team Aquas Kyogre-EX", createSpeciesLookup([{ id: 382, name: "kyogre", displayName: "Kyogre", forms: [] }])), [382]);
});

test("Trainer, item, and Energy titles are not falsely mapped by species substrings", () => {
  for (const name of ["Pikachu Collector", "Clefairy Doll", "Lightning Energy", "Professor's Research", "Gengar Spirit Link"]) assert.deepEqual(mapCardNameToSpeciesIds(name, lookup), [], name);
  assert.deepEqual(getCardSpeciesCandidates("Team Rocket's Handiwork"), ["handiwork"]);
});

test("unique ownership progress ignores quantities above one", () => {
  const cards = [{ set: { id: "a" }, card: { id: "1" } }, { set: { id: "a" }, card: { id: "2" } }, { set: { id: "a" }, card: { id: "2" } }];
  assert.deepEqual(getUniqueOwnershipProgress(cards, { a: { 1: { count: 7 }, 2: { count: 0 } } }, (card) => card.id), { owned: 1, total: 2, missing: 1, percent: 50 });
});

test("evolution tree preserves branching instead of flattening it", () => {
  const family = { species: [{ id: 133, evolvesFromId: null }, { id: 134, evolvesFromId: 133 }, { id: 135, evolvesFromId: 133 }, { id: 136, evolvesFromId: 133 }] };
  const byId = new Map([[133, { id: 133 }], [134, { id: 134 }], [135, { id: 135 }], [136, { id: 136 }]]);
  const tree = buildEvolutionTree(family, byId);
  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0].children.map((node) => node.species.id), [134, 135, 136]);
});
