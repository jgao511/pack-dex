import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const claimSourceUrl = new URL(
  "../supabase/functions/claim-welcome-god-pack/index.ts",
  import.meta.url
);
const mobileAppUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);

test("welcome reward eligibility is counted and enforced by the authenticated server", async () => {
  const source = await readFile(claimSourceUrl, "utf8");

  assert.match(source, /getAuthenticatedUser\(req\)/);
  assert.match(source, /\.from\("user_pack_open_events"\)/);
  assert.match(source, /\.eq\("user_id", user\.id\)/);
  assert.match(source, /\.not\("client_event_id", "like", "welcome-god-pack:%"\)/);
  assert.match(source, /Number\(eligiblePackCount \|\| 0\) < 50/);
  assert.match(source, /Open 50 eligible packs before claiming this reward/);
  assert.match(source, /WELCOME_REWARD_SET_IDS\.has\(setId\)/);
});

test("49 remains locked, 50 is the first ready count, and duplicate claim events are idempotent", async () => {
  const [claimSource, rewardSource] = await Promise.all([
    readFile(claimSourceUrl, "utf8"),
    readFile(new URL("../src/lib/welcomeReward.js", import.meta.url), "utf8"),
  ]);

  assert.match(claimSource, /eligiblePackCount \|\| 0\) < 50/);
  assert.match(rewardSource, /isReady: eligiblePacks >= 50/);
  assert.match(claimSource, /client_event_id: `welcome-god-pack:\$\{claimId\}`/);
  assert.match(claimSource, /error\.code !== "23505"/);
  assert.match(claimSource, /welcome_reward_cards_saved_at/);
});

test("claim state is won conditionally before collection grant and supports safe retry", async () => {
  const source = await readFile(claimSourceUrl, "utf8");
  const claimPosition = source.indexOf('debugStep = "claim_reward"');
  const collectionPosition = source.indexOf('debugStep = "save_collection"');

  assert.ok(claimPosition > 0 && claimPosition < collectionPosition);
  assert.match(source, /\.eq\("welcome_god_pack_claimed", false\)/);
  assert.match(source, /welcome_reward_claim_id: claimId/);
  assert.match(source, /welcome_reward_cards: responseCards/);
  assert.match(source, /retry_save_claimed_reward/);
  assert.match(source, /recordWelcomePackOpenEvent\(admin, user\.id, retrySet\.id, retryClaimId/);
});

test("mobile Profile hides claimed rewards and only exposes Claim at the ready state", async () => {
  const source = await readFile(mobileAppUrl, "utf8");

  assert.match(source, /welcomeRewardStatus\?\.isEligible && !welcomeRewardStatus\?\.isClaimed/);
  assert.match(source, /welcomeRewardStatus\.isReady && <button[^>]+>Claim God Pack<\/button>/);
  assert.match(source, /welcomeRewardStatus\.isReady \? "Your free God Pack is ready"/);
});
