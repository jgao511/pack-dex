import catalog from "./catalog.json" with { type: "json" };
import { getAdminClient } from "../_shared/auth.ts";
import { formatErrorForResponse } from "../_shared/http.ts";
import {
  buildCanonicalCardLookup,
  buildMarketplaceRow,
  compactText,
  matchCanonicalCard,
  normalizeCanonicalName,
  normalizeCollectorNumber,
  preserveCanonicalMarketplaceIdentity,
  selectTcgplayerPrice,
} from "../_shared/cardPricing.js";

// Keep this function deploy-scoped: no imports from src/, public/, dist/, or image assets.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-packdex-price-sync-secret",
};

const POKEMON_TCG_API_BASE_URL = "https://api.pokemontcg.io/v2";

type AdminClient = ReturnType<typeof getAdminClient>;
type PackDexSet = {
  id: string;
  name?: string;
  cards?: PackDexCard[];
  apiSetId?: string | null;
  apiSetIds?: string[];
  tcgplayerSetSlug?: string | null;
};
type PackDexCard = {
  id?: string;
  card_id?: string;
  name?: string;
  number?: string | number;
  rarity?: string;
  sourceSetId?: string;
  sourceCardId?: string;
  tcgplayerPriceType?: string;
  priceFinish?: string;
};
type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string | number;
  rarity?: string;
  set?: { id?: string };
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

function compactId(value: unknown) {
  return compactText(value);
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

function getApiSetIds(set: PackDexSet, setApiIds: Record<string, unknown>) {
  const override = compactId(setApiIds[set.id]);
  if (override) return [override];
  return [...new Set([...(set.apiSetIds || []), set.apiSetId].map(compactId).filter(Boolean))];
}

function getTcgplayerSetSlug(set: PackDexSet, setTcgplayerSlugs: Record<string, unknown>) {
  return compactId(setTcgplayerSlugs[set.id]) || compactId(set.tcgplayerSetSlug) || null;
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

async function deleteStalePrices(admin: AdminClient, setId: string, cardIds: string[]) {
  const uniqueCardIds = [...new Set(cardIds)];
  if (uniqueCardIds.length === 0) return 0;

  const { error, count } = await admin
    .from("card_prices")
    .delete({ count: "exact" })
    .eq("set_id", setId)
    .in("card_id", uniqueCardIds);

  if (error) throw error;
  return count || 0;
}

async function syncSet(
  admin: AdminClient,
  set: PackDexSet,
  apiSetIds: string[],
  tcgplayerSetSlug: string | null,
  appCardCount: number | null,
  dryRun: boolean,
) {
  const cards = Array.isArray(set.cards) ? set.cards : [];
  const lookup = buildCanonicalCardLookup(cards);
  const fetchResults = await Promise.allSettled(apiSetIds.map(async (apiSetId) => ({
    apiSetId,
    cards: await fetchPokemonTcgCards(apiSetId),
  })));
  const successfulFetches = fetchResults
    .filter((result): result is PromiseFulfilledResult<{ apiSetId: string; cards: PokemonTcgCard[] }> => result.status === "fulfilled")
    .map((result) => result.value);
  const apiErrors = fetchResults
    .map((result, index) => result.status === "rejected" ? {
      apiSetId: apiSetIds[index],
      error: formatErrorForResponse(result.reason),
    } : null)
    .filter(Boolean);
  if (successfulFetches.length === 0) {
    throw new Error(`All Pokemon TCG API set requests failed for ${set.id}.`);
  }
  const apiCards = successfulFetches.flatMap((result) => result.cards);
  const rows = [];
  const staleCardIds = [];
  const matchedAppCardIds = new Set<string>();
  let skippedNoMarketPrice = 0;
  let skippedExcludedVariant = 0;
  let ambiguousMatches = 0;
  let exactApiIdMatches = 0;
  let setNumberNameMatches = 0;
  let uniqueNumberMatches = 0;
  let cardsWithTcgplayer = 0;
  let cardsWithCanonicalUrl = 0;
  let cardsWithUrlNoMarketPrice = 0;
  let suspiciousMappings = 0;
  let latestSourceUpdatedAt: string | null = null;

  for (const apiCard of apiCards) {
    const matched = matchCanonicalCard(apiCard, lookup);
    const appCard = matched.card as PackDexCard | null;
    if (!appCard) {
      if (matched.ambiguous) ambiguousMatches += 1;
      skippedExcludedVariant += 1;
      staleCardIds.push(...getApiStaleCardIds(apiCard));
      continue;
    }

    if (apiCard.tcgplayer) cardsWithTcgplayer += 1;
    if (compactId(apiCard.tcgplayer?.url)) cardsWithCanonicalUrl += 1;
    const sourceUpdatedAt = compactId(apiCard.tcgplayer?.updatedAt);
    if (sourceUpdatedAt && (!latestSourceUpdatedAt || sourceUpdatedAt > latestSourceUpdatedAt)) {
      latestSourceUpdatedAt = sourceUpdatedAt;
    }

    if (matched.matchType === "api_card_id") exactApiIdMatches += 1;
    if (matched.matchType === "set_number_name") setNumberNameMatches += 1;
    if (matched.matchType === "set_unique_number") uniqueNumberMatches += 1;
    if (
      matched.matchType === "api_card_id" &&
      (normalizeCollectorNumber(appCard.number) !== normalizeCollectorNumber(apiCard.number) ||
        normalizeCanonicalName(appCard.name) !== normalizeCanonicalName(apiCard.name))
    ) {
      suspiciousMappings += 1;
    }

    const selection = selectTcgplayerPrice(apiCard, appCard);
    if (!selection.priceType) {
      skippedNoMarketPrice += 1;
      if (compactId(apiCard.tcgplayer?.url)) cardsWithUrlNoMarketPrice += 1;
    }

    rows.push(buildMarketplaceRow(set, appCard, apiCard, selection));
    matchedAppCardIds.add(compactId(appCard.id) || compactId(appCard.sourceCardId));
  }

  let stalePricesDeleted = 0;
  if (!dryRun && rows.length > 0) {
    const rowIds = rows.map((row) => row.card_id).filter(Boolean);
    const prior = await admin
      .from("card_prices")
      .select("card_id,tcgplayer_url,source_updated_at")
      .in("card_id", rowIds);
    if (prior.error) throw prior.error;
    const priorById = new Map((prior.data || []).map((row) => [row.card_id, row]));
    const rowsWithPreservedIdentity = rows.map((row) => preserveCanonicalMarketplaceIdentity(row, priorById.get(row.card_id)));
    const { error } = await admin
      .from("card_prices")
      .upsert(rowsWithPreservedIdentity, { onConflict: "card_id" });

    if (error) throw error;
  }
  if (!dryRun && staleCardIds.length > 0) {
    stalePricesDeleted = await deleteStalePrices(admin, set.id, staleCardIds);
  }

  const sourceCardCount = appCardCount ?? cards.length;
  const marketPricesUpserted = rows.filter((row) => row.market_price_usd != null).length;
  const marketCoverage = sourceCardCount > 0 ? marketPricesUpserted / sourceCardCount : 0;
  const successfulApiSetIds = new Set(successfulFetches.map((result) => result.apiSetId));
  const cardsEligibleForAudit = cards.filter((card) => successfulApiSetIds.has(compactId(card.sourceSetId)));
  const cardsWithNoMapping = cardsEligibleForAudit.filter((card) => {
    const key = compactId(card.id) || compactId(card.sourceCardId);
    return key && !matchedAppCardIds.has(key);
  }).length;

  return {
    setId: set.id,
    apiSetId: apiSetIds[0] || null,
    apiSetIds,
    tcgplayerSetSlug,
    appCardCount: sourceCardCount,
    externalCardsFetched: apiCards.length,
    exactCardMatches: matchedAppCardIds.size,
    exactApiIdMatches,
    setNumberNameMatches,
    uniqueNumberMatches,
    cardsWithTcgplayer,
    cardsWithCanonicalUrl,
    cardsWithUrlNoMarketPrice,
    cardsWithNoMapping,
    pricesUpserted: rows.length,
    identityRowsUpserted: rows.length,
    marketPricesUpserted,
    cardsSkipped: skippedNoMarketPrice + skippedExcludedVariant,
    skippedNoMarketPrice,
    skippedExcludedVariant,
    ambiguousMatches,
    suspiciousMappings,
    latestSourceUpdatedAt,
    stalePricesDeleted,
    stalePricesPreserved: apiErrors.length > 0 ? cards.filter((card) => apiErrors.some((error) => error?.apiSetId === card.sourceSetId)).length : 0,
    dryRun,
    apiErrors,
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
    const dryRun = body?.dryRun === true || body?.dry_run === true;
    const allowOverrides = Deno.env.get("ALLOW_PRICE_SYNC_OVERRIDES") === "true";
    const setApiIds = allowOverrides ? getOverrideMap(body, "setApiIds") : {};
    const setTcgplayerSlugs = allowOverrides ? getOverrideMap(body, "setTcgplayerSlugs") : {};
    const appCardCounts = allowOverrides ? getOverrideMap(body, "appCardCounts") : {};
    const requestedSetIds = new Set(getRequestedSetIds(body));
    const selectedSets = (catalog as PackDexSet[])
      .filter((set) => requestedSetIds.size === 0 || requestedSetIds.has(set.id))
      .map((set) => ({
        set,
        apiSetIds: getApiSetIds(set, setApiIds),
        tcgplayerSetSlug: getTcgplayerSetSlug(set, setTcgplayerSlugs),
        appCardCount: allowOverrides ? Number(appCardCounts[set.id]) || null : null,
      }))
      .filter(({ apiSetIds }) => apiSetIds.length > 0);

    let cardsUpserted = 0;
    let skippedNoMarketPrice = 0;
    let skippedExcludedVariant = 0;
    let stalePricesDeleted = 0;
    let stalePricesPreserved = 0;
    let marketPricesUpserted = 0;
    const setResults = [];
    const errors = [];

    for (const selected of selectedSets) {
      try {
        debugStep = `sync_set:${selected.set.id}`;
        const result = await syncSet(
          admin,
          selected.set,
          selected.apiSetIds,
          selected.tcgplayerSetSlug,
          selected.appCardCount,
          dryRun,
        );

        cardsUpserted += result.identityRowsUpserted;
        skippedNoMarketPrice += result.skippedNoMarketPrice;
        skippedExcludedVariant += result.skippedExcludedVariant;
        stalePricesDeleted += result.stalePricesDeleted;
        stalePricesPreserved += result.stalePricesPreserved;
        marketPricesUpserted += result.marketPricesUpserted;
        setResults.push(result);
      } catch (error) {
        errors.push({
          setId: selected.set.id,
          apiSetIds: selected.apiSetIds,
          error: formatErrorForResponse(error),
        });
        console.error("sync-card-prices set failed", {
          setId: selected.set.id,
          apiSetIds: selected.apiSetIds,
          error: formatErrorForResponse(error),
        });
      }
    }

    return scopedJsonResponse({
      success: errors.length === 0,
      setsAttempted: selectedSets.length,
      cardsUpserted,
      identityRowsUpserted: cardsUpserted,
      marketPricesUpserted,
      skippedNoPrice: skippedNoMarketPrice + skippedExcludedVariant,
      skippedNoMarketPrice,
      skippedExcludedVariant,
      stalePricesDeleted,
      stalePricesPreserved,
      dryRun,
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
