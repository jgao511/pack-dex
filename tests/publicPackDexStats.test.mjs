import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PUBLIC_STATS_CACHE_KEY,
  PUBLIC_STATS_CACHE_TTL_MS,
  formatPublicStat,
  getPublicPackDexStats,
  normalizePublicPackDexStats,
  readCachedPublicPackDexStats,
} from "../src/lib/publicPackDexStats.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("public activity values use locale-aware grouping at all requested sizes", () => {
  assert.equal(formatPublicStat(0, "en-US"), "0");
  assert.equal(formatPublicStat(999, "en-US"), "999");
  assert.equal(formatPublicStat(1_000, "en-US"), "1,000");
  assert.equal(formatPublicStat(1_284_730, "en-US"), "1,284,730");
  assert.equal(formatPublicStat(1_284_730, "de-DE"), "1.284.730");
});

test("public stats normalization accepts the one-row Supabase RPC response", () => {
  assert.deepEqual(
    normalizePublicPackDexStats([{
      cards_pulled: "1284730",
      packs_opened: "128611",
      updated_at: "2026-07-24T15:30:00Z",
    }]),
    {
      cardsPulled: 1_284_730,
      packsOpened: 128_611,
      updatedAt: "2026-07-24T15:30:00Z",
    }
  );
  assert.equal(normalizePublicPackDexStats([{ cards_pulled: -1 }]), null);
});

test("a fresh ten-minute cache prevents another public RPC request", async () => {
  const storage = new MemoryStorage();
  const now = 700_000;
  storage.setItem(PUBLIC_STATS_CACHE_KEY, JSON.stringify({
    cachedAt: now - PUBLIC_STATS_CACHE_TTL_MS + 1,
    stats: { cardsPulled: 12_345, packsOpened: 1_234, updatedAt: null },
  }));
  const client = { rpc: async () => assert.fail("fresh cache should not request") };

  const stats = await getPublicPackDexStats({ client, storage, now });

  assert.equal(stats.cardsPulled, 12_345);
  assert.equal(readCachedPublicPackDexStats({ storage, now }).isFresh, true);
});

test("an expired cache is refreshed and the successful response is cached", async () => {
  const storage = new MemoryStorage();
  const now = 2_000_000;
  storage.setItem(PUBLIC_STATS_CACHE_KEY, JSON.stringify({
    cachedAt: now - PUBLIC_STATS_CACHE_TTL_MS,
    stats: { cardsPulled: 100, packsOpened: 10, updatedAt: null },
  }));
  let requests = 0;
  const client = {
    async rpc(name) {
      requests += 1;
      assert.equal(name, "get_public_packdex_stats");
      return {
        data: [{ cards_pulled: 200, packs_opened: 20, updated_at: null }],
        error: null,
      };
    },
  };

  const stats = await getPublicPackDexStats({ client, storage, now });

  assert.equal(requests, 1);
  assert.equal(stats.cardsPulled, 200);
  assert.equal(readCachedPublicPackDexStats({ storage, now }).isFresh, true);
});

test("offline and failed requests fall back to stale cache but never invent zero", async () => {
  const storage = new MemoryStorage();
  const now = 3_000_000;
  storage.setItem(PUBLIC_STATS_CACHE_KEY, JSON.stringify({
    cachedAt: now - PUBLIC_STATS_CACHE_TTL_MS - 1,
    stats: { cardsPulled: 777, packsOpened: 70, updatedAt: null },
  }));
  const client = {
    async rpc() {
      return { data: null, error: new Error("offline") };
    },
  };

  const cached = await getPublicPackDexStats({ client, storage, now });
  assert.equal(cached.cardsPulled, 777);

  await assert.rejects(
    getPublicPackDexStats({ client, storage: new MemoryStorage(), now }),
    /offline/
  );
});

test("migration exposes one aggregate RPC without anonymous table access", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260724153000_public_packdex_stats.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /create table if not exists public\.packdex_public_stats/);
  assert.match(migration, /add column if not exists cards_added integer not null default 0/);
  assert.match(migration, /on conflict on constraint user_collection_increment_events_pkey do nothing/);
  assert.match(migration, /on conflict on constraint user_collection_user_id_set_id_card_id_key do update/);
  assert.match(migration, /after insert on public\.user_collection_increment_events/);
  assert.match(migration, /after update of welcome_reward_cards_saved_at on public\.user_welcome_rewards/);
  assert.match(migration, /after insert on public\.user_pack_open_events/);
  assert.match(migration, /create or replace function public\.get_public_packdex_stats\(\)/);
  assert.match(migration, /security definer[\s\S]*?set search_path = pg_catalog, public/);
  assert.match(migration, /grant execute on function public\.get_public_packdex_stats\(\) to anon, authenticated/);
  assert.match(migration, /revoke all on table public\.packdex_public_stats from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant select on (?:table )?public\.user_(?:collection|pack_open_events)/);
});
