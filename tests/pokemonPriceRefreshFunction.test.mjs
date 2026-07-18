import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("consumer price function validates a bounded catalog-backed batch", async () => {
  const source = await readFile(new URL("../supabase/functions/refresh-pokemon-prices/index.ts", import.meta.url), "utf8");
  assert.match(source, /const MAX_CARDS = 50/);
  assert.match(source, /body\.cards\.length > MAX_CARDS/);
  assert.match(source, /new Map\(requested\.map/);
  assert.match(source, /catalogById\.get\(item\.setId\)/);
  assert.match(source, /validateRequestedCards/);
  assert.match(source, /consume_public_pull_share_rate_limit/);
  assert.match(source, /\.upsert\(uniqueRefreshedRows/);
  assert.doesNotMatch(source, /for \(const[^)]*requested[^)]*\)[\s\S]{0,500}\.from\("card_prices"\)/);
});

test("consumer price function rechecks only requested rows and returns compact partial results", async () => {
  const source = await readFile(new URL("../supabase/functions/refresh-pokemon-prices/index.ts", import.meta.url), "utf8");
  assert.match(source, /\.from\("card_prices"\)\.select\(PRICE_COLUMNS\)\.in\("card_id", requestedIds\)\.gte\("synced_at", freshSince\)/);
  assert.match(source, /runBoundedGroups\(groups/);
  assert.match(source, /updatedPrices: returnedRows/);
  assert.match(source, /failedSets: uniqueFailedSets/);
  assert.match(source, /const freshKeys = new Set/);
  assert.match(source, /const pending = validated\.filter/);
  assert.match(source, /const groups = new Map<string, UpstreamGroup>/);
  assert.match(source, /groups\.get\(set\.apiSetId\)/);
  assert.match(source, /partial_success/);
  assert.match(source, /total_failure/);
  assert.match(source, /maxConcurrentGroups/);
  assert.doesNotMatch(source, /Promise\.all\(groups/);
  assert.doesNotMatch(source, /for \(const[^)]*validated[^)]*\)[\s\S]{0,600}fetch\(/);
  assert.equal((source.match(/\.upsert\(/g) || []).length, 1);
});
