import assert from "node:assert/strict";
import test from "node:test";

import { sets } from "../src/data/sets.js";
import { restoreTutorialPack } from "../mobile-app/src/lib/mobileOnboarding.js";
import {
  getCollectionVisibleCards,
  getSetCollectionProgress,
  resolveSavedCollectionCard,
} from "../src/utils/collectionStorage.js";
import {
  addWishlistCard,
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

test("legacy wishlist rows remain resolvable but cannot be newly added", async () => {
  const cardId = "team-up-95-team-rocket-s-pupitar";
  const resolved = resolveCatalogWishlistItem("team-up", cardId);
  let writeCalls = 0;
  const supabase = {
    from() {
      writeCalls += 1;
      return { upsert: async () => ({ error: null }) };
    },
  };

  assert.equal(resolved?.card.id, cardId);
  assert.equal(resolved?.card.legacyQuarantine, true);
  await assert.rejects(
    addWishlistCard(supabase, "user", "team-up", cardId),
    /not available in the PackDex catalog/u
  );
  assert.equal(writeCalls, 0);
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
