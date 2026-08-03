import catalog from "../sync-card-prices/catalog.json" with { type: "json" };
import { getAdminClient } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";
import {
  buildCanonicalCardLookup,
  buildMarketplaceRow,
  matchCanonicalCard,
  preserveCanonicalMarketplaceIdentity,
  selectTcgplayerPrice,
} from "../_shared/cardPricing.js";
import {
  FUNCTION_DEADLINE_MS,
  UPSTREAM_GROUP_CONCURRENCY,
  UPSTREAM_SET_TIMEOUT_MS,
  parseRetryAfterMs,
  runBoundedGroups,
  shouldRetryUpstream,
  waitForRetry,
} from "./boundedGroups.js";

const MAX_CARDS = 50;
const MAX_ID_LENGTH = 180;
const PRICE_FRESHNESS_MS = 48 * 60 * 60 * 1_000;
const POKEMON_TCG_API_BASE_URL = "https://api.pokemontcg.io/v2";
const PRICE_COLUMNS = "card_id,set_id,card_number,name,market_price_usd,tcgplayer_url,source_updated_at,synced_at";

type PackDexCard = { id?: string; name?: string; number?: string | number; rarity?: string; sourceSetId?: string; sourceCardId?: string; tcgplayerPriceType?: string; priceFinish?: string };
type PackDexSet = { id: string; apiSetId?: string | null; apiSetIds?: string[]; cards?: PackDexCard[] };
type RequestedCard = { setId: string; cardId: string };
type ValidatedCard = RequestedCard & { set: PackDexSet; card: PackDexCard };
type UpstreamGroup = { apiSetId: string; sets: Array<{ set: PackDexSet; cards: PackDexCard[] }> };
type PokemonTcgPrice = { low?: number; mid?: number; high?: number; market?: number; directLow?: number };
type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string | number;
  rarity?: string;
  set?: { id?: string };
  tcgplayer?: { url?: string; updatedAt?: string; prices?: Record<string, PokemonTcgPrice | undefined> };
};

class UpstreamHttpError extends Error {
  status: number;
  retryAfterMs: number;

  constructor(status: number, retryAfterMs = 0) {
    super(`Upstream HTTP ${status}`);
    this.name = "UpstreamHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function text(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= MAX_ID_LENGTH ? normalized : null;
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

function validateRequestedCards(requested: RequestedCard[], catalogById: Map<string, PackDexSet>) {
  const validated: ValidatedCard[] = [];
  const rejected: RequestedCard[] = [];
  requested.forEach((item) => {
    const set = catalogById.get(item.setId);
    const card = set?.cards?.find((candidate) => String(candidate.id || "") === item.cardId);
    if (!set || !card) rejected.push(item);
    else validated.push({ ...item, set, card });
  });
  return { validated, rejected };
}

function compactPriceRow(row: Record<string, unknown>) {
  return Object.fromEntries(["card_id", "set_id", "card_number", "name", "market_price_usd", "tcgplayer_url", "source_updated_at", "synced_at"].map((key) => [key, row[key]]));
}

async function fetchSetCardsOnce(apiSetId: string, signal: AbortSignal) {
  const apiKey = Deno.env.get("POKEMON_TCG_API_KEY") || Deno.env.get("POKEMONTCG_API_KEY") || "";
  const cards: PokemonTcgCard[] = [];
  let page = 1;
  while (true) {
    const url = new URL(`${POKEMON_TCG_API_BASE_URL}/cards`);
    url.searchParams.set("q", `set.id:${apiSetId}`);
    url.searchParams.set("pageSize", "250");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, { signal, headers: apiKey ? { "X-Api-Key": apiKey } : {} });
    if (!response.ok) throw new UpstreamHttpError(response.status, parseRetryAfterMs(response.headers.get("retry-after")));
    let body;
    try {
      body = await response.json();
    } catch {
      const error = new Error("Unable to parse upstream response") as Error & { code?: string };
      error.code = "upstream_parsing";
      throw error;
    }
    const pageCards = Array.isArray(body?.data) ? body.data : [];
    cards.push(...pageCards);
    const totalCount = Number(body?.totalCount || cards.length);
    if (!pageCards.length || cards.length >= totalCount) break;
    page += 1;
  }
  return cards;
}

async function fetchSetCards(apiSetId: string, signal: AbortSignal, remainingMs: () => number) {
  let attempt = 0;
  while (true) {
    try {
      return await fetchSetCardsOnce(apiSetId, signal);
    } catch (error) {
      const status = Number((error as { status?: number })?.status || 0);
      const retryAfterMs = Number((error as { retryAfterMs?: number })?.retryAfterMs || 0);
      if (!shouldRetryUpstream({ status, attempt, retryAfterMs, remainingMs: remainingMs() })) throw error;
      attempt += 1;
      await waitForRetry(retryAfterMs, signal);
    }
  }
}

function buildUpstreamGroups(pending: ValidatedCard[]) {
  const groups = new Map<string, UpstreamGroup>();
  const unsupportedSetIds = new Set<string>();
  pending.forEach((item) => {
    const apiSetId = String(item.card.sourceSetId || item.set.apiSetId || "").trim();
    if (!apiSetId) {
      unsupportedSetIds.add(item.set.id);
      return;
    }
    const group = groups.get(apiSetId) || { apiSetId, sets: [] };
    let setEntry = group.sets.find((entry) => entry.set.id === item.set.id);
    if (!setEntry) {
      setEntry = { set: item.set, cards: [] };
      group.sets.push(setEntry);
    }
    setEntry.cards.push(item.card);
    groups.set(apiSetId, group);
  });
  return { groups: [...groups.values()], unsupportedSetIds: [...unsupportedSetIds] };
}

function requestedCanonicalId(item: ValidatedCard) {
  return String(item.card.sourceCardId || item.cardId || "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const functionStartedAt = Date.now();
  try {
    const requested = parseRequestedCards(await req.json().catch(() => ({})) as Record<string, unknown>);
    if (!requested) return jsonResponse({ error: "Invalid price refresh payload." }, 400);

    const catalogById = new Map((catalog as PackDexSet[]).map((set) => [set.id, set]));
    const { validated, rejected } = validateRequestedCards(requested, catalogById);
    if (rejected.length) return jsonResponse({ error: "One or more requested cards are unsupported.", rejectedCount: rejected.length }, 400);

    const admin = getAdminClient();
    const rateLimit = await admin.rpc("consume_public_pull_share_rate_limit", {
      p_scope: "pokemon-price-ip-hour",
      p_subject: getClientIp(req),
      p_window_started_at: hourWindow(),
      p_limit: 60,
    });
    if (rateLimit.error) throw rateLimit.error;
    if (!rateLimit.data) return jsonResponse({ error: "Too many price refreshes. Please try again later." }, 429);

    const requestedIds = [...new Set(validated.map(requestedCanonicalId).filter(Boolean))];
    const freshSince = new Date(Date.now() - PRICE_FRESHNESS_MS).toISOString();
    const existingQuery = await admin.from("card_prices").select(PRICE_COLUMNS).in("card_id", requestedIds);
    if (existingQuery.error) throw existingQuery.error;
    const requestedKeys = new Set(validated.map((item) => `${item.setId}:${requestedCanonicalId(item)}`));
    const existingRows = (Array.isArray(existingQuery.data) ? existingQuery.data : []).filter((row) => requestedKeys.has(`${row.set_id}:${row.card_id}`));
    const freshRows = existingRows.filter((row) => String(row.synced_at || "") >= freshSince);
    const freshKeys = new Set(freshRows.map((row) => `${row.set_id}:${row.card_id}`));
    const pending = validated.filter((item) => !freshKeys.has(`${item.setId}:${requestedCanonicalId(item)}`));
    const { groups, unsupportedSetIds } = buildUpstreamGroups(pending);

    const grouped = await runBoundedGroups(groups, async (group: UpstreamGroup, context) => {
      const apiCards = await fetchSetCards(group.apiSetId, context.signal, context.remainingMs);
      const rows: Record<string, unknown>[] = [];
      const matchedRequestedKeys = new Set<string>();
      group.sets.forEach(({ set, cards }) => {
        const lookup = buildCanonicalCardLookup(cards);
        apiCards.forEach((apiCard) => {
          const appCard = matchCanonicalCard(apiCard, lookup).card as PackDexCard | null;
          if (!appCard) return;
          rows.push(buildMarketplaceRow(set, appCard, apiCard, selectTcgplayerPrice(apiCard, appCard)));
          matchedRequestedKeys.add(`${set.id}:${String(appCard.sourceCardId || appCard.id || "")}`);
        });
      });
      const missing = group.sets.flatMap(({ set, cards }) => cards
        .filter((card) => !matchedRequestedKeys.has(`${set.id}:${String(card.sourceCardId || card.id || "")}`))
        .map((card) => ({ setId: set.id, cardId: String(card.id || ""), reason: "no_canonical_match" })));
      return { rows, missing };
    });

    const refreshedRows = grouped.successes.flatMap((result) => (result.value as { rows: Record<string, unknown>[] }).rows);
    const priorById = new Map(existingRows.map((row) => [String(row.card_id), row]));
    const uniqueRefreshedRows = [...new Map(refreshedRows.map((row) => [String(row.card_id), preserveCanonicalMarketplaceIdentity(row, priorById.get(String(row.card_id)))])).values()];
    let writeSucceeded = true;
    if (uniqueRefreshedRows.length) {
      const write = await admin.from("card_prices").upsert(uniqueRefreshedRows, { onConflict: "card_id" });
      if (write.error) {
        writeSucceeded = false;
        console.error("refresh-pokemon-prices upsert failed", formatErrorForResponse(write.error));
      }
    }

    const failedSets = [
      ...unsupportedSetIds.map((setId) => ({ setId, reason: "unsupported_mapping" })),
      ...grouped.failures.flatMap(({ group, reason }) => (group as UpstreamGroup).sets.map(({ set }) => ({ setId: set.id, reason }))),
      ...grouped.successes.flatMap((result) => (result.value as { missing: Array<{ setId: string; cardId: string; reason: string }> }).missing),
    ];
    const uniqueFailedSets = [...new Map(failedSets.map((failure) => [failure.setId, failure])).values()];
    const returnedRows = [...new Map([...freshRows, ...uniqueRefreshedRows.map(compactPriceRow)].map((row) => [String(row.card_id), row])).values()];
    const usableResult = returnedRows.length > 0;
    const status = uniqueFailedSets.length || !writeSucceeded
      ? (usableResult ? "partial_success" : "total_failure")
      : "full_success";
    const response = {
      ok: status !== "total_failure",
      partial: status === "partial_success",
      status,
      requestedCount: validated.length,
      serverFreshCount: freshRows.length,
      updatedCount: uniqueRefreshedRows.length,
      updated: uniqueRefreshedRows.length,
      successfulSetCount: Math.max(0, new Set(validated.map((item) => item.setId)).size - uniqueFailedSets.length),
      failedSetCount: uniqueFailedSets.length,
      missingRequestedCount: grouped.successes.reduce((sum, result) => sum + (result.value as { missing: unknown[] }).missing.length, 0),
      upstreamGroupCount: groups.length,
      maxConcurrentGroups: grouped.maxActive,
      durationMs: Date.now() - functionStartedAt,
      writeSucceeded,
      updatedPrices: returnedRows,
      failedSets: uniqueFailedSets,
    };
    console.info("[PackDex price refresh]", JSON.stringify({
      requestedCount: response.requestedCount,
      serverFreshCount: response.serverFreshCount,
      updatedCount: response.updatedCount,
      upstreamGroupCount: response.upstreamGroupCount,
      failedSetCount: response.failedSetCount,
      maxConcurrentGroups: response.maxConcurrentGroups,
      durationMs: response.durationMs,
      status: response.status,
      concurrencyLimit: UPSTREAM_GROUP_CONCURRENCY,
      perGroupTimeoutMs: UPSTREAM_SET_TIMEOUT_MS,
      functionDeadlineMs: FUNCTION_DEADLINE_MS,
    }));
    return jsonResponse(response);
  } catch (error) {
    console.error("refresh-pokemon-prices failed", formatErrorForResponse(error));
    return jsonResponse({ error: "Unable to refresh card prices." }, 500);
  }
});
