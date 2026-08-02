import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeSets } from "../src/data/sets.js";
import {
  getCardCollectionKey,
  getPullableCollectionCards,
} from "../src/utils/collectionStorage.js";
import setCompletionCatalog from "../supabase/functions/check-achievements/setCompletionCatalog.js";
import {
  VALUE_MILESTONES,
  calculateCompletedSetCount,
  calculateEstimatedCollectionValue,
  createAchievementCandidate,
  getReachedMilestoneIds,
} from "../supabase/functions/check-achievements/achievementMetrics.js";

test("authoritative collection value reaches the $10, $100, and $500 milestones", () => {
  const collectionRows = [{
    set_id: "manual-grant-set",
    card_id: "manual-grant-card",
    quantity: 1,
  }];

  for (const threshold of [10, 100, 500]) {
    const value = calculateEstimatedCollectionValue(collectionRows, [{
      set_id: "manual-grant-set",
      card_id: "manual-grant-card",
      market_price_usd: threshold,
    }]);

    assert.equal(value, threshold);
    assert.ok(getReachedMilestoneIds(VALUE_MILESTONES, value).includes(`value_${threshold}`));
  }
});

test("collection value safely ignores missing, invalid, zero, and negative prices", () => {
  const collectionRows = [
    { set_id: "set-a", card_id: "priced", quantity: 2 },
    { set_id: "set-a", card_id: "missing", quantity: 100 },
    { set_id: "set-a", card_id: "invalid", quantity: 1 },
    { set_id: "set-a", card_id: "negative", quantity: 1 },
  ];
  const priceRows = [
    { set_id: "set-a", card_id: "priced", market_price_usd: "6.25" },
    { set_id: "set-a", card_id: "invalid", market_price_usd: "not-a-price" },
    { set_id: "set-a", card_id: "negative", market_price_usd: -50 },
  ];

  assert.equal(calculateEstimatedCollectionValue(collectionRows, priceRows), 12.5);
});

test("collection value matches prices by canonical card id across pricing set aliases", () => {
  const value = calculateEstimatedCollectionValue(
    [{ set_id: "base-set", card_id: "base1-4", quantity: 2 }],
    [{ set_id: "base1", card_id: "base1-4", market_price_usd: 7.5 }]
  );

  assert.equal(value, 15);
});

test("backend and manual quantity grants contribute to authoritative value", () => {
  const priceRows = [{ card_id: "grant-card", market_price_usd: 2.5 }];

  assert.equal(
    calculateEstimatedCollectionValue(
      [{ set_id: "grant-set", card_id: "grant-card", quantity: 4 }],
      priceRows
    ),
    10
  );
  assert.equal(
    calculateEstimatedCollectionValue(
      [{ set_id: "grant-set", card_id: "grant-card", quantity: 5 }],
      priceRows
    ),
    12.5
  );
});

test("completed-set evaluation distinguishes incomplete, one-set, and five-set collections", () => {
  const catalog = Array.from({ length: 5 }, (_, index) => ({
    setId: `set-${index + 1}`,
    requiredCardIds: [`set-${index + 1}-main`, `set-${index + 1}-subset`],
  }));
  const completeRows = catalog.flatMap((set) =>
    set.requiredCardIds.map((cardId) => ({ set_id: set.setId, card_id: cardId, quantity: 1 }))
  );

  assert.equal(calculateCompletedSetCount(completeRows.slice(0, 1), catalog), 0);
  assert.equal(calculateCompletedSetCount(completeRows.slice(0, 2), catalog), 1);
  assert.equal(calculateCompletedSetCount(completeRows, catalog), 5);
});

test("generated completion catalog exactly preserves client subset and energy rules", () => {
  const catalogBySet = new Map(setCompletionCatalog.map((set) => [set.setId, set.requiredCardIds]));
  assert.equal(catalogBySet.size, activeSets.length);

  for (const set of activeSets) {
    const expected = getPullableCollectionCards(set).map((card) => getCardCollectionKey(card, set.id));
    assert.deepEqual(catalogBySet.get(set.id), expected, `completion catalog drift for ${set.id}`);
  }

  const subsetCards = activeSets.flatMap((set) =>
    getPullableCollectionCards(set)
      .filter((card) => card.subset || card.subsetType)
      .map((card) => ({ setId: set.id, cardId: getCardCollectionKey(card, set.id) }))
  );
  assert.ok(subsetCards.length > 0);
  subsetCards.forEach(({ setId, cardId }) => assert.ok(catalogBySet.get(setId).includes(cardId)));

  const baseSetCardIds = new Set(catalogBySet.get("base-set"));
  ["base1-97", "base1-98", "base1-99", "base1-100", "base1-101", "base1-102"].forEach((cardId) => {
    assert.ok(baseSetCardIds.has(cardId), `numbered Base Set energy missing: ${cardId}`);
  });
});

test("existing achievement award keys and row compatibility remain unchanged", () => {
  const row = createAchievementCandidate("user-1", "value_100", "value", 125, 100);

  assert.equal(row.award_key, "account::user-1::value_100::global");
  assert.equal(row.scope_type, "global");
  assert.equal(row.scope_key, "global");
  assert.equal(row.metadata.progress_current, 125);
  assert.equal(row.metadata.progress_target, 100);
});

test("Rare+ achievements remain defined but are hidden from rendering and percentages", async () => {
  const mobileSource = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const rareIds = ["first_big_hit", "big_hits_10", "rare_hits_25", "rare_hits_50"];

  for (const id of rareIds) {
    const definition = mobileSource.match(
      new RegExp(`\\{\\s*id: "${id}"[\\s\\S]*?\\n  \\},`)
    )?.[0] || "";
    assert.match(definition, /visibility: "hidden"/);
  }

  assert.match(mobileSource, /const VISIBLE_MOBILE_ACHIEVEMENTS = MOBILE_ACHIEVEMENTS\.filter/);
  assert.match(mobileSource, /VISIBLE_MOBILE_ACHIEVEMENTS\.map\(\(achievement\) =>/);
  assert.match(mobileSource, /VISIBLE_MOBILE_ACHIEVEMENTS\.filter\(\(achievement\) => achievement\.trust === "trusted"\)/);
  assert.match(mobileSource, /MOBILE_ACHIEVEMENTS\.find\(\(achievement\) => achievement\.id === achievementId\)/);
});

test("trusted reconciliation is profile-only and leaves the post-pack request scope unchanged", async () => {
  const mobileSource = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const achievementClient = await readFile(new URL("../src/lib/userAchievements.js", import.meta.url), "utf8");
  const edgeSource = await readFile(
    new URL("../supabase/functions/check-achievements/index.ts", import.meta.url),
    "utf8"
  );
  const postPackFlow = mobileSource.match(
    /async function runPostPackAchievementFlow[\s\S]*?return \{ packEvent: null, achievements: achievementResult \};/
  )?.[0] || "";

  assert.match(postPackFlow, /requestServerAchievementAward\(currentUser\.id\)/);
  assert.doesNotMatch(postPackFlow, /reconcileCurrentUserAchievements|loadTrustedCollectionMetrics/);
  assert.match(achievementClient, /body: \{ scope: "pack_and_collection" \}/);
  assert.match(achievementClient, /body: \{ scope: "profile_reconcile" \}/);
  assert.match(edgeSource, /if \(isProfileReconciliation\) \{[\s\S]*loadTrustedCollectionMetrics/);
  assert.doesNotMatch(edgeSource, /select\("packs_opened,total_cards_pulled,unique_cards,sets_completed"\)/);
  assert.match(edgeSource, /return jsonResponse\(\{ awarded \}\);/);
});

test("profile refresh and account changes reload or clear achievement state", async () => {
  const mobileSource = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const clearAccountState = mobileSource.match(
    /function clearAccountScopedState\(\) \{[\s\S]*?\n  \}/
  )?.[0] || "";
  const accountLoad = mobileSource.match(
    /async function performAccountScopedStateLoad\(currentUser\) \{[\s\S]*?\n  \}/
  )?.[0] || "";
  const openAchievements = mobileSource.match(
    /function openAchievements\(\) \{[\s\S]*?\n  \}/
  )?.[0] || "";

  assert.match(clearAccountState, /setAchievements\(\[\]\)/);
  assert.match(clearAccountState, /setAchievementProgress\(\[\]\)/);
  assert.match(clearAccountState, /achievementCacheByUserIdRef\.current\.clear\(\)/);
  assert.match(clearAccountState, /clearAchievementReconciliationCache\(\)/);
  assert.match(accountLoad, /await loadUserAchievements\(currentUser\)/);
  assert.match(openAchievements, /onLoadAchievementProgress\?\.\(\)/);
});

test("successful collection-changing achievement flows invalidate reconciliation without adding requests", async () => {
  const mobileSource = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const achievementClient = await readFile(new URL("../src/lib/userAchievements.js", import.meta.url), "utf8");
  const awardRequest = achievementClient.match(
    /export async function requestServerAchievementAward[\s\S]*?\n\}/
  )?.[0] || "";
  const scannerCollectionChange = mobileSource.match(
    /async function addScannedCardToCollection[\s\S]*?\n  \}/
  )?.[0] || "";

  assert.ok(
    awardRequest.indexOf("invalidateAchievementReconciliation(user.id)") <
      awardRequest.indexOf('body: { scope: "pack_and_collection" }')
  );
  assert.equal((awardRequest.match(/functions\.invoke/g) || []).length, 1);
  assert.match(scannerCollectionChange, /if \(outcome\.added\) \{\s*invalidateAchievementReconciliation\(actionUserId\)/);
});
