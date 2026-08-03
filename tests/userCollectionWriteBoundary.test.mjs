import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("normal clients cannot mutate authoritative collection rows directly", async () => {
  const [migration, hardening] = await Promise.all([
    source("../supabase/migrations/20260802210000_restrict_user_collection_direct_writes.sql"),
    source("../supabase/security_hardening.sql"),
  ]);

  for (const sql of [migration, hardening]) {
    assert.match(
      sql,
      /revoke all privileges on (?:table )?public\.user_collection from public, anon, authenticated/i
    );
    assert.match(sql, /grant select on (?:table )?public\.user_collection to authenticated/i);
    assert.doesNotMatch(sql, /grant\s+insert(?:\s*,\s*update)?\s+on\s+public\.user_collection\s+to\s+authenticated/i);
    assert.doesNotMatch(sql, /create policy "Users can (?:insert|update|upsert|sync|delete|reset|clear) their own collection"/i);
  }
});

test("the migration preserves each supported server-authoritative write boundary", async () => {
  const migration = await source(
    "../supabase/migrations/20260802210000_restrict_user_collection_direct_writes.sql"
  );

  assert.match(migration, /has_function_privilege\([\s\S]*?increment_collection_cards\(jsonb\)[\s\S]*?'EXECUTE'/);
  assert.match(migration, /has_function_privilege\([\s\S]*?add_scanned_card_once\(text,text\)[\s\S]*?'EXECUTE'/);
  assert.match(migration, /has_function_privilege\([\s\S]*?complete_mobile_onboarding_v1\(uuid,integer,text,text\[\],boolean\)[\s\S]*?'EXECUTE'/);
  assert.match(migration, /has_table_privilege\('service_role', 'public\.user_collection', 'SELECT'\)/);
  assert.match(migration, /has_table_privilege\('service_role', 'public\.user_collection', 'INSERT'\)/);
  assert.match(migration, /has_table_privilege\('service_role', 'public\.user_collection', 'UPDATE'\)/);
});

test("current desktop and mobile clients read collection rows and submit mutations through RPCs", async () => {
  const [desktopCollection, mobileCollection, snapshotLoader, queue, scanner, onboarding] = await Promise.all([
    source("../src/lib/cloudCollection.js"),
    source("../mobile-app/src/lib/cloudCollection.js"),
    source("../src/lib/collectionSnapshotLoader.js"),
    source("../src/lib/completedPackQueue.js"),
    source("../mobile-app/src/lib/scannerCardActions.js"),
    source("../supabase/functions/complete-mobile-onboarding/index.ts"),
  ]);

  for (const clientSource of [desktopCollection, mobileCollection]) {
    assert.match(clientSource, /collectionSnapshotLoader\.load\([\s\S]*?table: USER_COLLECTION_TABLE/);
    assert.doesNotMatch(
      clientSource,
      /\.from\(USER_COLLECTION_TABLE\)[\s\S]{0,240}?\.(?:insert|update|upsert|delete)\(/
    );
  }
  assert.match(snapshotLoader, /client[\s\S]*?\.from\(table\)[\s\S]*?\.select\(/);
  assert.match(snapshotLoader, /\.eq\("user_id", normalizedUserId\)/);
  assert.doesNotMatch(snapshotLoader, /\.(?:insert|update|upsert|delete)\(/);

  assert.match(queue, /client\.rpc\(ATOMIC_PACK_RPC_NAME, payload\)/);
  assert.match(queue, /ATOMIC_PACK_RPC_NAME/);
  assert.match(scanner, /\.rpc\("add_scanned_card_once"/);
  assert.match(onboarding, /admin\.rpc\("complete_mobile_onboarding_v1"/);
});

test("the retired authenticated open-pack endpoint cannot mutate collection state", async () => {
  const legacyEndpoint = await source("../supabase/functions/open-pack/index.ts");

  assert.match(legacyEndpoint, /PACKDEX_CLIENT_UPDATE_REQUIRED/);
  assert.match(legacyEndpoint, /retryable: false/);
  assert.match(legacyEndpoint, /410/);
  assert.doesNotMatch(legacyEndpoint, /user_collection|upsertCardsForUser|generatePack|service.role/i);
});
