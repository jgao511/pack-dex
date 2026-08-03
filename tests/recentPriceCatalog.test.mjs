import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../supabase/functions/sync-card-prices/catalog.json", import.meta.url), "utf8"));

test("Ascended Heroes is fully mapped to live API set me2pt5", () => {
  const set = catalog.find((item) => item.id === "ascended-heroes");
  assert.ok(set);
  assert.deepEqual(set.apiSetIds, ["me2pt5"]);
  assert.equal(set.cards.length, 295);
  assert.ok(set.cards.every((card) => card.sourceSetId === "me2pt5" && card.sourceCardId.startsWith("me2pt5-")));
});

test("all currently supported Mega-era sets have exact source identities", () => {
  for (const setId of ["mega-evolution", "phantasmal-flames", "ascended-heroes", "perfect-order", "chaos-rising", "pitch-black"]) {
    const set = catalog.find((item) => item.id === setId);
    assert.ok(set, `Missing ${setId}`);
    assert.ok(set.cards.length > 0, `Empty ${setId}`);
    assert.ok(set.cards.every((card) => card.sourceSetId && card.sourceCardId), `Incomplete source identity in ${setId}`);
  }
});

test("deployed desktop and mobile surfaces share the same TCGplayer destination helper", async () => {
  const app = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const scanner = await readFile(new URL("../mobile-app/src/MobileScannerPage.jsx", import.meta.url), "utf8");
  for (const source of [app, scanner]) {
    assert.match(source, /getTcgplayerDestination/);
    assert.match(source, /target="_blank" rel="noopener noreferrer"/);
  }
});
