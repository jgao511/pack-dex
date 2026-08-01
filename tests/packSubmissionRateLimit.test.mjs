import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260731173000_atomic_pack_submission_rate_limits.sql", import.meta.url);
const desktopAppUrl = new URL("../src/App.jsx", import.meta.url);
const desktopRevealUrl = new URL("../src/components/CardReveal.jsx", import.meta.url);
const desktopSummaryUrl = new URL("../src/components/PullSummary.jsx", import.meta.url);
const mobileAppUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);
const desktopCloudUrl = new URL("../src/lib/cloudCollection.js", import.meta.url);
const mobileCloudUrl = new URL("../mobile-app/src/lib/cloudCollection.js", import.meta.url);
const retiredEdgeUrl = new URL("../supabase/functions/record-pack-open/index.ts", import.meta.url);
const hardeningMigrationUrl = new URL("../supabase/migrations/20260801120000_harden_pack_submission_execution_context.sql", import.meta.url);

test("the existing collection RPC atomically rate-limits one completed pack per call", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /create function public\.increment_collection_cards\(batches jsonb\)/);
  assert.match(migration, /jsonb_array_length\(\$1\) <> 1/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_user_id::text, 0\)\)/);
  assert.match(migration, /clock_timestamp\(\)/);
  assert.match(migration, /created_at > v_now - interval '1 second'/);
  assert.match(migration, /created_at > v_now - interval '60 seconds'/);
  assert.match(migration, /\) >= 30 then/);
  assert.match(migration, /pack_rate_limit_one_second/);
  assert.match(migration, /pack_rate_limit_sixty_seconds/);
});

test("a rejected submission logs only safe identifiers and returns before pack data writes", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const rejectionStart = migration.indexOf("if v_reason is not null then");
  const rejectionEnd = migration.indexOf("v_now := clock_timestamp();", rejectionStart);
  const rejectionBranch = migration.slice(rejectionStart, rejectionEnd);

  assert.match(rejectionBranch, /user_pack_open_rate_limit_rejections/);
  assert.match(rejectionBranch, /user_id,\s*rejected_at,\s*reason,\s*client_event_id/);
  assert.match(rejectionBranch, /false, v_reason,\s*false/);
  assert.match(rejectionBranch, /return;/);
  assert.doesNotMatch(rejectionBranch, /user_collection\s|user_pack_open_events\s|user_profile_stats as stats_row\(/);
  assert.doesNotMatch(migration, /token|password|authorization/i);
});

test("normal clients cannot use the legacy event-only write paths", async () => {
  const [migration, edge] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(retiredEdgeUrl, "utf8"),
  ]);

  assert.match(migration, /revoke execute on function public\.record_pack_open_event[\s\S]*from authenticated/);
  assert.match(edge, /PACK_WRITE_PATH_RETIRED/);
  assert.match(edge, /410/);
  assert.doesNotMatch(edge, /user_pack_open_events|user_profile_stats/);
});

test("pack RPC execution contexts retain fixed search paths and least-privilege grants", async () => {
  const migration = await readFile(hardeningMigrationUrl, "utf8");

  assert.match(migration, /alter function public\.increment_collection_cards\(jsonb\)[\s\S]*set search_path = public, pg_temp/);
  assert.match(migration, /revoke all on function public\.increment_collection_cards\(jsonb\)[\s\S]*from public, anon, service_role/);
  assert.match(migration, /grant execute on function public\.increment_collection_cards\(jsonb\)[\s\S]*to authenticated/);
  assert.match(migration, /revoke all on function public\.record_pack_open_event\(text, text, timestamptz\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.record_pack_open_event\(text, text, timestamptz\)[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on all functions/i);
});

test("both clients single-flight Open Another while persisting only completed reveals", async () => {
  const [desktopApp, desktopReveal, desktopSummary, mobileApp] = await Promise.all([
    readFile(desktopAppUrl, "utf8"),
    readFile(desktopRevealUrl, "utf8"),
    readFile(desktopSummaryUrl, "utf8"),
    readFile(mobileAppUrl, "utf8"),
  ]);

  assert.match(desktopApp, /packOperationRef\.current \|\|\s*packSavePromiseRef\.current/);
  assert.match(desktopApp, /persistedPackEventIdsRef\.current\.has\(clientEventId\)/);
  assert.match(desktopApp, /isOpeningAnother=\{isPackSavePending \|\| isOpenAnotherLocked\}/);
  assert.ok(desktopReveal.indexOf("onCardsRevealed(cards)") < desktopReveal.indexOf("onComplete()"));
  assert.match(desktopSummary, /isSaving \? "Saving\.\.\."/);
  assert.match(mobileApp, /completionClaimed[\s\S]*startPackPersistence\(pack, selectedSet\)/);
  assert.match(mobileApp, /openAnotherLockRef\.current \|\| packOpeningOperationRef\.current \|\| packSavePendingRef\.current/);
});

test("rate-limit results use the shared controlled backoff queue", async () => {
  const [desktopCloud, mobileCloud] = await Promise.all([
    readFile(desktopCloudUrl, "utf8"),
    readFile(mobileCloudUrl, "utf8"),
  ]);

  for (const source of [desktopCloud, mobileCloud]) {
    assert.match(source, /PACK_RATE_LIMIT_ERROR_CODE = "PACK_RATE_LIMITED"/);
    assert.match(source, /this\.retryable = false/);
    assert.match(source, /syncCompletedPackQueue/);
  }
});
