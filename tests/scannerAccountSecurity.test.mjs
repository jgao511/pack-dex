import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("scanner addition receipt is per-user, per-card, RLS protected, and cascading", async () => {
  const migration = await source("../supabase/migrations/20260716150000_scanner_card_actions.sql");

  assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /primary key \(user_id, card_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant select on table public\.user_scanner_card_additions to authenticated/);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(migration, /for insert\s+to authenticated/i);
});

test("scanner RPC derives auth identity, serializes writes, and makes duplicate calls no-ops", async () => {
  const migration = await source("../supabase/migrations/20260716150000_scanner_card_actions.sql");
  const functionBody = migration.match(/create or replace function public\.add_scanned_card_once[\s\S]*?grant execute on function public\.add_scanned_card_once\(text, text\) to authenticated;/)?.[0] || "";

  assert.notEqual(functionBody, "");
  assert.match(functionBody, /v_user_id uuid := auth\.uid\(\)/);
  assert.doesNotMatch(functionBody, /target_user_id|p_user_id/);
  assert.match(functionBody, /pg_advisory_xact_lock\(hashtextextended\(v_user_id::text, 0\)\)/);
  assert.match(functionBody, /on conflict \(user_id, card_id\) do nothing/);
  assert.match(functionBody, /if not v_receipt_inserted then[\s\S]*?return query select false, true/);
  assert.match(functionBody, /if not v_receipt_inserted then[\s\S]*?return;[\s\S]*?insert into public\.user_collection/);
  assert.match(functionBody, /revoke all on function public\.add_scanned_card_once\(text, text\) from public, anon/);
  assert.doesNotMatch(migration, /create or replace function public\.increment_collection_cards/);
});

test("normal pack increments remain independently repeatable", async () => {
  const migration = await source("../supabase/migrations/20260711170000_fix_increment_collection_cards_ambiguity.sql");

  assert.match(migration, /create or replace function public\.increment_collection_cards\(batches jsonb\)/);
  assert.match(migration, /set quantity = target\.quantity \+ excluded\.quantity/);
  assert.match(migration, /primary key \(user_id, client_event_id\)|on conflict \(user_id, client_event_id\) do nothing/);
});
