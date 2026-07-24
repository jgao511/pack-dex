import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeUserAchievementRows, normalizeUserAchievementRow } from "../src/lib/userAchievements.js";

test("newly awarded achievements merge into cached rows without duplicates", () => {
  const existing = [{
    id: "old-row",
    user_id: "account-1",
    achievement_id: "first_pack_opened",
    award_key: "account::account-1::first_pack_opened::global",
    awarded_at: "2026-07-20T10:00:00.000Z",
  }];
  const awarded = [
    {
      id: "new-row",
      user_id: "account-1",
      achievement_id: "packs_opened_10",
      award_key: "account::account-1::packs_opened_10::global",
      awarded_at: "2026-07-24T10:00:00.000Z",
    },
    existing[0],
  ];

  const merged = mergeUserAchievementRows(existing.map(normalizeUserAchievementRow), awarded);

  assert.deepEqual(merged.map((row) => row.id), ["new-row", "old-row"]);
  assert.equal(merged[0].achievementId, "packs_opened_10");
});

test("pack achievement flow merges awards instead of reloading the achievement table", async () => {
  const mobileApp = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const edgeFunction = await readFile(
    new URL("../supabase/functions/check-achievements/index.ts", import.meta.url),
    "utf8"
  );

  const postPackFlow = mobileApp.match(
    /async function runPostPackAchievementFlow[\s\S]*?return \{ packEvent: result, achievements: achievementResult \};/
  )?.[0] || "";

  assert.match(postPackFlow, /mergeAwardedAchievements/);
  assert.doesNotMatch(postPackFlow, /loadUserAchievements/);
  assert.match(edgeFunction, /\.select\("award_key"\)/);
  assert.match(edgeFunction, /return jsonResponse\(\{ awarded \}\)/);
  assert.doesNotMatch(edgeFunction, /alreadyEarned:/);
});

test("desktop background validation does not toggle account-loading state", async () => {
  const webApp = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const refreshIfActive = webApp.match(
    /function refreshIfActive\(\)[\s\S]*?\n    \}/
  )?.[0] || "";

  assert.match(refreshIfActive, /refreshValidatedAuth\(\{ showLoading: false \}\)/);
});
