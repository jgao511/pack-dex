import assert from "node:assert/strict";
import test from "node:test";
import { sets } from "../src/data/sets.js";
import { getPokemonTcgApiSetId } from "../src/lib/priceSetMap.js";
import { getTcgplayerCardUrl, getTcgplayerSearchNumber, getTcgplayerSearchUrl } from "../src/utils/tcgplayerSearch.js";

function findCard(setId, name, number) {
  const set = sets.find((item) => item.id === setId);
  assert.ok(set, `Missing test set ${setId}`);
  const card = set.cards.find((item) => item.name === name && String(item.number) === String(number));
  assert.ok(card, `Missing test card ${name} ${number} in ${setId}`);
  return { set, card };
}

function assertCardSearch(setId, name, number, expectedQuery) {
  const { set, card } = findCard(setId, name, number);
  const result = getTcgplayerSearchUrl({ cardName: card.name, setName: set.name, cardNumber: card.number });
  const url = new URL(result);
  assert.equal(url.origin, "https://www.tcgplayer.com");
  assert.equal(url.pathname, "/search/pokemon/product");
  assert.equal(url.searchParams.get("productLineName"), "pokemon");
  assert.equal(url.searchParams.get("q"), expectedQuery);
}

test("builds card-specific searches for reported and representative sets", () => {
  assertCardSearch("white-flare", "Herdier", "75", "Herdier White Flare #75");
  assertCardSearch("perfect-order", "Hippopotas", "39", "Hippopotas Perfect Order #39");
  assertCardSearch("black-bolt", "Minccino", "75", "Minccino Black Bolt #75");

  const representativeSets = ["base-set", "scarlet-violet", "sword-shield", "perfect-order"];
  for (const setId of representativeSets) {
    const set = sets.find((item) => item.id === setId);
    const card = set.cards.find((item) => item.name && item.number);
    const url = new URL(getTcgplayerSearchUrl({ cardName: card.name, setName: set.name, cardNumber: card.number }));
    assert.equal(url.searchParams.get("q"), `${card.name} ${set.name} ${getTcgplayerSearchNumber(card.number)}`);
  }
});

test("Black Bolt and White Flare use their matching upstream API sets", () => {
  assert.equal(getPokemonTcgApiSetId("black-bolt"), "zsv10pt5");
  assert.equal(getPokemonTcgApiSetId("white-flare"), "rsv10pt5");
});

test("normalizes numbered cards and preserves special identifiers", () => {
  assert.equal(getTcgplayerSearchNumber("039/088"), "#39");
  assert.equal(getTcgplayerSearchNumber("075"), "#75");
  assert.equal(getTcgplayerSearchNumber("SWSH001"), "#SWSH001");
  assert.equal(getTcgplayerSearchNumber("TG01/TG30"), "#TG01/TG30");
});

test("fails safely when a reliable search cannot be built", () => {
  assert.equal(getTcgplayerSearchUrl({ cardName: "Herdier", setName: "White Flare" }), null);
  assert.equal(getTcgplayerSearchUrl({ cardName: "Herdier", cardNumber: "75" }), null);
  assert.equal(getTcgplayerSearchUrl({ setName: "White Flare", cardNumber: "75" }), null);
});

test("encodes punctuation and international card names safely", () => {
  const result = getTcgplayerSearchUrl({ cardName: "Pokémon's Ampersand & Mega ex", setName: "Mega Evolution", cardNumber: "001" });
  const url = new URL(result);
  assert.equal(url.searchParams.get("q"), "Pokémon's Ampersand & Mega ex Mega Evolution #1");
  assert.match(result, /%26/);
});

test("preserves trusted exact TCGplayer URLs and falls back from unsafe URLs", () => {
  const exact = "https://www.tcgplayer.com/product/12345/pokemon-test-card";
  assert.equal(getTcgplayerCardUrl({ exactUrl: exact, cardName: "Ignored", setName: "Ignored", cardNumber: "1" }), exact);
  const fallback = getTcgplayerCardUrl({ exactUrl: "https://example.com/wrong", cardName: "Mew ex", setName: "151", cardNumber: "151" });
  assert.equal(new URL(fallback).searchParams.get("q"), "Mew ex 151 #151");
});

test("every catalog card produces a search tied to its own name, set, and number", () => {
  let checked = 0;
  for (const set of sets) {
    for (const card of set.cards || []) {
      const url = getTcgplayerSearchUrl({ cardName: card.name, setName: set.name, cardNumber: card.number });
      assert.ok(url, `Missing reliable TCGplayer search data for ${set.id}/${card.id}`);
      assert.equal(
        new URL(url).searchParams.get("q"),
        `${card.name.trim()} ${set.name.trim()} ${getTcgplayerSearchNumber(card.number)}`,
        `Wrong search identity for ${set.id}/${card.id}`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 1_000, `Expected to validate the full catalog, checked ${checked}`);
});
