import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePromise = readFile(new URL("../supabase/functions/sync-card-prices/index.ts", import.meta.url), "utf8");

test("sync uses the shared canonical matcher and stores identity rows without requiring a price", async () => {
  const source = await sourcePromise;
  assert.match(source, /buildCanonicalCardLookup/);
  assert.match(source, /matchCanonicalCard/);
  assert.match(source, /selectTcgplayerPrice/);
  assert.match(source, /rows\.push\(buildMarketplaceRow/);
  assert.doesNotMatch(source, /if \(!selectedPrice\)[\s\S]{0,180}continue;/);
  assert.doesNotMatch(source, /ACCEPTED_PRICE_TYPES/);
});

test("temporary no-price responses do not delete a matched canonical identity", async () => {
  const source = await sourcePromise;
  const noPriceBranch = source.match(/if \(!selection\.priceType\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(noPriceBranch, /skippedNoMarketPrice/);
  assert.doesNotMatch(noPriceBranch, /staleCardIds|delete/);
  assert.match(source, /\.eq\("set_id", setId\)[\s\S]*?\.in\("card_id", uniqueCardIds\)/);
  assert.match(source, /preserveCanonicalMarketplaceIdentity/);
  assert.match(source, /select\("card_id,tcgplayer_url,source_updated_at"\)/);
});

test("replacement identities are written before stale incorrect rows are deleted", async () => {
  const source = await sourcePromise;
  assert.ok(source.indexOf(".upsert(rowsWithPreservedIdentity") < source.indexOf("deleteStalePrices(admin, set.id"));
});

test("failed API subsets preserve prior rows while successful subsets can still sync", async () => {
  const source = await sourcePromise;
  assert.match(source, /Promise\.allSettled\(apiSetIds\.map/);
  assert.match(source, /successfulFetches/);
  assert.match(source, /stalePricesPreserved/);
  assert.match(source, /apiErrors/);
});

test("read-only audit mode never writes price rows", async () => {
  const source = await sourcePromise;
  assert.match(source, /const dryRun = body\?\.dryRun === true/);
  assert.match(source, /if \(!dryRun && staleCardIds\.length > 0\)/);
  assert.match(source, /if \(!dryRun && rows\.length > 0\)/);
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
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`));
  }
});
