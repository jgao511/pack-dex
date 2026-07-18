import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("consumer price function validates a bounded catalog-backed batch", async () => {
  const source = await readFile(new URL("../supabase/functions/refresh-pokemon-prices/index.ts", import.meta.url), "utf8");
  assert.match(source, /const MAX_CARDS = 50/);
  assert.match(source, /body\.cards\.length > MAX_CARDS/);
  assert.match(source, /new Map\(requested\.map/);
  assert.match(source, /catalogById\.get\(setId\)/);
  assert.match(source, /cardIds\.has\(card\.id\)/);
  assert.match(source, /consume_public_pull_share_rate_limit/);
  assert.match(source, /\.upsert\(uniqueRows/);
  assert.doesNotMatch(source, /for \(const[^)]*requested[^)]*\)[\s\S]{0,500}\.from\("card_prices"\)/);
});

