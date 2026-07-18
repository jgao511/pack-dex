import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import setGuides from "../src/data/explore/setGuides.json" with { type: "json" };
import eraGuides from "../src/data/explore/eraGuides.json" with { type: "json" };
import pokemon from "../src/data/explore/pokemon.json" with { type: "json" };
import { sets } from "../src/data/sets.js";

test("every supported set and era has exactly one runtime guide", () => {
  assert.equal(Object.keys(setGuides).length, sets.length);
  assert.deepEqual(new Set(Object.keys(setGuides)), new Set(sets.map((set) => set.id)));
  const eras = new Set(sets.map((set) => set.era));
  assert.equal(Object.keys(eraGuides).length, eras.size);
  assert.deepEqual(new Set(Object.keys(eraGuides)), eras);
});

test("editorial references resolve and custom preview content is labeled", () => {
  const pokemonIds = new Set(pokemon.map((item) => item.id));
  for (const [era, guide] of Object.entries(eraGuides)) {
    assert.ok(guide.summary, era);
    for (const id of guide.representativePokemonIds || []) assert.ok(pokemonIds.has(id), `${era}:${id}`);
  }
  for (const set of sets) {
    const guide = setGuides[set.id];
    assert.equal(guide.setId, set.id);
    assert.ok(guide.summary);
    assert.ok(["curated", "limited"].includes(guide.contentStatus));
  }
  assert.equal(setGuides["30th-anniversary"].custom, true);
  assert.match(setGuides["30th-anniversary"].summary, /PackDex-created preview/);
});

test("source notes stay in the developer audit rather than runtime JSON", async () => {
  const audit = JSON.parse(await readFile(new URL("../docs/explore-editorial-audit.json", import.meta.url), "utf8"));
  assert.equal(audit.sets.length, sets.length);
  assert.equal(audit.eras.length, Object.keys(eraGuides).length);
  assert.ok(audit.sets.every((entry) => entry.sourceNotes.length > 0));
  assert.doesNotMatch(JSON.stringify(setGuides), /sourceNotes|https:\/\//);
  assert.doesNotMatch(JSON.stringify(eraGuides), /sourceNotes|https:\/\//);
  const runtimeBytes = (await stat(new URL("../src/data/explore/setGuides.json", import.meta.url))).size + (await stat(new URL("../src/data/explore/eraGuides.json", import.meta.url))).size;
  assert.ok(runtimeBytes < 60000, `runtime editorial data is ${runtimeBytes} bytes`);
});
