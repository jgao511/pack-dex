import catalog from "../sync-card-prices/catalog.json" with { type: "json" };
import { getAdminClient } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";

const MAX_CARDS = 50;
const MAX_ID_LENGTH = 180;
const POKEMON_TCG_API_BASE_URL = "https://api.pokemontcg.io/v2";
const ACCEPTED_PRICE_TYPES = ["normal", "holofoil", "reverseHolofoil"];

type PackDexCard = { id?: string; name?: string; number?: string | number; rarity?: string };
type PackDexSet = { id: string; apiSetId?: string | null; cards?: PackDexCard[] };
type RequestedCard = { setId: string; cardId: string };
type PokemonTcgPrice = { low?: number; mid?: number; high?: number; market?: number; directLow?: number };
type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string | number;
  rarity?: string;
  tcgplayer?: { url?: string; updatedAt?: string; prices?: Record<string, PokemonTcgPrice | undefined> };
};

function text(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= MAX_ID_LENGTH ? normalized : null;
}

function normalizeCardNumber(value: unknown) {
  return String(value || "").trim().replace(/^0+(\d)/, "$1").toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function slugifyCardName(value: unknown) {
  return String(value || "").toLowerCase().replace(/&/g, "and").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function positiveNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function getClientIp(req: Request) {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
}

function hourWindow() {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.toISOString();
}

function parseRequestedCards(body: Record<string, unknown>) {
  if (!Array.isArray(body?.cards) || body.cards.length < 1 || body.cards.length > MAX_CARDS) return null;
  const requested = body.cards.map((value) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return { setId: text(item.setId ?? item.set_id), cardId: text(item.cardId ?? item.card_id) };
  });
  if (requested.some((item) => !item.setId || !item.cardId)) return null;
  return [...new Map(requested.map((item) => [`${item.setId}:${item.cardId}`, item as RequestedCard])).values()];
}

function buildLookup(cards: PackDexCard[]) {
  const byNumberAndName = new Map<string, PackDexCard>();
  const byNumber = new Map<string, PackDexCard[]>();
  cards.forEach((card) => {
    const number = normalizeCardNumber(card.number);
    if (!number) return;
    byNumberAndName.set(`${number}:${normalizeName(card.name)}`, card);
    byNumber.set(number, [...(byNumber.get(number) || []), card]);
  });
  return { byNumberAndName, byNumber };
}

function findAppCard(apiCard: PokemonTcgCard, lookup: ReturnType<typeof buildLookup>) {
  const number = normalizeCardNumber(apiCard.number);
  const exact = lookup.byNumberAndName.get(`${number}:${normalizeName(apiCard.name)}`);
  if (exact) return exact;
  const candidates = lookup.byNumber.get(number) || [];
  return candidates.length === 1 ? candidates[0] : null;
}

function selectMarketPrice(apiCard: PokemonTcgCard) {
  for (const priceType of ACCEPTED_PRICE_TYPES) {
    const price = apiCard.tcgplayer?.prices?.[priceType];
    if (positiveNumber(price?.market)) return { priceType, price: price as PokemonTcgPrice };
  }
  return null;
}

function buildPriceRow(set: PackDexSet, appCard: PackDexCard, apiCard: PokemonTcgCard, selected: ReturnType<typeof selectMarketPrice>) {
  if (!selected) return null;
  const cardNumber = String(appCard.number || apiCard.number || "").trim();
  const name = String(appCard.name || apiCard.name || "").trim();
  return {
    card_id: String(apiCard.id || appCard.id || `${set.id}-${normalizeCardNumber(cardNumber)}-${slugifyCardName(name)}`),
    set_id: set.id,
    card_number: cardNumber,
    name,
    rarity: String(appCard.rarity || apiCard.rarity || "") || null,
    price_type: selected.priceType,
    market_price_usd: positiveNumber(selected.price.market),
    low_price_usd: positiveNumber(selected.price.low),
    mid_price_usd: positiveNumber(selected.price.mid),
    high_price_usd: positiveNumber(selected.price.high),
    direct_low_price_usd: positiveNumber(selected.price.directLow),
    tcgplayer_url: String(apiCard.tcgplayer?.url || "") || null,
    source_updated_at: String(apiCard.tcgplayer?.updatedAt || "") || null,
    synced_at: new Date().toISOString(),
  };
}

async function fetchSetCards(apiSetId: string) {
  const apiKey = Deno.env.get("POKEMON_TCG_API_KEY") || Deno.env.get("POKEMONTCG_API_KEY") || "";
  const cards: PokemonTcgCard[] = [];
  let page = 1;
  while (true) {
    const url = new URL(`${POKEMON_TCG_API_BASE_URL}/cards`);
    url.searchParams.set("q", `set.id:${apiSetId}`);
    url.searchParams.set("pageSize", "250");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, { headers: apiKey ? { "X-Api-Key": apiKey } : {} });
    if (!response.ok) throw new Error(`Pokemon TCG API request failed for ${apiSetId} with HTTP ${response.status}.`);
    const body = await response.json();
    const pageCards = Array.isArray(body?.data) ? body.data : [];
    cards.push(...pageCards);
    const totalCount = Number(body?.totalCount || cards.length);
    if (!pageCards.length || cards.length >= totalCount) break;
    page += 1;
  }
  return cards;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const requested = parseRequestedCards(await req.json().catch(() => ({})) as Record<string, unknown>);
    if (!requested) return jsonResponse({ error: "Invalid price refresh payload." }, 400);

    const admin = getAdminClient();
    const rateLimit = await admin.rpc("consume_public_pull_share_rate_limit", {
      p_scope: "pokemon-price-ip-hour",
      p_subject: getClientIp(req),
      p_window_started_at: hourWindow(),
      p_limit: 60,
    });
    if (rateLimit.error) throw rateLimit.error;
    if (!rateLimit.data) return jsonResponse({ error: "Too many price refreshes. Please try again later." }, 429);

    const catalogById = new Map((catalog as PackDexSet[]).map((set) => [set.id, set]));
    const requestedBySet = new Map<string, Set<string>>();
    requested.forEach(({ setId, cardId }) => requestedBySet.set(setId, new Set([...(requestedBySet.get(setId) || []), cardId])));
    const rows = [];

    for (const [setId, cardIds] of requestedBySet) {
      const set = catalogById.get(setId);
      if (!set?.apiSetId) continue;
      const requestedCards = (set.cards || []).filter((card) => card.id && cardIds.has(card.id));
      if (!requestedCards.length) continue;
      const lookup = buildLookup(requestedCards);
      const apiCards = await fetchSetCards(set.apiSetId);
      for (const apiCard of apiCards) {
        const appCard = findAppCard(apiCard, lookup);
        if (!appCard) continue;
        const row = buildPriceRow(set, appCard, apiCard, selectMarketPrice(apiCard));
        if (row) rows.push(row);
      }
    }

    const uniqueRows = [...new Map(rows.map((row) => [row.card_id, row])).values()];
    if (uniqueRows.length) {
      const { error } = await admin.from("card_prices").upsert(uniqueRows, { onConflict: "card_id" });
      if (error) throw error;
    }
    return jsonResponse({ updated: uniqueRows.length, rows: uniqueRows });
  } catch (error) {
    console.error("refresh-pokemon-prices failed", formatErrorForResponse(error));
    return jsonResponse({ error: "Unable to refresh card prices." }, 500);
  }
});

