import { supabase as defaultSupabase } from "./supabaseClient.js";
import { getPokemonTcgApiSetId } from "./priceSetMap.js";
import { getPriceSetAlias } from "./priceSetAliases.js";
import { countDevRequest } from "../../mobile-app/src/utils/requestDiagnostics.js";
import { calculateValueCoverage } from "./priceCoverage.js";

export const VALUE_COUNT_THRESHOLD_USD = 1;
const PRICE_SELECT_COLUMNS =
  "card_id,set_id,card_number,name,rarity,price_type,market_price_usd,low_price_usd,mid_price_usd,high_price_usd,direct_low_price_usd,tcgplayer_url,source_updated_at,synced_at";
const setPriceResults = new Map();
const setPricePromises = new Map();
const collectionPriceResults = new Map();
const collectionPricePromises = new Map();

function getBestPrice(row) {
  return row?.market_price_usd ?? null;
}

export function normalizeCardNumber(value) {
  return String(value || "").trim().replace(/^0+(\d)/, "$1").toLowerCase();
}

function slugifyCardName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPackDexPriceKeyFromRow(row) {
  if (!row?.set_id || !row?.card_number || !row?.name) return null;

  return `${row.set_id}-${normalizeCardNumber(row.card_number)}-${slugifyCardName(row.name)}`;
}

function getApiSetIdForPackDexSet(setId) {
  return getPokemonTcgApiSetId(setId) || getPriceSetAlias(setId)?.pokemonTcgApiSetId || null;
}

function getPriceSetLookupIds(setId) {
  return [...new Set([setId, getApiSetIdForPackDexSet(setId)].filter(Boolean).map(String))];
}

function getCardPriceLookupKeys(card, setId) {
  const apiSetId = getApiSetIdForPackDexSet(setId);
  const apiCardId = apiSetId && card?.number ? `${apiSetId}-${normalizeCardNumber(card.number)}` : null;
  const keys = [card?.id, card?.card_id, card?.tcgplayerId, card?.pokemonTcgId, card?.apiId, apiCardId]
    .filter(Boolean)
    .map(String);

  return [...new Set(keys)];
}

export function resolveCardPriceIds(card, setId) {
  return getCardPriceLookupKeys(card, setId);
}

function normalizePriceRow(row) {
  if (!row) return null;
  const rawMarketPrice = Number(getBestPrice(row));
  const marketPrice = Number.isFinite(rawMarketPrice) && rawMarketPrice > 0 ? rawMarketPrice : null;

  return {
    cardId: row.card_id,
    setId: row.set_id,
    cardNumber: row.card_number,
    name: row.name,
    rarity: row.rarity,
    priceType: row.price_type,
    marketPriceUsd: marketPrice,
    lowPriceUsd: row.low_price_usd == null ? null : Number(row.low_price_usd),
    midPriceUsd: row.mid_price_usd == null ? null : Number(row.mid_price_usd),
    highPriceUsd: row.high_price_usd == null ? null : Number(row.high_price_usd),
    directLowPriceUsd: row.direct_low_price_usd == null ? null : Number(row.direct_low_price_usd),
    tcgplayerUrl: row.tcgplayer_url || "",
    sourceUpdatedAt: row.source_updated_at || null,
    syncedAt: row.synced_at || null,
  };
}

export function indexPriceRows(rows = []) {
  const priceMap = new Map();

  rows.forEach((row) => {
    const normalized = normalizePriceRow(row);
    if (!normalized) return;

    if (normalized.cardId) priceMap.set(String(normalized.cardId), normalized);
    const packDexPriceKey = getPackDexPriceKeyFromRow(row);
    if (packDexPriceKey) priceMap.set(packDexPriceKey, normalized);
  });

  return priceMap;
}

async function fetchCardPricesForSet(supabaseOrSetId, maybeSetId) {
  const supabaseClient = typeof supabaseOrSetId === "string" ? defaultSupabase : supabaseOrSetId;
  const setId = typeof supabaseOrSetId === "string" ? supabaseOrSetId : maybeSetId;

  if (!supabaseClient || !setId) return new Map();

  const setLookupIds = getPriceSetLookupIds(setId);

  const rows = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabaseClient
      .from("card_prices")
      .select(PRICE_SELECT_COLUMNS)
      .in("set_id", setLookupIds)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("[PackDex prices] card_prices set query failed", { setId, from, error });
      throw error;
    }

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return indexPriceRows(rows);
}

export function loadCardPricesForSet(supabaseOrSetId, maybeSetId) {
  const setId = typeof supabaseOrSetId === "string" ? supabaseOrSetId : maybeSetId;
  const key = String(setId || "");
  if (!key) return Promise.resolve(new Map());
  if (setPriceResults.has(key)) return Promise.resolve(setPriceResults.get(key));
  if (setPricePromises.has(key)) return setPricePromises.get(key);

  countDevRequest("loadCardPricesForSet");
  const promise = fetchCardPricesForSet(supabaseOrSetId, maybeSetId)
    .then((result) => {
      setPriceResults.set(key, result);
      return result;
    })
    .finally(() => setPricePromises.delete(key));
  setPricePromises.set(key, promise);
  return promise;
}

export async function loadAllCardPrices(supabaseClient = defaultSupabase) {
  if (!supabaseClient) return { priceMapsBySet: {}, setTotalsBySet: {}, rows: [] };

  const rows = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabaseClient
      .from("card_prices")
      .select(PRICE_SELECT_COLUMNS)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("[PackDex prices] all card_prices query failed", { from, to: from + pageSize - 1, error });
      throw error;
    }

    rows.push(...(data || []));

    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  const rowsBySet = {};
  rows.forEach((row) => {
    if (!row.set_id) return;
    rowsBySet[row.set_id] = [...(rowsBySet[row.set_id] || []), row];
  });

  const priceMapsBySet = Object.fromEntries(
    Object.entries(rowsBySet).map(([setId, setRows]) => [setId, indexPriceRows(setRows)])
  );
  const setTotalsBySet = Object.fromEntries(
    Object.entries(priceMapsBySet).map(([setId, priceMap]) => [setId, getPriceMapEstimatedValue(priceMap)])
  );

  return { priceMapsBySet, setTotalsBySet, rows };
}

function getCollectionPriceKeys(collectionCards = []) {
  const cardIds = new Set();
  const keysBySet = new Map();
  const localSetIdByLookupSetId = new Map();

  collectionCards.forEach((item) => {
    const card = item.card || item;
    const setId = item.set?.id || item.setId || item.set_id;

    if (!setId || !card) return;

    getPriceSetLookupIds(setId).forEach((lookupSetId) => {
      if (!localSetIdByLookupSetId.has(lookupSetId)) localSetIdByLookupSetId.set(lookupSetId, setId);
    });

    const keys = keysBySet.get(setId) || new Set();
    getCardPriceLookupKeys(card, setId).forEach((key) => {
      const normalizedKey = String(key);
      keys.add(normalizedKey);
      cardIds.add(normalizedKey);
    });
    getPriceSetLookupIds(setId).forEach((lookupSetId) => keysBySet.set(lookupSetId, keys));
  });

  return { cardIds: [...cardIds], keysBySet, localSetIdByLookupSetId };
}

function chunkItems(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchCardPricesForCollection(supabaseOrCollectionCards, maybeCollectionCards) {
  const supabaseClient = Array.isArray(supabaseOrCollectionCards) ? defaultSupabase : supabaseOrCollectionCards;
  const collectionCards = Array.isArray(supabaseOrCollectionCards) ? supabaseOrCollectionCards : maybeCollectionCards;

  if (!supabaseClient || !Array.isArray(collectionCards) || collectionCards.length === 0) {
    return { priceMapsBySet: {}, totalValue: 0, rows: [] };
  }

  const { cardIds, keysBySet, localSetIdByLookupSetId } = getCollectionPriceKeys(collectionCards);

  if (cardIds.length === 0) {
    return { priceMapsBySet: {}, totalValue: 0, rows: [] };
  }

  const rows = [];
  const rowIds = new Set();

  if (cardIds.length > 0) {
    const chunks = chunkItems(cardIds, 500);

    for (const chunk of chunks) {
      const { data, error } = await supabaseClient
        .from("card_prices")
        .select(PRICE_SELECT_COLUMNS)
        .in("card_id", chunk);

      if (error) {
        console.error("[PackDex prices] card_prices account query failed", { cardCount: collectionCards.length, error });
        throw error;
      }

      (data || []).forEach((row) => {
        const rowId = row.card_id || `${row.set_id}:${row.card_number}:${row.name}`;
        if (rowIds.has(rowId)) return;
        rowIds.add(rowId);
        rows.push(row);
      });
    }
  }

  const rowsBySet = {};

  rows.forEach((row) => {
    const setId = row.set_id;
    const wantedKeys = keysBySet.get(setId);
    const rowKeys = [row.card_id, getPackDexPriceKeyFromRow(row)].filter(Boolean);

    if (!wantedKeys || !rowKeys.some((key) => wantedKeys.has(String(key)))) return;

    const localSetId = localSetIdByLookupSetId.get(setId) || setId;
    rowsBySet[localSetId] = [...(rowsBySet[localSetId] || []), row];
  });

  const priceMapsBySet = Object.fromEntries(
    Object.entries(rowsBySet).map(([setId, rows]) => [setId, indexPriceRows(rows)])
  );

  return {
    priceMapsBySet,
    totalValue: getCollectionEstimatedValue(collectionCards, priceMapsBySet),
    rows,
  };
}

export function loadCardPricesForCollection(supabaseOrCollectionCards, maybeCollectionCards) {
  const collectionCards = Array.isArray(supabaseOrCollectionCards) ? supabaseOrCollectionCards : maybeCollectionCards;
  const key = (collectionCards || [])
    .map((item) => `${item.set?.id || item.setId || item.set_id}:${item.card?.id || item.id || item.card?.number || item.number}:${item.count || item.quantity || 1}`)
    .sort()
    .join("|");
  if (!key) return Promise.resolve({ priceMapsBySet: {}, totalValue: 0, rows: [] });
  if (collectionPriceResults.has(key)) return Promise.resolve(collectionPriceResults.get(key));
  if (collectionPricePromises.has(key)) return collectionPricePromises.get(key);

  countDevRequest("loadCardPricesForCollection");
  const promise = fetchCardPricesForCollection(supabaseOrCollectionCards, maybeCollectionCards)
    .then((result) => {
      collectionPriceResults.set(key, result);
      return result;
    })
    .finally(() => collectionPricePromises.delete(key));
  collectionPricePromises.set(key, promise);
  return promise;
}

export function getCardDisplayPrice(card, priceMap, setId = null) {
  if (!card || !priceMap) return null;

  for (const key of getCardPriceLookupKeys(card, setId || card.setId || card.set_id)) {
    if (priceMap.has(key)) return priceMap.get(key);
  }

  return null;
}

export async function loadCardPricesForCards(supabaseClient = defaultSupabase, set, cards = []) {
  countDevRequest("loadCardPricesForCards");
  if (!cards.length) return new Map();
  const setId = set?.id || set;
  const result = await loadCardPricesForCollection(
    supabaseClient,
    cards.map((card) => ({ setId, card, quantity: 1 }))
  );
  return result.priceMapsBySet[setId] || new Map();
}

export function getDisplayMarketPrice(card, priceMap, setId = null) {
  const price = getCardDisplayPrice(card, priceMap, setId);
  return price?.marketPriceUsd == null ? null : price.marketPriceUsd;
}

export function getPriceMapEstimatedValue(priceMap, threshold = 0) {
  if (!(priceMap instanceof Map)) return 0;

  const uniquePrices = new Map();
  priceMap.forEach((price) => {
    const key = price?.cardId || `${price?.setId}:${price?.cardNumber}:${price?.name}`;
    if (key) uniquePrices.set(key, price);
  });

  return [...uniquePrices.values()].reduce((total, price) => {
    const marketPrice = Number(price?.marketPriceUsd);

    if (!Number.isFinite(marketPrice) || marketPrice <= 0 || marketPrice < threshold) return total;

    return total + marketPrice;
  }, 0);
}

export function getCollectionEstimatedValue(collectionCards = [], priceMapOrMaps, threshold = 0) {
  return collectionCards.reduce((total, item) => {
    const card = item.card || item;
    const setId = item.set?.id || item.setId || item.set_id;
    const count = Number(item.count || item.quantity || 1);
    const priceMap =
      priceMapOrMaps instanceof Map
        ? priceMapOrMaps
        : priceMapOrMaps?.[setId] || priceMapOrMaps?.get?.(setId);
    const marketPrice = Number(getDisplayMarketPrice(card, priceMap, setId));

    if (!Number.isFinite(marketPrice) || marketPrice <= 0 || marketPrice < threshold) return total;

    return total + marketPrice * count;
  }, 0);
}

export function getCollectionValueCoverage(collectionCards = [], priceMapOrMaps, threshold = 0) {
  return calculateValueCoverage(collectionCards, (item) => {
    const card = item.card || item;
    const setId = item.set?.id || item.setId || item.set_id;
    const priceMap = priceMapOrMaps instanceof Map ? priceMapOrMaps : priceMapOrMaps?.[setId] || priceMapOrMaps?.get?.(setId);
    return getDisplayMarketPrice(card, priceMap, setId);
  }, threshold);
}

export function formatUsd(value, options = {}) {
  if (value == null || Number.isNaN(Number(value))) return "";

  return Number(value).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  });
}
