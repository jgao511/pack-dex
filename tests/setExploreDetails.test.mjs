import assert from "node:assert/strict";
import test from "node:test";
import { activeSets } from "../src/data/sets.js";
import { getSetExploreDetails } from "../src/lib/setExploreDetails.js";

const setById = (id) => activeSets.find((set) => set.id === id);

test("shared set details surface collector-facing context for 151", () => {
  const details = getSetExploreDetails(setById("151"), {
    featuredCardLimit: 4,
    featuredPokemonLimit: 6,
  });

  assert.match(details.guide.summary, /original 151 Pokémon/i);
  assert.equal(details.eraGuide.summary.length > 0, true);
  assert.deepEqual(details.featuredPokemon.map(({ species }) => species.displayName), [
    "Venusaur",
    "Charizard",
    "Blastoise",
    "Alakazam",
    "Zapdos",
    "Mew",
  ]);
  assert.equal(details.featuredCards.length, 4);
  assert.match(details.specialFeature, /rare Demi-God Pack virtual opening/);
});

test("shared details cover a standard modern set without inventing a special feature", () => {
  const details = getSetExploreDetails(setById("surging-sparks"));
  assert.match(details.guide.summary, /^Surging Sparks spotlights /);
  assert.equal(details.eraGuide.summary.length > 0, true);
  assert.equal(details.cardEntries.length, 252);
  assert.equal(details.featuredPokemon[0].species.displayName, "Exeggutor");
  assert.equal(details.featuredCards.length, 8);
  assert.equal(details.specialFeature, "");
});

test("shared details cover an older set using the same audited guides", () => {
  const details = getSetExploreDetails(setById("base-set"));
  assert.match(details.guide.summary, /foundational presentation/);
  assert.match(details.eraGuide.summary, /earliest English-language catalog/);
  assert.equal(details.cardEntries.length, 102);
  assert.ok(details.featuredPokemon.some(({ species }) => species.displayName === "Charizard"));
  assert.equal(details.specialFeature, "");
});

test("only implemented special-opening sets receive the small feature note", () => {
  const special = getSetExploreDetails(setById("prismatic-evolutions"));
  const ordinary = getSetExploreDetails(setById("detective-pikachu"));
  assert.match(special.specialFeature, /rare God Pack virtual opening/);
  assert.equal(ordinary.specialFeature, "");
  assert.doesNotMatch(special.specialFeature, /official pull rates|Premium pool|configured subset|internal/i);
});

test("curated featured Pokémon take precedence when an audited guide provides them", () => {
  const details = getSetExploreDetails(setById("pitch-black"));
  assert.deepEqual(details.featuredPokemon.map(({ species }) => species.id), [491, 609, 807]);
});

test("sparse or missing metadata degrades without fabricated highlights", () => {
  const sparse = getSetExploreDetails({ id: "sparse", name: "Sparse Set", era: "Unknown", cards: [] });
  assert.deepEqual(sparse.guide, {});
  assert.deepEqual(sparse.eraGuide, {});
  assert.deepEqual(sparse.featuredPokemon, []);
  assert.deepEqual(sparse.featuredCards, []);
  assert.equal(sparse.specialFeature, "");
  assert.deepEqual(getSetExploreDetails(null), {
    guide: {}, eraGuide: {}, cardEntries: [], featuredCards: [], featuredPokemon: [], specialFeature: "",
  });
});
