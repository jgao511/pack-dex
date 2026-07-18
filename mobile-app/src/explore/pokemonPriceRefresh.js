import { getCardDisplayPrice, indexPriceRows, loadCardPricesForCollection } from "../../../src/lib/cardPrices.js";
import { getCardCount } from "../../../src/utils/collectionStorage.js";
import { getRarityRank } from "../../../src/utils/rarityRank.js";

export const POKEMON_PRICE_REFRESH_MS = 48 * 60 * 60 * 1000;
export const MAX_POKEMON_PRICE_REFRESH_CARDS = 50;
export const POKEMON_PRICE_REFRESH_STORAGE_KEY = "packdex:pokemon-price-refresh:v1";

const inFlightRefreshes = new Map();

function priceTimestamp(price) {
  const timestamp = Date.parse(price?.syncedAt || price?.sourceUpdatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function readAttempts(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(POKEMON_PRICE_REFRESH_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function canAttemptPokemonPriceRefresh(speciesId, storage = globalThis.localStorage, now = Date.now()) {
  const marker = readAttempts(storage)[String(speciesId)];
  const attemptedAt = Number(typeof marker === "number" ? marker : marker?.lastAttemptedAt || 0);
  return !attemptedAt || now - attemptedAt >= POKEMON_PRICE_REFRESH_MS;
}

export function markPokemonPriceRefreshAttempt(speciesId, storage = globalThis.localStorage, now = Date.now()) {
  try {
    const attempts = readAttempts(storage);
    const current = attempts[String(speciesId)];
    attempts[String(speciesId)] = {
      speciesId: String(speciesId),
      lastAttemptedAt: now,
      lastSuccessfulAt: typeof current === "object" ? Number(current?.lastSuccessfulAt || 0) : 0,
      status: "attempted",
      version: 1,
    };
    storage?.setItem(POKEMON_PRICE_REFRESH_STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // Persistent cooldown is best-effort; the in-memory promise still deduplicates this session.
  }
}

function markPokemonPriceRefreshResult(speciesId, status, storage, now = Date.now()) {
  try {
    const attempts = readAttempts(storage);
    const current = attempts[String(speciesId)] || {};
    attempts[String(speciesId)] = {
      speciesId: String(speciesId),
      lastAttemptedAt: Number(current?.lastAttemptedAt || now),
      lastSuccessfulAt: status === "success" ? now : Number(current?.lastSuccessfulAt || 0),
      status,
      version: 1,
    };
    storage?.setItem(POKEMON_PRICE_REFRESH_STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // Cooldown metadata remains optional when storage is unavailable.
  }
}

export function selectPokemonPriceRefreshCards(
  cards = [],
  collection = {},
  priceMapsBySet = {},
  now = Date.now(),
) {
  const staleBefore = now - POKEMON_PRICE_REFRESH_MS;
  const unique = new Map();

  cards.forEach((entry) => {
    const setId = String(entry?.set?.id || "");
    const cardId = String(entry?.card?.id || "");
    if (!setId || !cardId) return;

    const price = getCardDisplayPrice(entry.card, priceMapsBySet?.[setId], setId);
    if (price && priceTimestamp(price) >= staleBefore) return;

    const key = `${setId}:${cardId}`;
    if (!unique.has(key)) {
      unique.set(key, {
        setId,
        cardId,
        owned: getCardCount(collection, entry.card, setId) > 0,
        currentPrice: Number(price?.marketPriceUsd || 0),
        rarityRank: getRarityRank(entry.card, entry.set),
        releaseDate: String(entry.set?.releaseDate || ""),
      });
    }
  });

  return [...unique.values()]
    .sort((a, b) =>
      Number(b.owned) - Number(a.owned) ||
      b.currentPrice - a.currentPrice ||
      a.rarityRank - b.rarityRank ||
      b.releaseDate.localeCompare(a.releaseDate) ||
      a.setId.localeCompare(b.setId) ||
      a.cardId.localeCompare(b.cardId)
    )
    .slice(0, MAX_POKEMON_PRICE_REFRESH_CARDS)
    .map(({ setId, cardId }) => ({ setId, cardId }));
}

export function indexPokemonPriceRefreshRows(rows = []) {
  const rowsBySet = {};
  rows.forEach((row) => {
    if (!row?.set_id) return;
    rowsBySet[row.set_id] = [...(rowsBySet[row.set_id] || []), row];
  });
  return Object.fromEntries(Object.entries(rowsBySet).map(([setId, setRows]) => [setId, indexPriceRows(setRows)]));
}

function mergePriceMaps(base = {}, incoming = {}) {
  const setIds = new Set([...Object.keys(base), ...Object.keys(incoming)]);
  return Object.fromEntries([...setIds].map((setId) => [setId, new Map([...(base[setId] || []), ...(incoming[setId] || [])])]));
}

export function refreshPokemonPrices({
  speciesId,
  cards = [],
  collection = {},
  priceMapsBySet = {},
  supabaseClient,
  storage = globalThis.localStorage,
  now = Date.now(),
}) {
  const key = String(speciesId || "");
  if (!key || !supabaseClient) {
    return Promise.resolve({ attempted: false, priceMapsBySet: {} });
  }
  if (inFlightRefreshes.has(key)) return inFlightRefreshes.get(key);

  let attemptMarked = false;
  const promise = (async () => {
    let cachedPriceMaps = {};
    if (typeof supabaseClient.from === "function" && cards.length > 0) {
      try {
        const cached = await loadCardPricesForCollection(supabaseClient, cards);
        cachedPriceMaps = cached.priceMapsBySet || {};
      } catch (error) {
        console.warn("[PackDex prices] bounded Pokémon cache read failed", error);
      }
    }
    const availablePriceMaps = mergePriceMaps(priceMapsBySet, cachedPriceMaps);
    if (!supabaseClient?.functions || !canAttemptPokemonPriceRefresh(key, storage, now)) {
      return { attempted: false, priceMapsBySet: availablePriceMaps };
    }

    const selectedCards = selectPokemonPriceRefreshCards(cards, collection, availablePriceMaps, now);
    if (selectedCards.length === 0) return { attempted: false, priceMapsBySet: availablePriceMaps };

    markPokemonPriceRefreshAttempt(key, storage, now);
    attemptMarked = true;
    const { data, error } = await supabaseClient.functions.invoke("refresh-pokemon-prices", { body: { speciesId: key, cards: selectedCards } });
      if (error) throw error;
      markPokemonPriceRefreshResult(key, "success", storage);
      return {
        attempted: true,
        requested: selectedCards.length,
        updated: Number(data?.updated || 0),
        priceMapsBySet: mergePriceMaps(availablePriceMaps, indexPokemonPriceRefreshRows(Array.isArray(data?.rows) ? data.rows : [])),
      };
    })()
    .catch((error) => {
      if (attemptMarked) markPokemonPriceRefreshResult(key, "failure", storage);
      throw error;
    })
    .finally(() => inFlightRefreshes.delete(key));

  inFlightRefreshes.set(key, promise);
  return promise;
}
