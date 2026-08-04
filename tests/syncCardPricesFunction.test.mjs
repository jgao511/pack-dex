import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePromise = readFile(new URL("../supabase/functions/sync-card-prices/index.ts", import.meta.url), "utf8");

test("sync uses the shared canonical matcher and stores identity rows without requiring a price", async () => {
  const source = await sourcePromise;
  assert.match(source, /buildCanonicalCardLookup/);
  assert.match(source, /matchCanonicalCard/);
  assert.match(source, /isCanonicalIdentityConsistent/);
  assert.match(source, /selectTcgplayerPrice/);
  assert.match(source, /requireVerifiedProduct: true/);
  assert.match(source, /rows\.push\(buildMarketplaceRow/);
  assert.doesNotMatch(source, /if \(!selectedPrice\)[\s\S]{0,180}continue;/);
  assert.doesNotMatch(source, /ACCEPTED_PRICE_TYPES/);
});

test("temporary no-price responses do not delete a matched canonical identity", async () => {
  const source = await sourcePromise;
  const noPriceBranch = source.match(/if \(!selection\.priceType\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(noPriceBranch, /skippedNoMarketPrice/);
  assert.doesNotMatch(noPriceBranch, /staleCardIds|delete/);
  assert.match(source, /preserveCanonicalMarketplaceIdentity/);
  assert.match(source, /select\("card_id,tcgplayer_url,source_updated_at"\)/);
});

test("replacement identities and stale deletions use one database transaction", async () => {
  const source = await sourcePromise;
  assert.match(source, /admin\.rpc\("packdex_apply_card_price_sync"/);
  assert.match(source, /p_rows: rowsWithPreservedIdentity/);
  assert.match(source, /p_stale_card_ids: uniqueStaleCardIds/);
  const migration = await readFile(new URL("../supabase/migrations/20260804010000_atomic_card_price_sync.sql", import.meta.url), "utf8");
  assert.match(migration, /insert into public\.card_prices[\s\S]*?delete from public\.card_prices/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.match(migration, /revoke all on function[\s\S]*?from public/);
  assert.match(migration, /grant execute on function[\s\S]*?to service_role/);
});

test("failed API subsets preserve prior rows while successful subsets can still sync", async () => {
  const source = await sourcePromise;
  assert.match(source, /Promise\.allSettled\(apiSetIds\.map/);
  assert.match(source, /successfulFetches/);
  assert.match(source, /stalePricesPreserved/);
  assert.match(source, /apiErrors/);
  assert.match(source, /UPSTREAM_TIMEOUT_MS/);
  assert.match(source, /UPSTREAM_MAX_ATTEMPTS/);
  assert.match(source, /shouldRetryUpstreamStatus/);
  assert.match(source, /AbortSignal\.timeout/);
});

test("an explicitly requested exact card can recover a failed subset without scheduled request amplification", async () => {
  const source = await sourcePromise;
  assert.match(source, /apiCardIds/);
  assert.match(source, /\.slice\(0, 50\)/);
  assert.match(source, /\/cards\/\$\{encodeURIComponent\(apiCardId\)\}/);
  assert.match(source, /cardBySourceId\.get\(compactId\(apiCardId\)\)/);
  assert.match(source, /!successfulApiSetIds\.has\(compactId\(appCard\.sourceSetId\)\)/);
  assert.match(source, /exactFallbackCardsFetched/);
  assert.doesNotMatch(source, /exactFallbackIds\s*=\s*cards\.map/);
});

test("read-only audit mode never writes price rows", async () => {
  const source = await sourcePromise;
  assert.match(source, /const dryRun = body\?\.dryRun === true/);
  assert.match(source, /if \(!dryRun && rows\.length > 0\)/);
  assert.doesNotMatch(source, /admin\.rpc\("packdex_apply_card_price_sync"[\s\S]*?if \(dryRun\)/);
});

test("production metrics distinguish identity coverage from accepted market coverage", async () => {
  const source = await sourcePromise;
  for (const field of [
    "exactCardMatches",
    "cardsWithTcgplayer",
    "cardsWithCanonicalUrl",
    "cardsWithUrlNoMarketPrice",
    "cardsWithNoMapping",
    "marketPricesUpserted",
    "suspiciousMappings",
    "latestSourceUpdatedAt",
    "selectionReasonCounts",
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`));
  }
});
