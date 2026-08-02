import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadWelcomeRewardStatus } from "../src/lib/welcomeReward.js";

const claimSourceUrl = new URL(
  "../supabase/functions/claim-welcome-god-pack/index.ts",
  import.meta.url
);
const mobileAppUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);
const atomicClaimMigrationUrl = new URL(
  "../supabase/migrations/20260802223000_atomic_welcome_reward_claim.sql",
  import.meta.url
);

test("guest reward status is ineligible without making account data available", async () => {
  assert.deepEqual(await loadWelcomeRewardStatus(null), {
    isEligible: false,
    isClaimed: true,
    setId: "",
    claimedAt: "",
  });
});

test("welcome reward eligibility is counted and enforced by the authenticated server", async () => {
  const [source, migration] = await Promise.all([
    readFile(claimSourceUrl, "utf8"),
    readFile(atomicClaimMigrationUrl, "utf8"),
  ]);

  assert.match(source, /getAuthenticatedUser\(req\)/);
  assert.match(source, /admin\.rpc\("claim_welcome_god_pack_v1"/);
  assert.match(source, /p_user_id: user\.id/);
  assert.match(migration, /from public\.user_pack_open_events as eligible_event/);
  assert.match(migration, /eligible_event\.client_event_id not like 'welcome-god-pack:%'/);
  assert.match(migration, /if v_eligible_packs < 50 then/);
  assert.match(source, /Open 50 eligible packs before claiming this reward/);
  assert.match(source, /WELCOME_REWARD_SET_IDS\.has\(setId\)/);
});

test("49 remains locked, 50 is the first ready count, and duplicate claim events are idempotent", async () => {
  const [claimSource, rewardSource, migration] = await Promise.all([
    readFile(claimSourceUrl, "utf8"),
    readFile(new URL("../src/lib/welcomeReward.js", import.meta.url), "utf8"),
    readFile(atomicClaimMigrationUrl, "utf8"),
  ]);

  assert.match(migration, /if v_eligible_packs < 50 then/);
  assert.match(rewardSource, /isReady: eligiblePacks >= 50/);
  assert.match(rewardSource, /\.from\("user_pack_open_events"\)/);
  assert.match(rewardSource, /\.not\("client_event_id", "like", "welcome-god-pack:%"\)/);
  assert.match(claimSource, /const eventId = `welcome-god-pack:\$\{claimId\}`/);
  assert.match(migration, /'already_claimed'::text/);
  assert.match(migration, /already_processed boolean/);
  assert.match(migration, /v_existing_claimed and v_existing_saved_at is not null/);
});

test("claim uses one strict atomic acknowledgement and never retries ambiguous legacy state", async () => {
  const [source, migration] = await Promise.all([
    readFile(claimSourceUrl, "utf8"),
    readFile(atomicClaimMigrationUrl, "utf8"),
  ]);

  assert.match(source, /parseClaimAcknowledgement\(data\)/);
  assert.match(source, /acknowledgement\.recorded !== true/);
  assert.match(source, /acknowledgement\.already_processed !== false/);
  assert.match(source, /acknowledgement\.client_event_id !== eventId/);
  assert.match(source, /acknowledgement\.reward_claim_id !== claimId/);
  assert.match(source, /acknowledgement\.reward_set_id !== set\.id/);
  assert.match(source, /acknowledgement\.status === "legacy_pending_review"/);
  assert.match(migration, /'legacy_pending_review'::text/);
  assert.doesNotMatch(source, /\.from\("user_collection"\)/);
  assert.doesNotMatch(source, /\.from\("user_profile_stats"\)/);
  assert.doesNotMatch(source, /\.from\("user_pack_open_events"\)/);
});

test("mobile Profile hides claimed rewards and only exposes Claim at the ready state", async () => {
  const source = await readFile(mobileAppUrl, "utf8");

  assert.match(source, /welcomeRewardStatus\?\.isEligible && !welcomeRewardStatus\?\.isClaimed/);
  assert.match(source, /welcomeRewardStatus\.isReady && <button[^>]+>Claim God Pack<\/button>/);
  assert.match(source, /welcomeRewardStatus\.isReady \? "Your free God Pack is ready"/);
});
