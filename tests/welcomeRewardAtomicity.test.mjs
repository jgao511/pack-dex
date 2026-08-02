import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260802223000_atomic_welcome_reward_claim.sql",
  import.meta.url
);
const claimFunctionUrl = new URL(
  "../supabase/functions/claim-welcome-god-pack/index.ts",
  import.meta.url
);
const sharedRewardUrl = new URL(
  "../supabase/functions/_shared/welcomeRewardPackdex.ts",
  import.meta.url
);

test("welcome reward mutation is one service-role-only serialized transaction", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create or replace function public\.claim_welcome_god_pack_v1/);
  assert.match(sql, /language plpgsql\s+security definer\s+set search_path = pg_catalog, public/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/);
  assert.match(sql, /revoke all on function public\.claim_welcome_god_pack_v1[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.claim_welcome_god_pack_v1[\s\S]*to service_role/);
  assert.match(sql, /has_function_privilege\('authenticated'.*'EXECUTE'\)/);
  assert.match(sql, /has_function_privilege\('anon'.*'EXECUTE'\)/);
});

test("welcome reward applies one receipt, one event, and additive quantities", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /insert into public\.user_collection_increment_events/);
  assert.match(sql, /cards_added[\s\S]*10/);
  assert.match(sql, /insert into public\.user_pack_open_events/);
  assert.match(sql, /on conflict on constraint user_collection_user_id_set_id_card_id_key do update\s+set quantity = target\.quantity \+ excluded\.quantity/i);
  assert.match(sql, /packs_opened = profile\.packs_opened \+ excluded\.packs_opened/);
  assert.match(sql, /total_cards_pulled = profile\.total_cards_pulled \+ excluded\.total_cards_pulled/);
  assert.doesNotMatch(sql, /set quantity = excluded\.quantity/);
});

test("public reward cards are counted exactly once across old and new function versions", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /welcome_reward_collection_event_id text/);
  assert.match(sql, /receipt\.client_event_id = new\.welcome_reward_collection_event_id/);
  assert.match(sql, /if new\.welcome_reward_collection_event_id is not null[\s\S]*return new;/);
  assert.equal((sql.match(/welcome_reward_collection_event_id = v_event_id/g) || []).length, 1);
  assert.doesNotMatch(sql, /update public\.user_welcome_rewards\s+set welcome_reward_collection_event_id/i);
});

test("Edge function has one collection mutation request and validates its exact acknowledgement", async () => {
  const [source, shared] = await Promise.all([
    readFile(claimFunctionUrl, "utf8"),
    readFile(sharedRewardUrl, "utf8"),
  ]);

  assert.equal((source.match(/admin\.rpc\("claim_welcome_god_pack_v1"/g) || []).length, 1);
  assert.doesNotMatch(source, /\.from\("user_collection"\)/);
  assert.doesNotMatch(source, /\.from\("user_profile_stats"\)/);
  assert.doesNotMatch(source, /\.from\("user_pack_open_events"\)/);
  assert.match(source, /Array\.isArray\(data\) \|\| data\.length !== 1/);
  assert.match(source, /acknowledgement\.recorded !== true/);
  assert.match(source, /acknowledgement\.already_processed !== false/);
  assert.doesNotMatch(shared, /upsertWelcomeRewardCards/);
  assert.doesNotMatch(shared, /incrementWelcomeRewardStats/);
});
