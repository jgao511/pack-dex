import catalog from "./catalog.json" with { type: "json" };
import { getAdminClient } from "../_shared/auth.ts";
import { formatErrorForResponse } from "../_shared/http.ts";

// Keep this function deploy-scoped: no imports from src/, public/, dist/, or image assets.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-packdex-price-sync-secret",
};

const POKEMON_TCG_API_BASE_URL = "https://api.pokemontcg.io/v2";
const ACCEPTED_PRICE_TYPES = ["normal", "holofoil", "reverseHolofoil"];

type AdminClient = ReturnType<typeof getAdminClient>;
type PackDexSet = {
  id: string;
  name?: string;
  cards?: PackDexCard[];
  apiSetId?: string | null;
  tcgplayerSetSlug?: string | null;
};
type PackDexCard = {
  id?: string;
  card_id?: string;
  name?: string;
  number?: string | number;
  rarity?: string;
};
type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string | number;
  rarity?: string;
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: Record<string, PokemonTcgPrice | undefined>;
  };
};
type PokemonTcgPrice = {
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
  directLow?: number;
};

function scopedJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeCardNumber(value: unknown) {
  return String(value || "").trim().replace(/^0+(\d)/, "$1").toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function slugifyCardName(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compactId(value: unknown) {
  return String(value || "").trim();
}

function toPositiveNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function getEnvCsv(name: string) {
  return (Deno.env.get(name) || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function requirePriceSyncAdmin(req: Request, admin: AdminClient) {
  const configuredSecret = Deno.env.get("PACKDEX_PRICE_SYNC_SECRET") || "";
  const requestSecret = req.headers.get("x-packdex-price-sync-secret") || "";

  if (configuredSecret.length >= 32 && requestSecret) {
    if (requestSecret === configuredSecret) return null;
    return scopedJsonResponse({ error: "Invalid price sync credentials." }, 403);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = tokenMatch?.[1]?.trim() || "";

  if (!token && !requestSecret) {
    return scopedJsonResponse({ error: "Missing price sync credentials." }, 401);
  }

  if (!token) {
    return scopedJsonResponse({ error: "Invalid price sync credentials." }, 403);
  }

  const { data, error } = await admin.auth.getUser(token);
  const email = data?.user?.email?.trim().toLowerCase() || "";
  const adminEmails = new Set(getEnvCsv("PACKDEX_ADMIN_EMAILS"));

  if (error || !email || !adminEmails.has(email)) {
    return scopedJsonResponse({ error: "Invalid price sync credentials." }, 403);
  }

  return null;
}

function getRequestedSetIds(body: Record<string, unknown>) {
  const setIds = Array.isArray(body?.setIds) ? body.setIds : Array.isArray(body?.set_ids) ? body.set_ids : null;
  return setIds?.map(compactId).filter(Boolean) || [];
}

function getOverrideMap(body: Record<string, unknown>, key: string) {
  const value = body?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getApiSetId(set: PackDexSet, setApiIds: Record<string, unknown>) {
  return compactId(setApiIds[set.id]) || compactId(set.apiSetId) || null;
}

function getTcgplayerSetSlug(set: PackDexSet, setTcgplayerSlugs: Record<string, unknown>) {
  return compactId(setTcgplayerSlugs[set.id]) || compactId(set.tcgplayerSetSlug) || null;
}

function buildCardLookup(cards: PackDexCard[]) {
  const byNumber = new Map<string, PackDexCard[]>();
  const byNumberAndName = new Map<string, PackDexCard>();

  cards.forEach((card) => {
    const number = normalizeCardNumber(card.number);
    if (!number) return;

    byNumber.set(number, [...(byNumber.get(number) || []), card]);
    byNumberAndName.set(`${number}:${normalizeName(card.name)}`, card);
  });

  return { byNumber, byNumberAndName };
}

function findAppCard(apiCard: PokemonTcgCard, lookup: ReturnType<typeof buildCardLookup>) {
  const number = normalizeCardNumber(apiCard.number);
  const exact = lookup.byNumberAndName.get(`${number}:${normalizeName(apiCard.name)}`);
  if (exact) return exact;

  const candidates = lookup.byNumber.get(number) || [];
  return candidates.length === 1 ? candidates[0] : null;
}

function selectMarketPrice(apiCard: PokemonTcgCard) {
  const prices = apiCard.tcgplayer?.prices || {};

  for (const priceType of ACCEPTED_PRICE_TYPES) {
    const price = prices[priceType];
    const market = toPositiveNumber(price?.market);
    if (!market) continue;

    return { priceType, price };
  }

  return null;
}

function buildPriceRow(set: PackDexSet, appCard: PackDexCard, apiCard: PokemonTcgCard, selectedPrice: {
  priceType: string;
  price: PokemonTcgPrice;
}) {
  const cardNumber = compactId(appCard.number || apiCard.number);
  const name = compactId(appCard.name || apiCard.name);
  const packDexPriceKey = `${set.id}-${normalizeCardNumber(cardNumber)}-${slugifyCardName(name)}`;

  return {
    card_id: compactId(apiCard.id) || compactId(appCard.id) || packDexPriceKey,
    set_id: set.id,
    card_number: cardNumber,
    name,
    rarity: compactId(appCard.rarity || apiCard.rarity) || null,
    price_type: selectedPrice.priceType,
    market_price_usd: toPositiveNumber(selectedPrice.price.market),
    low_price_usd: toPositiveNumber(selectedPrice.price.low),
    mid_price_usd: toPositiveNumber(selectedPrice.price.mid),
    high_price_usd: toPositiveNumber(selectedPrice.price.high),
    direct_low_price_usd: toPositiveNumber(selectedPrice.price.directLow),
    tcgplayer_url: compactId(apiCard.tcgplayer?.url) || null,
    source_updated_at: compactId(apiCard.tcgplayer?.updatedAt) || null,
    synced_at: new Date().toISOString(),
  };
}

function getStaleCardIds(set: PackDexSet, appCard: PackDexCard, apiCard?: PokemonTcgCard | null) {
  const cardNumber = compactId(appCard.number || apiCard?.number);
  const name = compactId(appCard.name || apiCard?.name);
  const apiSetId = compactId(apiCard?.id).split("-")[0];
  const generatedApiCardId = apiSetId && cardNumber ? `${apiSetId}-${normalizeCardNumber(cardNumber)}` : "";
  const packDexPriceKey = `${set.id}-${normalizeCardNumber(cardNumber)}-${slugifyCardName(name)}`;

  return [
    apiCard?.id,
    generatedApiCardId,
    appCard.id,
    appCard.card_id,
    packDexPriceKey,
  ].map(compactId).filter(Boolean);
}

function getApiStaleCardIds(apiCard: PokemonTcgCard) {
  return [apiCard.id].map(compactId).filter(Boolean);
}

async function fetchPokemonTcgCards(apiSetId: string) {
  const apiKey = Deno.env.get("POKEMON_TCG_API_KEY") || Deno.env.get("POKEMONTCG_API_KEY") || "";
  const cards: PokemonTcgCard[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`${POKEMON_TCG_API_BASE_URL}/cards`);
    url.searchParams.set("q", `set.id:${apiSetId}`);
    url.searchParams.set("pageSize", "250");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: apiKey ? { "X-Api-Key": apiKey } : {},
    });

    if (!response.ok) {
      throw new Error(`Pokemon TCG API request failed for ${apiSetId} with HTTP ${response.status}.`);
    }

    const body = await response.json();
    const pageCards = Array.isArray(body?.data) ? body.data : [];
    cards.push(...pageCards);

    const totalCount = Number(body?.totalCount || cards.length);
    if (cards.length >= totalCount || pageCards.length === 0) break;
    page += 1;
  }

  return cards;
}

async function deleteStalePrices(admin: AdminClient, cardIds: string[]) {
  const uniqueCardIds = [...new Set(cardIds)];
  if (uniqueCardIds.length === 0) return 0;

  const { error, count } = await admin
    .from("card_prices")
    .delete({ count: "exact" })
    .in("card_id", uniqueCardIds);

  if (error) throw error;
  return count || 0;
}

async function syncSet(
  admin: AdminClient,
  set: PackDexSet,
  apiSetId: string,
  tcgplayerSetSlug: string | null,
  appCardCount: number | null,
) {
  const cards = Array.isArray(set.cards) ? set.cards : [];
  const lookup = buildCardLookup(cards);
  const apiCards = await fetchPokemonTcgCards(apiSetId);
  const rows = [];
  const staleCardIds = [];
  const pricedAppCardIds = new Set<string>();
  let skippedNoMarketPrice = 0;
  let skippedExcludedVariant = 0;

  for (const apiCard of apiCards) {
    const appCard = findAppCard(apiCard, lookup);
    if (!appCard) {
      skippedExcludedVariant += 1;
      staleCardIds.push(...getApiStaleCardIds(apiCard));
      continue;
    }

    const selectedPrice = selectMarketPrice(apiCard);
    if (!selectedPrice) {
      skippedNoMarketPrice += 1;
      staleCardIds.push(...getStaleCardIds(set, appCard, apiCard));
      continue;
    }

    rows.push(buildPriceRow(set, appCard, apiCard, selectedPrice));
    pricedAppCardIds.add(compactId(appCard.id) || `${normalizeCardNumber(appCard.number)}:${normalizeName(appCard.name)}`);
  }

  for (const appCard of cards) {
    const appCardKey = compactId(appCard.id) || `${normalizeCardNumber(appCard.number)}:${normalizeName(appCard.name)}`;
    if (!pricedAppCardIds.has(appCardKey)) staleCardIds.push(...getStaleCardIds(set, appCard, null));
  }

  let stalePricesDeleted = 0;
  if (staleCardIds.length > 0) {
    stalePricesDeleted = await deleteStalePrices(admin, staleCardIds);
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from("card_prices")
      .upsert(rows, { onConflict: "card_id" });

    if (error) throw error;
  }

  const sourceCardCount = appCardCount ?? cards.length;
  const marketCoverage = sourceCardCount > 0 ? rows.length / sourceCardCount : 0;

  return {
    setId: set.id,
    apiSetId,
    tcgplayerSetSlug,
    appCardCount: sourceCardCount,
    externalCardsFetched: apiCards.length,
    pricesUpserted: rows.length,
    cardsSkipped: skippedNoMarketPrice + skippedExcludedVariant,
    skippedNoMarketPrice,
    skippedExcludedVariant,
    stalePricesDeleted,
    stalePricesPreserved: 0,
    marketCoverage,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let debugStep = "start";

  try {
    debugStep = "create_admin_client";
    const admin = getAdminClient();
    const authFailure = await requirePriceSyncAdmin(req, admin);
    if (authFailure) return authFailure;

    debugStep = "parse_body";
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const allowOverrides = Deno.env.get("ALLOW_PRICE_SYNC_OVERRIDES") === "true";
    const setApiIds = allowOverrides ? getOverrideMap(body, "setApiIds") : {};
    const setTcgplayerSlugs = allowOverrides ? getOverrideMap(body, "setTcgplayerSlugs") : {};
    const appCardCounts = allowOverrides ? getOverrideMap(body, "appCardCounts") : {};
    const requestedSetIds = new Set(getRequestedSetIds(body));
    const selectedSets = (catalog as PackDexSet[])
      .filter((set) => requestedSetIds.size === 0 || requestedSetIds.has(set.id))
      .map((set) => ({
        set,
        apiSetId: getApiSetId(set, setApiIds),
        tcgplayerSetSlug: getTcgplayerSetSlug(set, setTcgplayerSlugs),
        appCardCount: allowOverrides ? Number(appCardCounts[set.id]) || null : null,
      }))
      .filter(({ apiSetId }) => Boolean(apiSetId));

    let cardsUpserted = 0;
    let skippedNoMarketPrice = 0;
    let skippedExcludedVariant = 0;
    let stalePricesDeleted = 0;
    const setResults = [];
    const errors = [];

    for (const selected of selectedSets) {
      try {
        debugStep = `sync_set:${selected.set.id}`;
        const result = await syncSet(
          admin,
          selected.set,
          selected.apiSetId as string,
          selected.tcgplayerSetSlug,
          selected.appCardCount,
        );

        cardsUpserted += result.pricesUpserted;
        skippedNoMarketPrice += result.skippedNoMarketPrice;
        skippedExcludedVariant += result.skippedExcludedVariant;
        stalePricesDeleted += result.stalePricesDeleted;
        setResults.push(result);
      } catch (error) {
        errors.push({
          setId: selected.set.id,
          apiSetId: selected.apiSetId,
          error: formatErrorForResponse(error),
        });
        console.error("sync-card-prices set failed", {
          setId: selected.set.id,
          apiSetId: selected.apiSetId,
          error: formatErrorForResponse(error),
        });
      }
    }

    return scopedJsonResponse({
      success: errors.length === 0,
      setsAttempted: selectedSets.length,
      cardsUpserted,
      skippedNoPrice: skippedNoMarketPrice + skippedExcludedVariant,
      skippedNoMarketPrice,
      skippedExcludedVariant,
      stalePricesDeleted,
      stalePricesPreserved: 0,
      setResults,
      errors,
    });
  } catch (error) {
    const formattedError = formatErrorForResponse(error);

    console.error("sync-card-prices failed", {
      step: debugStep,
      error: formattedError,
    });

    return scopedJsonResponse(
      {
        error: "Unable to sync card prices.",
        step: debugStep,
        ...formattedError,
      },
      500,
    );
  }
});
