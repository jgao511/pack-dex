import catalog from "../sync-card-prices/catalog.json" with { type: "json" };
import { getAdminClient } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";
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
const ACCEPTED_PRICE_TYPES = ["normal", "holofoil", "reverseHolofoil"];
const PRICE_COLUMNS = "card_id,set_id,card_number,name,market_price_usd,tcgplayer_url,source_updated_at,synced_at";

type PackDexCard = { id?: string; name?: string; number?: string | number; rarity?: string };
type PackDexSet = { id: string; apiSetId?: string | null; cards?: PackDexCard[] };
type RequestedCard = { setId: string; cardId: string };
type ValidatedCard = RequestedCard & { set: PackDexSet; card: PackDexCard };
type UpstreamGroup = { apiSetId: string; sets: Array<{ set: PackDexSet; cards: PackDexCard[] }> };
type PokemonTcgPrice = { low?: number; mid?: number; high?: number; market?: number; directLow?: number };
type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string | number;
  rarity?: string;
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
  const pendingBySet = new Map<string, ValidatedCard[]>();
  pending.forEach((item) => pendingBySet.set(item.setId, [...(pendingBySet.get(item.setId) || []), item]));

  pendingBySet.forEach((items) => {
    const set = items[0].set;
    if (!set.apiSetId) {
      unsupportedSetIds.add(set.id);
      return;
    }
    const group = groups.get(set.apiSetId) || { apiSetId: set.apiSetId, sets: [] };
    group.sets.push({ set, cards: items.map((item) => item.card) });
    groups.set(set.apiSetId, group);
  });
  return { groups: [...groups.values()], unsupportedSetIds: [...unsupportedSetIds] };
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

    const requestedIds = [...new Set(validated.map((item) => item.cardId))];
    const freshSince = new Date(Date.now() - PRICE_FRESHNESS_MS).toISOString();
    const freshQuery = await admin.from("card_prices").select(PRICE_COLUMNS).in("card_id", requestedIds).gte("synced_at", freshSince);
    if (freshQuery.error) throw freshQuery.error;
    const requestedKeys = new Set(validated.map((item) => `${item.setId}:${item.cardId}`));
    const freshRows = (Array.isArray(freshQuery.data) ? freshQuery.data : []).filter((row) => requestedKeys.has(`${row.set_id}:${row.card_id}`));
    const freshKeys = new Set(freshRows.map((row) => `${row.set_id}:${row.card_id}`));
    const pending = validated.filter((item) => !freshKeys.has(`${item.setId}:${item.cardId}`));
    const { groups, unsupportedSetIds } = buildUpstreamGroups(pending);

    const grouped = await runBoundedGroups(groups, async (group: UpstreamGroup, context) => {
      const apiCards = await fetchSetCards(group.apiSetId, context.signal, context.remainingMs);
      const rows: Record<string, unknown>[] = [];
      group.sets.forEach(({ set, cards }) => {
        const lookup = buildLookup(cards);
        apiCards.forEach((apiCard) => {
          const appCard = findAppCard(apiCard, lookup);
          if (!appCard) return;
          const row = buildPriceRow(set, appCard, apiCard, selectMarketPrice(apiCard));
          if (row) rows.push(row);
        });
      });
      if (!rows.length) {
        const error = new Error("No usable market data") as Error & { code?: string };
        error.code = "no_market_data";
        throw error;
      }
      return rows;
    });

    const refreshedRows = grouped.successes.flatMap((result) => result.value as Record<string, unknown>[]);
    const uniqueRefreshedRows = [...new Map(refreshedRows.map((row) => [String(row.card_id), row])).values()];
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
      successfulSetCount: grouped.successes.reduce((sum, result) => sum + (result.group as UpstreamGroup).sets.length, 0),
      failedSetCount: uniqueFailedSets.length,
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
