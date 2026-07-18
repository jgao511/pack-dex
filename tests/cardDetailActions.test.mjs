import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getCardActionLayoutClass, getCardDetailActionVisibility } from "../mobile-app/src/utils/cardDetailActions.js";

const available = { hasPokemon: true, hasSet: true, hasEra: true };

test("card actions are filtered explicitly for every in-app origin", () => {
  assert.deepEqual(getCardDetailActionVisibility("pokemon-detail", available), { pokemon: false, set: true, era: true });
  assert.deepEqual(getCardDetailActionVisibility("collection", available), { pokemon: true, set: false, era: false });
  assert.deepEqual(getCardDetailActionVisibility("binder", available), { pokemon: true, set: false, era: false });
  assert.deepEqual(getCardDetailActionVisibility("collection-search", available), { pokemon: true, set: false, era: false });
  assert.deepEqual(getCardDetailActionVisibility("set-detail", available), { pokemon: true, set: false, era: true });
  assert.deepEqual(getCardDetailActionVisibility("era-detail", available), { pokemon: true, set: true, era: false });
  assert.deepEqual(getCardDetailActionVisibility("explore-search", available), { pokemon: true, set: true, era: true });
  assert.deepEqual(getCardDetailActionVisibility("direct", { ...available, hasPokemon: false }), { pokemon: false, set: true, era: true });
});

test("action layout classes derive only from visible action count", () => {
  assert.equal(getCardActionLayoutClass(0), "has-0-actions");
  assert.equal(getCardActionLayoutClass(1), "has-1-actions");
  assert.equal(getCardActionLayoutClass(2), "has-2-actions");
  assert.equal(getCardActionLayoutClass(3), "has-3-actions");
  assert.equal(getCardActionLayoutClass(4), "has-many-actions");
});

test("modal omits empty wrappers and preserves modal-to-destination Back state", async () => {
  const [app, css, screen] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/explore/ExploreScreen.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /contextualActions\.length > 0 && <div/);
  assert.match(app, /packdexCardDestination: true/);
  assert.match(app, /!window\.history\.state\?\.packdexCardDestination/);
  assert.match(screen, /origin: "pokemon-detail"/);
  assert.match(screen, /origin: "set-detail"/);
  assert.match(screen, /origin: "era-detail"/);
  assert.match(screen, /origin: "explore-search"/);
  assert.match(css, /\.inspect-explore-links\.has-1-actions[^}]*justify-content:\s*center/);
  assert.match(css, /\.inspect-explore-links\.has-3-actions > :last-child[^}]*grid-column:\s*1 \/ -1[^}]*justify-self:\s*center/);
  assert.match(css, /@media \(max-width: 339px\)/);
});
