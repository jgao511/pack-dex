import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_POKEMON_PRICE_REFRESH_CARDS,
  POKEMON_PRICE_REFRESH_MS,
  POKEMON_PRICE_REFRESH_STORAGE_KEY,
  canAttemptPokemonPriceRefresh,
  refreshPokemonPrices,
  selectPokemonPriceRefreshCards,
} from "../mobile-app/src/explore/pokemonPriceRefresh.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

function entry(id, rarity = "Common", releaseDate = "2025-01-01") {
  return { card: { id, name: id, number: id, rarity }, set: { id: `set-${id}`, releaseDate } };
}

test("price refresh selector excludes fresh rows and caps stale or missing cards", () => {
  const now = Date.parse("2026-07-18T12:00:00Z");
  const cards = Array.from({ length: 56 }, (_, index) => entry(`card-${index}`, index === 55 ? "Special Illustration Rare" : "Common"));
  const freshMap = new Map([[cards[0].card.id, { marketPriceUsd: 1, syncedAt: new Date(now - 1_000).toISOString() }]]);
  const staleMap = new Map([[cards[1].card.id, { marketPriceUsd: 40, syncedAt: new Date(now - POKEMON_PRICE_REFRESH_MS - 1).toISOString() }]]);
  const priceMapsBySet = { [cards[0].set.id]: freshMap, [cards[1].set.id]: staleMap };

  const selected = selectPokemonPriceRefreshCards(cards, {}, priceMapsBySet, now);
  assert.equal(selected.length, MAX_POKEMON_PRICE_REFRESH_CARDS);
  assert.ok(!selected.some(({ cardId }) => cardId === cards[0].card.id));
  assert.equal(selected[0].cardId, cards[1].card.id, "known higher-value stale cards are refreshed first");
});

test("owned cards are prioritized before value and rarity", () => {
  const owned = entry("owned", "Common");
  const valuable = entry("valuable", "Special Illustration Rare");
  const collection = { [owned.set.id]: { [owned.card.id]: { count: 1 } } };
  const selected = selectPokemonPriceRefreshCards([valuable, owned], collection, {}, Date.now());
  assert.equal(selected[0].cardId, owned.card.id);
});

test("refresh marks cooldown before one invocation and returns indexed rows", async () => {
  const storage = memoryStorage();
  const cards = [entry("shaymin")];
  let calls = 0;
  const client = {
    functions: {
      invoke: async (_name, { body }) => {
        calls += 1;
        assert.equal(body.cards.length, 1);
        assert.ok(storage.getItem(POKEMON_PRICE_REFRESH_STORAGE_KEY), "attempt is persisted before networking");
        return { data: { updated: 1, rows: [{ card_id: "shaymin", set_id: "set-shaymin", market_price_usd: 12, synced_at: new Date().toISOString() }] }, error: null };
      },
    },
  };

  const first = await refreshPokemonPrices({ speciesId: 492, cards, supabaseClient: client, storage });
  const second = await refreshPokemonPrices({ speciesId: 492, cards, supabaseClient: client, storage });
  assert.equal(first.attempted, true);
  assert.equal(first.priceMapsBySet["set-shaymin"].get("shaymin").marketPriceUsd, 12);
  assert.equal(second.attempted, false);
  assert.equal(calls, 1);
  assert.equal(canAttemptPokemonPriceRefresh(492, storage), false);
  const marker = JSON.parse(storage.getItem(POKEMON_PRICE_REFRESH_STORAGE_KEY))["492"];
  assert.equal(marker.status, "success");
  assert.ok(marker.lastSuccessfulAt > 0);
  assert.equal(marker.version, 1);
});

test("failed refresh keeps the cooldown and does not loop", async () => {
  const storage = memoryStorage();
  const client = { functions: { invoke: async () => ({ data: null, error: new Error("offline") }) } };
  const failed = await refreshPokemonPrices({ speciesId: 25, cards: [entry("pikachu")], supabaseClient: client, storage });
  assert.equal(failed.status, "failure");
  assert.deepEqual(failed.priceMapsBySet, {});
  const retry = await refreshPokemonPrices({ speciesId: 25, cards: [entry("pikachu")], supabaseClient: client, storage });
  assert.equal(retry.attempted, false);
  assert.equal(JSON.parse(storage.getItem(POKEMON_PRICE_REFRESH_STORAGE_KEY))["25"].status, "failure");
});

test("partial response rows merge directly without a second database fetch", async () => {
  const storage = memoryStorage();
  const cards = [entry("cached"), entry("updated")];
  let reads = 0;
  let invokes = 0;
  const stale = new Date(Date.now() - POKEMON_PRICE_REFRESH_MS - 5_000).toISOString();
  const client = {
    from: () => ({
      select() { return this; },
      in: async () => {
        reads += 1;
        return { data: [{ card_id: "cached", set_id: "set-cached", card_number: "cached", name: "cached", market_price_usd: 9, synced_at: stale }], error: null };
      },
    }),
    functions: { invoke: async () => {
      invokes += 1;
      return { data: { status: "partial_success", updatedCount: 1, failedSetCount: 1, updatedPrices: [{ card_id: "updated", set_id: "set-updated", market_price_usd: 22, synced_at: new Date().toISOString() }] }, error: null };
    } },
  };
  const result = await refreshPokemonPrices({ speciesId: 492, cards, supabaseClient: client, storage });
  assert.equal(reads, 1);
  assert.equal(invokes, 1);
  assert.equal(result.status, "partial_success");
  assert.equal(result.priceMapsBySet["set-cached"].get("cached").marketPriceUsd, 9);
  assert.equal(result.priceMapsBySet["set-updated"].get("updated").marketPriceUsd, 22);
});

test("total function failure still returns bounded cached values and clears the active attempt", async () => {
  const storage = memoryStorage();
  const cards = [entry("cached-on-failure")];
  const client = {
    from: () => ({ select() { return this; }, in: async () => ({ data: [{ card_id: "cached-on-failure", set_id: "set-cached-on-failure", card_number: "cached-on-failure", name: "cached-on-failure", market_price_usd: 7, synced_at: new Date(Date.now() - POKEMON_PRICE_REFRESH_MS - 1).toISOString() }], error: null }) }),
    functions: { invoke: async () => ({ data: { status: "total_failure", updatedPrices: [], failedSetCount: 1 }, error: null }) },
  };
  const result = await refreshPokemonPrices({ speciesId: 718, cards, supabaseClient: client, storage });
  assert.equal(result.status, "failure");
  assert.equal(result.priceMapsBySet["set-cached-on-failure"].get("cached-on-failure").marketPriceUsd, 7);
  assert.equal(JSON.parse(storage.getItem(POKEMON_PRICE_REFRESH_STORAGE_KEY))["718"].status, "failure");
});

test("one bounded cache read suppresses the upstream refresh when every row is fresh", async () => {
  const storage = memoryStorage();
  const cards = [entry("fresh-from-db")];
  let reads = 0;
  let invokes = 0;
  const client = {
    from: () => ({
      select() { return this; },
      in: async () => {
        reads += 1;
        return { data: [{ card_id: "fresh-from-db", set_id: "set-fresh-from-db", card_number: "fresh-from-db", name: "fresh-from-db", market_price_usd: 4, synced_at: new Date().toISOString() }], error: null };
      },
    }),
    functions: { invoke: async () => { invokes += 1; return { data: { rows: [] }, error: null }; } },
  };
  const result = await refreshPokemonPrices({ speciesId: 99999, cards, supabaseClient: client, storage });
  assert.equal(reads, 1);
  assert.equal(invokes, 0);
  assert.equal(result.attempted, false);
  assert.equal(result.priceMapsBySet["set-fresh-from-db"].get("fresh-from-db").marketPriceUsd, 4);
});

test("simultaneous renders share one in-flight species refresh", async () => {
  const storage = memoryStorage();
  let invokes = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = { functions: { invoke: async () => { invokes += 1; await gate; return { data: { status: "full_success", updatedPrices: [] }, error: null }; } } };
  const first = refreshPokemonPrices({ speciesId: 151, cards: [entry("mew")], supabaseClient: client, storage });
  const second = refreshPokemonPrices({ speciesId: 151, cards: [entry("mew")], supabaseClient: client, storage });
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(invokes, 1);
});
