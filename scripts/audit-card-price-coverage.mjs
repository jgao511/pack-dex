import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadAppPriceSyncData } from "./load-app-price-sync-data.mjs";
import { PRICE_SET_MAP } from "../src/lib/priceSetMap.js";
import { PRICE_SET_ALIASES } from "../src/lib/priceSetAliases.js";

const PRICE_SELECT_COLUMNS =
  "card_id,set_id,card_number,name,rarity,price_type,market_price_usd,low_price_usd,mid_price_usd,high_price_usd,direct_low_price_usd,tcgplayer_url,source_updated_at,synced_at";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  text.split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) return;

    const [, key, rawValue] = match;
    if (process.env[key]) return;

    process.env[key] = rawValue.trim().replace(/^['"]|['"]$/gu, "");
  });
}

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function getApiSetId(setId) {
  return PRICE_SET_MAP[setId] || PRICE_SET_ALIASES[setId]?.pokemonTcgApiSetId || null;
}

function getSetLookupIds(setId) {
  return [...new Set([setId, getApiSetId(setId)].filter(Boolean).map(String))];
}

function getValidMarketPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function normalizeCardNumber(value) {
  return String(value || "").trim().replace(/^0+(\d)/u, "$1").toLowerCase();
}

function slugifyCardName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/gu, "and")
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function getPackDexPriceKeyFromRow(row) {
  if (!row?.set_id || !row?.card_number || !row?.name) return null;

  return `${row.set_id}-${normalizeCardNumber(row.card_number)}-${slugifyCardName(row.name)}`;
}

function indexPriceRows(rows = []) {
  const priceMap = new Map();

  rows.forEach((row) => {
    if (!row) return;

    const rawMarketPrice = Number(row.market_price_usd);
    const normalized = {
      cardId: row.card_id,
      setId: row.set_id,
      cardNumber: row.card_number,
      name: row.name,
      marketPriceUsd: Number.isFinite(rawMarketPrice) && rawMarketPrice > 0 ? rawMarketPrice : null,
    };

    if (normalized.cardId) priceMap.set(String(normalized.cardId), normalized);
    const packDexPriceKey = getPackDexPriceKeyFromRow(row);
    if (packDexPriceKey) priceMap.set(packDexPriceKey, normalized);
  });

  return priceMap;
}

function resolveCardPriceIds(card, setId) {
  const apiSetId = getApiSetId(setId);
  const apiCardId = apiSetId && card?.number ? `${apiSetId}-${normalizeCardNumber(card.number)}` : null;
  const keys = [card?.id, card?.card_id, card?.tcgplayerId, card?.pokemonTcgId, card?.apiId, apiCardId]
    .filter(Boolean)
    .map(String);

  return [...new Set(keys)];
}

async function fetchPriceRowsForSet(supabase, lookupSetIds) {
  const rows = [];
  const pageSize = 1000;

  for (const lookupSetIdChunk of chunk(lookupSetIds, 20)) {
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("card_prices")
        .select(PRICE_SELECT_COLUMNS)
        .in("set_id", lookupSetIdChunk)
        .range(from, from + pageSize - 1);

      if (error) throw error;

      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
  }

  return rows;
}

function summarizeSet(set, rows) {
  const priceMap = indexPriceRows(rows);
  const cards = Array.isArray(set.cards) ? set.cards : [];
  const matchedCards = [];
  const validMarketCards = [];
  const unmatchedCards = [];

  cards.forEach((card) => {
    const keys = resolveCardPriceIds(card, set.id);
    const matchedPrice = keys.map((key) => priceMap.get(key)).find(Boolean) || null;
    const validMarketPrice = getValidMarketPrice(matchedPrice?.marketPriceUsd);

    if (matchedPrice) matchedCards.push(card);
    else unmatchedCards.push(card);

    if (validMarketPrice != null) validMarketCards.push(card);
  });

  return {
    setSlug: set.id,
    setName: set.name,
    pokemonTcgApiSetId: getApiSetId(set.id),
    totalLocalCards: cards.length,
    supabasePriceRowsFound: rows.length,
    localCardsMatchedToPriceRows: matchedCards.length,
    cardsWithValidMarketPriceUsd: validMarketCards.length,
    rowSetIdsFound: [...new Set(rows.map((row) => row.set_id).filter(Boolean))].sort(),
    sampleUnmatchedOrMissingCards: unmatchedCards.slice(0, 8).map((card) => ({
      id: card.id,
      number: card.number,
      name: card.name,
      lookupKeys: resolveCardPriceIds(card, set.id),
    })),
  };
}

async function main() {
  readEnvFile(path.join(process.cwd(), ".env"));
  readEnvFile(path.join(process.cwd(), "mobile-app", ".env"));

  const supabaseUrl = getArg("--supabase-url") || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    getArg("--anon-key") ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.PACKDEX_SYNC_ANON_KEY;
  const outputPath = getArg("--output", path.join("reports", "card-price-coverage.json"));

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase URL or anon key. Provide --supabase-url and --anon-key, or set VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const sets = await loadAppPriceSyncData(process.cwd());
  const report = [];

  for (const set of sets) {
    const rows = await fetchPriceRowsForSet(supabase, getSetLookupIds(set.id));
    report.push(summarizeSet(set, rows));
  }

  const brokenSets = report.filter(
    (set) => set.supabasePriceRowsFound > 0 && set.cardsWithValidMarketPriceUsd > 0 && set.localCardsMatchedToPriceRows === 0
  );
  const noValidMarketDataSets = report.filter((set) => set.supabasePriceRowsFound === 0 || set.cardsWithValidMarketPriceUsd === 0);
  const result = {
    generatedAt: new Date().toISOString(),
    totals: {
      setsAudited: report.length,
      setsWithAnySupabaseRows: report.filter((set) => set.supabasePriceRowsFound > 0).length,
      setsWithValidMarketPrices: report.filter((set) => set.cardsWithValidMarketPriceUsd > 0).length,
      setsWithRowsButNoLocalMatches: brokenSets.length,
      setsWithNoValidMarketData: noValidMarketDataSets.length,
    },
    sets: report,
    setsWithRowsButNoLocalMatches: brokenSets.map((set) => set.setSlug),
    setsWithNoValidMarketData: noValidMarketDataSets.map((set) => set.setSlug),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

  console.log(`Wrote ${outputPath}`);
  console.log(JSON.stringify(result.totals, null, 2));

  ["black-bolt", "white-flare", "surging-sparks", "chaos-rising"].forEach((setId) => {
    const set = report.find((item) => item.setSlug === setId);
    if (!set) return;
    console.log(
      `${set.setSlug}: API=${set.pokemonTcgApiSetId || "none"}, local=${set.totalLocalCards}, rows=${set.supabasePriceRowsFound}, matches=${set.localCardsMatchedToPriceRows}, valid=${set.cardsWithValidMarketPriceUsd}`
    );
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
