import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { getSetCardById, sets } from "../src/data/sets.js";
import { generatePack } from "../src/utils/packGenerator.js";
import { restoreTutorialPack } from "../mobile-app/src/lib/mobileOnboarding.js";
import {
  getCollectionVisibleCards,
  getSetCollectionProgress,
  resolveSavedCollectionCard,
} from "../src/utils/collectionStorage.js";
import {
  addWishlistCard,
  removeWishlistCard,
  resolveCatalogWishlistItem,
} from "../mobile-app/src/lib/wishlist.js";

test("a quarantined collection row stays visible without counting toward canonical completion", () => {
  const set = sets.find((candidate) => candidate.id === "151");
  const cardId = "151-151-audino";
  const collection = {
    [set.id]: {
      [cardId]: { count: 2, firstCollectedAt: 1, lastCollectedAt: 2 },
    },
  };

  const resolved = resolveSavedCollectionCard(set, cardId);
  const visibleCards = getCollectionVisibleCards(set, collection);
  const progress = getSetCollectionProgress(collection, set);

  assert.equal(resolved?.id, cardId);
  assert.equal(resolved?.legacyQuarantine, true);
  assert.equal(visibleCards.some((card) => card.id === cardId), true);
  assert.deepEqual(progress, { collected: 0, total: 207, percent: 0 });
});

test("an existing quarantined wishlist row can be removed but cannot be newly added", async () => {
  const cardId = "team-up-95-team-rocket-s-pupitar";
  const resolved = resolveCatalogWishlistItem("team-up", cardId);
  const deletePredicates = [];
  let deleteCalls = 0;
  let upsertCalls = 0;
  const deleteQuery = {
    eq(column, value) {
      deletePredicates.push([column, value]);
      return deletePredicates.length === 3 ? Promise.resolve({ error: null }) : deleteQuery;
    },
  };
  const supabase = {
    from(table) {
      assert.equal(table, "user_wishlist");
      return {
        delete() {
          deleteCalls += 1;
          return deleteQuery;
        },
        async upsert() {
          upsertCalls += 1;
          return { error: null };
        },
      };
    },
  };

  assert.equal(resolved?.card.id, cardId);
  assert.equal(resolved?.card.legacyQuarantine, true);
  await removeWishlistCard(supabase, "user", "team-up", cardId);
  assert.equal(deleteCalls, 1);
  assert.deepEqual(deletePredicates, [
    ["user_id", "user"],
    ["set_id", "team-up"],
    ["card_id", cardId],
  ]);
  await assert.rejects(
    addWishlistCard(supabase, "user", "team-up", cardId),
    /not available in the PackDex catalog/u
  );
  assert.equal(upsertCalls, 0);
});

test("an old public share resolves a quarantined card without exposing it to new pulls", () => {
  const set = sets.find((candidate) => candidate.id === "team-up");
  const legacyId = "team-up-95-team-rocket-s-pupitar";
  const oldShare = {
    set_id: set.id,
    card_ids: [...set.cards.slice(0, 9).map((card) => card.id), legacyId],
  };
  const resolvedCards = oldShare.card_ids.map((id) => getSetCardById(set, id, { includeLegacy: true }));
  const sharePageSource = fs.readFileSync("mobile-app/src/PublicPullSharePage.jsx", "utf8");

  assert.equal(resolvedCards.some((card) => !card), false);
  assert.equal(resolvedCards.at(-1)?.id, legacyId);
  assert.equal(resolvedCards.at(-1)?.legacyQuarantine, true);
  assert.match(sharePageSource, /cardIds\.map\(\(id\) => getSetCardById\(set, id, \{ includeLegacy: true \}\)\)/u);

  assert.equal(set.cards.some((card) => card.id === legacyId), false);
  for (let index = 0; index < 25; index += 1) {
    const pull = generatePack(set);
    assert.equal(pull.some((card) => card.id === legacyId || card.legacyQuarantine), false);
  }
});

test("a pre-fix onboarding pack restores its exact quarantined identity", () => {
  const set = sets.find((candidate) => candidate.id === "151");
  const legacyId = "151-151-audino";
  const canonicalIds = set.cards.slice(0, 9).map((card) => card.id);
  const state = { setId: set.id, cardIds: [...canonicalIds, legacyId] };
  const restored = restoreTutorialPack(state);

  assert.equal(restored.set, set);
  assert.deepEqual(restored.cards.map((card) => card.id), state.cardIds);
  assert.equal(restored.cards.at(-1).legacyQuarantine, true);
  assert.equal(set.cards.some((card) => card.id === legacyId), false);
});
