import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalCardLookup,
  buildMarketplaceRow,
  collectorNumbersDescribeSamePrinting,
  getApiCardSetId,
  isCanonicalMarketplaceUrl,
  isCanonicalIdentityConsistent,
  isTrustedCurrentPriceRow,
  matchCanonicalCard,
  normalizeCanonicalName,
  positiveNumber,
  preserveCanonicalMarketplaceIdentity,
  selectTcgplayerPrice,
} from "../supabase/functions/_shared/cardPricing.js";
import {
  classifyTcgplayerProductDetails,
  classifyTcgplayerTerminalDestination,
  getTcgplayerProductId,
  isApprovedTcgplayerHost,
} from "./marketplace-url-classifier.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = path.join(ROOT, "supabase", "functions", "sync-card-prices", "catalog.json");
const VERIFIED_PRODUCTS_PATH = path.join(ROOT, "audits", "pricing", "verified-marketplace-products.json");
const VERIFIED_FALLBACKS_PATH = path.join(ROOT, "audits", "pricing", "verified-non-reverse-fallbacks.json");
const QUARANTINE_PATH = path.join(ROOT, "src", "data", "legacyCardQuarantine.json");
const GENERATED_DATE = new Date().toISOString().slice(0, 10);

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const OUTPUT_DIR = path.resolve(ROOT, arg("output-dir", path.join("reports", `price-registry-${GENERATED_DATE}`)));
const CACHE_DIR = path.resolve(ROOT, arg("cache-dir", path.join(".cache", "price-audit")));
const API_CACHE_DIR = path.join(CACHE_DIR, "pokemon-tcg-api");
const URL_CACHE_DIR = path.join(CACHE_DIR, "tcgplayer-urls");
const SET_FILTER = new Set(String(arg("sets", "")).split(",").map((value) => value.trim()).filter(Boolean));
const URL_CONCURRENCY = Math.max(1, Number(arg("url-concurrency", "10")) || 10);
const API_CONCURRENCY = Math.max(1, Number(arg("api-concurrency", "3")) || 3);
const SKIP_URLS = hasFlag("skip-urls");
const SKIP_LIVE_ROWS = hasFlag("skip-live-rows");
const REFRESH_API = hasFlag("refresh-api");
const REFRESH_URLS = hasFlag("refresh-urls");
const VERIFIED_PRODUCTS_OUTPUT = arg("verified-products-output", null);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value) {
  return String(value ?? "").trim();
}

function asError(error) {
  return error instanceof Error ? error.message : String(error);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWrite(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, file);
}

async function writeJson(file, value) {
  await atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchWithRetry(url, options = {}, { attempts = 4, timeoutMs = 60_000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json, text/html;q=0.9, */*;q=0.8",
          "User-Agent": "PackDex exhaustive price identity audit/1.0",
          ...(options.headers || {}),
        },
      });
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts - 1) return response;
      await response.body?.cancel();
      await delay(1_000 * 2 ** attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await delay(1_000 * 2 ** attempt);
    }
  }
  throw lastError || new Error(`Unable to fetch ${url}`);
}

async function mapConcurrent(items, concurrency, task, progressLabel) {
  const output = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        output[index] = { status: "fulfilled", value: await task(items[index], index) };
      } catch (error) {
        output[index] = { status: "rejected", reason: asError(error) };
      }
      completed += 1;
      if (completed % 100 === 0 || completed === items.length) {
        process.stderr.write(`${progressLabel}: ${completed}/${items.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

async function fetchApiSet(apiSetId) {
  const cacheFile = path.join(API_CACHE_DIR, `${apiSetId}.json`);
  if (!REFRESH_API) {
    const cached = await readJson(cacheFile);
    if (cached?.apiSetId === apiSetId && Array.isArray(cached.cards)) return { ...cached, fromCache: true };
  }

  const cards = [];
  let page = 1;
  let totalCount = null;
  do {
    const url = new URL("https://api.pokemontcg.io/v2/cards");
    url.searchParams.set("q", `set.id:${apiSetId}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", "250");
    const response = await fetchWithRetry(url, {}, { attempts: 5, timeoutMs: 90_000 });
    if (!response.ok) throw new Error(`Pokemon TCG API ${response.status} for set ${apiSetId}`);
    const payload = await response.json();
    const pageCards = Array.isArray(payload?.data) ? payload.data : [];
    cards.push(...pageCards);
    totalCount = Number.isFinite(Number(payload?.totalCount)) ? Number(payload.totalCount) : cards.length;
    if (pageCards.length === 0) break;
    page += 1;
  } while (cards.length < totalCount);

  const result = { apiSetId, totalCount, fetchedAt: new Date().toISOString(), cards };
  await writeJson(cacheFile, result);
  return { ...result, fromCache: false };
}

function isViewMarketplaceUrl(value) {
  if (isCanonicalMarketplaceUrl(value)) return true;
  try {
    return isApprovedTcgplayerHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

async function auditMarketplaceUrl(url, expected) {
  const cacheKey = stableHash(`${url}\n${expected.apiCardId}\n${expected.name}\n${expected.number}\n${expected.apiSetName || expected.setName}`);
  const cacheFile = path.join(URL_CACHE_DIR, `${cacheKey}.json`);
  if (!REFRESH_URLS) {
    const cached = await readJson(cacheFile);
    if (cached?.url === url && cached?.expected?.apiCardId === expected.apiCardId && !["D", "E"].includes(cached.classification)) {
      if (cached.finalProductId && cached.details && !cached.details.error) {
        const detailIdentity = classifyTcgplayerProductDetails(cached.details, expected);
        return {
          ...cached,
          expected,
          classification: detailIdentity.classification,
          reason: detailIdentity.reason,
          detailIdentity,
          fromCache: true,
        };
      }
      return { ...cached, expected, fromCache: true };
    }
  }

  const hops = [];
  let currentUrl = url;
  let finalResponse = null;
  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await fetchWithRetry(currentUrl, { method: "HEAD", redirect: "manual" }, { attempts: 3, timeoutMs: 30_000 });
      const location = response.headers.get("location");
      hops.push({
        url: currentUrl,
        status: response.status,
        location: location ? new URL(location, currentUrl).href : null,
        host: new URL(currentUrl).hostname,
        contentType: response.headers.get("content-type"),
      });
      await response.body?.cancel();
      if (!isRedirectStatus(response.status) || !location) {
        finalResponse = response;
        break;
      }
      currentUrl = new URL(location, currentUrl).href;
    }
  } catch (error) {
    const result = {
      url,
      expected,
      auditedAt: new Date().toISOString(),
      classification: "D",
      reason: "redirect_request_failed",
      error: asError(error),
      hops,
      finalUrl: currentUrl,
      finalProductId: getTcgplayerProductId(currentUrl),
    };
    await writeJson(cacheFile, result);
    return result;
  }

  const finalStatus = finalResponse?.status || hops.at(-1)?.status || null;
  let classification = "E";
  let reason = "destination_unverifiable";
  let details = null;
  let detailIdentity = null;
  const finalProductId = getTcgplayerProductId(currentUrl);
  const finalHost = (() => { try { return new URL(currentUrl).hostname; } catch { return ""; } })();
  const terminal = classifyTcgplayerTerminalDestination({ hopCount: hops.length, lastStatus: hops.at(-1)?.status, finalStatus, finalUrl: currentUrl });

  if (terminal.classification) {
    classification = terminal.classification;
    reason = terminal.reason;
  } else {
    try {
      const detailsResponse = await fetchWithRetry(
        `https://mp-search-api.tcgplayer.com/v1/product/${encodeURIComponent(finalProductId)}/details`,
        {},
        { attempts: 3, timeoutMs: 30_000 },
      );
      if (!detailsResponse.ok) throw new Error(`TCGplayer product details HTTP ${detailsResponse.status}`);
      const raw = await detailsResponse.json();
      details = {
        productId: raw?.productId ?? null,
        productName: raw?.productName ?? null,
        setName: raw?.setName ?? null,
        setCode: raw?.setCode ?? null,
        number: raw?.customAttributes?.number ?? null,
        rarity: raw?.rarityName ?? raw?.customAttributes?.rarityDbName ?? null,
        foilOnly: raw?.foilOnly ?? null,
        normalOnly: raw?.normalOnly ?? null,
        marketPresent: positiveNumber(raw?.marketPrice) !== null,
      };
      if (String(details.productId) !== String(finalProductId)) {
        classification = "C";
        reason = "product_id_mismatch";
      } else {
        detailIdentity = classifyTcgplayerProductDetails(raw, expected);
        classification = detailIdentity.classification;
        reason = detailIdentity.reason;
      }
    } catch (error) {
      classification = "E";
      reason = "product_details_unavailable";
      details = { error: asError(error) };
    }
  }

  const result = {
    url,
    expected,
    auditedAt: new Date().toISOString(),
    classification,
    reason,
    hops,
    finalUrl: currentUrl,
    finalStatus,
    finalHost,
    finalProductId,
    detailIdentity,
    details,
  };
  await writeJson(cacheFile, result);
  return result;
}

async function discoverLiveSupabase(origin = "https://www.pack-dex.com") {
  const response = await fetchWithRetry(origin, { headers: { Accept: "text/html" } });
  if (!response.ok) throw new Error(`Live PackDex HTML returned ${response.status}`);
  const html = await response.text();
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/giu)]
    .map((match) => new URL(match[1], origin).href)
    .filter((url) => new URL(url).origin === new URL(origin).origin);
  for (const script of scripts) {
    const scriptResponse = await fetchWithRetry(script, { headers: { Accept: "application/javascript" } });
    if (!scriptResponse.ok) continue;
    const source = await scriptResponse.text();
    const supabaseUrl = source.match(/https:\/\/[a-z0-9]+\.supabase\.co/iu)?.[0];
    const publishableKey = source.match(/sb_publishable_[A-Za-z0-9_-]+/u)?.[0];
    if (supabaseUrl && publishableKey) return { supabaseUrl, publishableKey, sourceScript: script };
  }
  throw new Error("Unable to discover public Supabase configuration from the live PackDex bundle.");
}

async function fetchLivePriceRows() {
  const configuredUrl = compact(process.env.PACKDEX_AUDIT_SUPABASE_URL);
  const configuredKey = compact(process.env.PACKDEX_AUDIT_SUPABASE_ANON_KEY);
  const discovered = configuredUrl && configuredKey
    ? { supabaseUrl: configuredUrl, publishableKey: configuredKey, sourceScript: "environment" }
    : await discoverLiveSupabase(arg("live-origin", "https://www.pack-dex.com"));
  const columns = "card_id,set_id,card_number,name,rarity,price_type,market_price_usd,low_price_usd,mid_price_usd,high_price_usd,direct_low_price_usd,tcgplayer_url,source_updated_at,synced_at";
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${discovered.supabaseUrl}/rest/v1/card_prices`);
    url.searchParams.set("select", columns);
    url.searchParams.set("order", "card_id.asc");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", "1000");
    const response = await fetchWithRetry(url, {
      headers: {
        apikey: discovered.publishableKey,
        Authorization: `Bearer ${discovered.publishableKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`Live card_prices REST request returned ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("Live card_prices REST response was not an array");
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return { rows, sourceScript: discovered.sourceScript, supabaseHost: new URL(discovered.supabaseUrl).hostname };
}

function bucketAudit(prices, selection) {
  return Object.entries(prices || {}).map(([priceType, price]) => {
    const market = positiveNumber(price?.market);
    let decision = "no_positive_market";
    if (selection?.priceType === priceType) decision = "selected";
    else if (priceType === "reverseHolofoil") decision = "reverse_requires_explicit_printing";
    else if (market !== null && selection?.priceType) decision = "unselected_non_reverse_variant";
    else if (market !== null) decision = "unselected_by_finish_rules";
    return {
      priceType,
      market,
      low: positiveNumber(price?.low),
      mid: positiveNumber(price?.mid),
      high: positiveNumber(price?.high),
      directLow: positiveNumber(price?.directLow),
      decision,
    };
  });
}

function normalizedComparable(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value);
}

function classifyDryRunAction(record, identityState, proposed) {
  if (identityState !== "exact" || !record._apiCard || !proposed) return "rejected_preserve_existing";
  if (!record.storedPriceRow) return "add";
  const changed = [
    "card_id", "set_id", "card_number", "name", "rarity", "price_type",
    "market_price_usd", "low_price_usd", "mid_price_usd", "high_price_usd",
    "direct_low_price_usd", "tcgplayer_url", "source_updated_at",
  ].some((key) => normalizedComparable(record.storedPriceRow[key]) !== normalizedComparable(proposed[key]));
  return changed ? "change" : "preserve";
}

function hasProvisionalExactIdWithProviderNumberMismatch(apiCard, appCard, match) {
  return Boolean(
    appCard?.allowVerifiedNumberOverride === true &&
    apiCard &&
    match?.card?.id === appCard?.id &&
    match?.matchType === "api_card_id" &&
    compact(apiCard.id).toLowerCase() === compact(appCard.sourceCardId).toLowerCase() &&
    compact(getApiCardSetId(apiCard)).toLowerCase() === compact(appCard.sourceSetId).toLowerCase() &&
    normalizeCanonicalName(apiCard.name) === normalizeCanonicalName(appCard.name) &&
    !collectorNumbersDescribeSamePrinting(apiCard.number, appCard.number)
  );
}

const catalogSource = await fs.readFile(CATALOG_PATH, "utf8");
const catalog = JSON.parse(catalogSource);
const verifiedProductsSource = await fs.readFile(VERIFIED_PRODUCTS_PATH, "utf8");
const verifiedFallbacksSource = await fs.readFile(VERIFIED_FALLBACKS_PATH, "utf8");
const inputHashes = {
  catalogSha256: stableHash(catalogSource),
  verifiedProductsSha256: stableHash(verifiedProductsSource),
  verifiedFallbacksSha256: stableHash(verifiedFallbacksSource),
};
const selectedCatalog = SET_FILTER.size ? catalog.filter((set) => SET_FILTER.has(set.id)) : catalog;
const quarantine = await readJson(QUARANTINE_PATH, []);
const apiSetIds = [...new Set(selectedCatalog.flatMap((set) => set.apiSetIds || [set.apiSetId]).filter(Boolean))];

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.mkdir(API_CACHE_DIR, { recursive: true });
await fs.mkdir(URL_CACHE_DIR, { recursive: true });

process.stderr.write(`Fetching ${apiSetIds.length} Pokemon TCG API sets for ${selectedCatalog.length} PackDex sets.\n`);
const apiResults = await mapConcurrent(apiSetIds, API_CONCURRENCY, fetchApiSet, "Pokemon TCG API sets");
const apiBySet = new Map();
const apiFailures = [];
apiResults.forEach((result, index) => {
  const apiSetId = apiSetIds[index];
  if (result.status === "fulfilled") apiBySet.set(apiSetId, result.value.cards);
  else apiFailures.push({ apiSetId, error: result.reason });
});

let live = { rows: [], sourceScript: null, supabaseHost: null, error: null };
if (!SKIP_LIVE_ROWS) {
  try {
    live = { ...(await fetchLivePriceRows()), error: null };
  } catch (error) {
    live.error = asError(error);
    process.stderr.write(`Live card_prices unavailable: ${live.error}\n`);
  }
}
const liveRowsByCardId = new Map(live.rows.map((row) => [compact(row.card_id), row]));

const baseRecords = [];
const unmatchedApiCards = [];
for (const set of selectedCatalog) {
  const lookup = buildCanonicalCardLookup(set.cards || []);
  const setApiCards = (set.apiSetIds || [set.apiSetId]).flatMap((apiSetId) => apiBySet.get(apiSetId) || []);
  const apiById = new Map(setApiCards.map((card) => [compact(card.id), card]));
  const matchedApiIds = new Set();
  for (const appCard of set.cards || []) {
    const apiCard = apiById.get(compact(appCard.sourceCardId)) || null;
    const match = apiCard ? matchCanonicalCard(apiCard, lookup) : { card: null, matchType: null, ambiguous: false };
    const consistentIdentity = Boolean(apiCard && match.card?.id === appCard.id && isCanonicalIdentityConsistent(apiCard, appCard));
    const provisionalNumberMismatch = hasProvisionalExactIdWithProviderNumberMismatch(apiCard, appCard, match);
    const usedVerifiedNumberOverride = Boolean(
      consistentIdentity &&
      apiCard &&
      !collectorNumbersDescribeSamePrinting(apiCard.number, appCard.number)
    );
    if (consistentIdentity || provisionalNumberMismatch) matchedApiIds.add(compact(apiCard.id));
    const identityState = !apiCard
      ? "upstream_card_unavailable"
      : consistentIdentity
        ? "exact"
        : provisionalNumberMismatch
          ? "pending_product_number_verification"
        : match.ambiguous
          ? "ambiguous"
          : "mismatch";
    const selection = apiCard ? selectTcgplayerPrice(apiCard, appCard) : null;
    const storedRow = liveRowsByCardId.get(compact(appCard.sourceCardId)) || null;
    const canonicalUrl = compact(apiCard?.tcgplayer?.url || storedRow?.tcgplayer_url) || null;
    baseRecords.push({
      packDexCardId: appCard.id,
      packDexSetId: set.id,
      packDexSetName: set.name,
      canonicalName: appCard.name,
      collectorNumber: compact(appCard.number),
      rarity: appCard.rarity || null,
      knownFinishMetadata: appCard.tcgplayerPriceType || appCard.priceFinish || null,
      pokemonTcgApiSetId: appCard.sourceSetId || null,
      pokemonTcgApiCardId: appCard.sourceCardId || null,
      apiIdentityState: identityState,
      apiMatchType: match.matchType || null,
      apiIdentityNote: usedVerifiedNumberOverride ? "provider_number_corrected_by_exact_tcgplayer_product" : null,
      apiCard: apiCard ? {
        id: apiCard.id,
        name: apiCard.name,
        number: compact(apiCard.number),
        rarity: apiCard.rarity || null,
        setId: apiCard.set?.id || null,
        setName: apiCard.set?.name || null,
        tcgplayerUrl: apiCard.tcgplayer?.url || null,
        sourceUpdatedAt: apiCard.tcgplayer?.updatedAt || null,
      } : null,
      canonicalMarketplaceUrl: canonicalUrl,
      currentSelection: selection ? {
        priceType: selection.priceType,
        reason: selection.reason,
        expectedPriceType: selection.expectedPriceType,
        market: positiveNumber(selection.price?.market),
      } : null,
      apiPriceBuckets: apiCard ? bucketAudit(apiCard.tcgplayer?.prices || {}, selection) : [],
      storedPriceRow: storedRow,
      currentFreshnessState: storedRow
        ? (isTrustedCurrentPriceRow(storedRow) ? "trusted_current" : positiveNumber(storedRow.market_price_usd) !== null ? "stale" : "unavailable")
        : "missing",
      currentFrontendLinkType: storedRow?.tcgplayer_url
        ? (isViewMarketplaceUrl(storedRow.tcgplayer_url) ? "View on TCGplayer" : "Search on TCGplayer")
        : (set.tcgplayerSetSlug ? "Search on TCGplayer" : "none"),
      _apiCard: apiCard,
      _appCard: appCard,
    });
  }
  for (const apiCard of setApiCards) {
    if (!matchedApiIds.has(compact(apiCard.id))) unmatchedApiCards.push({ packDexSetId: set.id, apiSetId: apiCard.set?.id, apiCardId: apiCard.id, name: apiCard.name, number: apiCard.number });
  }
}

const recordsWithUrls = baseRecords.filter((record) => record.canonicalMarketplaceUrl && ["exact", "pending_product_number_verification"].includes(record.apiIdentityState));
const uniqueUrlRecords = [...new Map(recordsWithUrls.map((record) => [record.canonicalMarketplaceUrl, record])).values()];
const urlAuditByUrl = new Map();
const urlFailures = [];
if (!SKIP_URLS) {
  process.stderr.write(`Validating ${uniqueUrlRecords.length} canonical marketplace URLs.\n`);
  const urlResults = await mapConcurrent(uniqueUrlRecords, URL_CONCURRENCY, (record) => auditMarketplaceUrl(record.canonicalMarketplaceUrl, {
    apiCardId: record.pokemonTcgApiCardId,
    name: record.apiCard?.name || record.canonicalName,
    number: record.collectorNumber,
    setName: record.packDexSetName,
    apiSetName: record.apiCard?.setName || null,
    rarity: record.apiCard?.rarity || record.rarity,
  }), "TCGplayer URLs");
  urlResults.forEach((result, index) => {
    const url = uniqueUrlRecords[index].canonicalMarketplaceUrl;
    if (result.status === "fulfilled") urlAuditByUrl.set(url, result.value);
    else urlFailures.push({ url, error: result.reason });
  });
}

const records = baseRecords.map((record) => {
  const marketplace = record.canonicalMarketplaceUrl ? urlAuditByUrl.get(record.canonicalMarketplaceUrl) || null : null;
  const productVerifiedNumberOverride = record.apiIdentityState === "pending_product_number_verification" && marketplace?.classification === "A";
  const resolvedIdentityState = productVerifiedNumberOverride ? "exact" : record.apiIdentityState;
  const verifiedAppCard = marketplace?.classification === "A" ? {
    ...record._appCard,
    verifiedTcgplayerUrl: record.canonicalMarketplaceUrl,
    verifiedTcgplayerProductId: marketplace.finalProductId,
  } : record._appCard;
  const finalSelection = record._apiCard
    ? selectTcgplayerPrice(record._apiCard, verifiedAppCard, { requireVerifiedProduct: true })
    : null;
  const newlyAcceptedVerifiedFallback = Boolean(
    finalSelection?.priceType &&
    finalSelection.reason === "single_verified_non_reverse_bucket"
  );
  const proposedRow = record._apiCard
    ? preserveCanonicalMarketplaceIdentity(
      buildMarketplaceRow({ id: record.packDexSetId }, verifiedAppCard, record._apiCard, finalSelection),
      record.storedPriceRow,
    )
    : null;
  const { _apiCard, _appCard, ...publicRecord } = record;
  const dryRunAction = classifyDryRunAction(record, resolvedIdentityState, proposedRow);
  return {
    ...publicRecord,
    apiPriceBuckets: record._apiCard ? bucketAudit(record._apiCard.tcgplayer?.prices || {}, finalSelection) : [],
    apiIdentityState: resolvedIdentityState,
    apiIdentityNote: productVerifiedNumberOverride ? "provider_number_corrected_by_exact_tcgplayer_product" : publicRecord.apiIdentityNote,
    marketplaceDestination: marketplace,
    correctedSelection: finalSelection ? {
      priceType: finalSelection.priceType,
      reason: finalSelection.reason,
      market: positiveNumber(finalSelection.price?.market ?? finalSelection.market),
    } : null,
    newlyAcceptedByVerifiedFallback: newlyAcceptedVerifiedFallback,
    dryRunAction,
  };
});

const urlCounts = Object.fromEntries(["A", "B", "C", "D", "E"].map((key) => [key, 0]));
for (const record of records) {
  const classification = record.marketplaceDestination?.classification;
  if (classification in urlCounts) urlCounts[classification] += 1;
}

const setSummaries = selectedCatalog.map((set) => {
  const setRecords = records.filter((record) => record.packDexSetId === set.id);
  const count = (predicate) => setRecords.filter(predicate).length;
  const total = setRecords.length;
  const accepted = count((record) => positiveNumber(record.correctedSelection?.market) !== null);
  return {
    packDexSetId: set.id,
    setName: set.name,
    totalCanonicalCards: total,
    exactApiIdentities: count((record) => record.apiIdentityState === "exact"),
    exactVerifiedTcgplayerProducts: count((record) => record.marketplaceDestination?.classification === "A"),
    positiveNonReverseMarkets: count((record) => record.apiPriceBuckets.some((bucket) => bucket.priceType !== "reverseHolofoil" && bucket.market !== null)),
    reverseOnlyMarkets: count((record) => record.apiPriceBuckets.some((bucket) => bucket.priceType === "reverseHolofoil" && bucket.market !== null) && !record.apiPriceBuckets.some((bucket) => bucket.priceType !== "reverseHolofoil" && bucket.market !== null)),
    noMarket: count((record) => !record.apiPriceBuckets.some((bucket) => bucket.market !== null)),
    rejectedForAmbiguity: count((record) => ["ambiguous_variant", "rare_finish_unproven"].includes(record.currentSelection?.reason)),
    newlyAcceptedByCorrectedFinishLogic: count((record) => record.newlyAcceptedByVerifiedFallback),
    verifiedNonReverseFallbacks: count((record) => record.correctedSelection?.reason === "single_verified_non_reverse_bucket"),
    acceptedPrices: accepted,
    stillUnavailable: total - accepted,
    trustedCurrentStoredPrices: count((record) => record.currentFreshnessState === "trusted_current"),
    staleStoredPrices: count((record) => record.currentFreshnessState === "stale"),
    finalCoveragePercentage: total ? Number((accepted * 100 / total).toFixed(2)) : 0,
  };
});

const totals = setSummaries.reduce((sum, set) => {
  for (const key of [
    "totalCanonicalCards", "exactApiIdentities", "exactVerifiedTcgplayerProducts", "positiveNonReverseMarkets",
    "reverseOnlyMarkets", "noMarket", "rejectedForAmbiguity", "newlyAcceptedByCorrectedFinishLogic", "verifiedNonReverseFallbacks",
    "acceptedPrices", "stillUnavailable", "trustedCurrentStoredPrices", "staleStoredPrices",
  ]) sum[key] = (sum[key] || 0) + set[key];
  return sum;
}, {});
totals.finalCoveragePercentage = totals.totalCanonicalCards ? Number((totals.acceptedPrices * 100 / totals.totalCanonicalCards).toFixed(2)) : 0;

const verifiedFallbacks = records.filter((record) => record.newlyAcceptedByVerifiedFallback).map((record) => ({
  packDexCardId: record.packDexCardId,
  pokemonTcgApiCardId: record.pokemonTcgApiCardId,
  canonicalMarketplaceUrl: record.canonicalMarketplaceUrl,
  tcgplayerProductId: record.marketplaceDestination.finalProductId,
  priceType: record.correctedSelection.priceType,
  reason: record.correctedSelection.reason,
}));
const dryRunDiff = {
  rowsAdded: records.filter((record) => record.dryRunAction === "add").length,
  rowsChanged: records.filter((record) => record.dryRunAction === "change").length,
  rowsPreserved: records.filter((record) => record.dryRunAction === "preserve").length,
  rowsRejectedAndPreserved: records.filter((record) => record.dryRunAction === "rejected_preserve_existing").length,
  pricesNewlyAccepted: records.filter((record) => record.newlyAcceptedByVerifiedFallback).length,
  positiveStoredPricesRemovedByPolicy: records.filter((record) =>
    positiveNumber(record.storedPriceRow?.market_price_usd) !== null &&
    positiveNumber(record.correctedSelection?.market) === null &&
    record.apiIdentityState === "exact"
  ).length,
  urlsNewlyVerified: records.filter((record) => record.marketplaceDestination?.classification === "A" && record.storedPriceRow?.tcgplayer_url !== record.canonicalMarketplaceUrl).length,
  wrongUrlsRejected: records.filter((record) => record.marketplaceDestination?.classification === "C").length,
};
const verifiedMarketplaceProducts = records
  .filter((record) => record.marketplaceDestination?.classification === "A")
  .map((record) => ({
    packDexCardId: record.packDexCardId,
    pokemonTcgApiCardId: record.pokemonTcgApiCardId,
    canonicalMarketplaceUrl: record.canonicalMarketplaceUrl,
    tcgplayerProductId: record.marketplaceDestination.finalProductId,
  }));

const summary = {
  generatedAt: new Date().toISOString(),
  source: {
    catalog: path.relative(ROOT, CATALOG_PATH),
    inputHashes,
    pokemonTcgApi: "Pokemon TCG API v2 live cards endpoint with resumable cache",
    liveCardPrices: SKIP_LIVE_ROWS
      ? { skipped: true }
      : live.error
        ? { available: false, error: live.error }
        : { available: true, rowCount: live.rows.length, host: live.supabaseHost, discoveredFrom: live.sourceScript },
    tcgplayer: SKIP_URLS ? "skipped" : "canonical redirects plus TCGplayer product-page details used for identity verification only",
  },
  activeSetCount: selectedCatalog.length,
  activeCardCount: records.length,
  quarantineCardCount: Array.isArray(quarantine) ? quarantine.length : 0,
  apiSetCount: apiSetIds.length,
  apiFailureCount: apiFailures.length,
  apiFailures,
  unmatchedApiCardCount: unmatchedApiCards.length,
  urlFailureCount: urlFailures.length,
  urlFailures,
  urlCounts,
  totals,
  verifiedFallbackCount: verifiedFallbacks.length,
  offlineDryRunEstimateLimitations: "This comparison replays the shared row builder against a live REST snapshot. Production write authorization, RPC transaction execution, and deletion counts must be verified by the deployed Edge dry-run response before writes.",
  dryRunDiff,
  sets: setSummaries,
  outputFiles: {
    registry: "registry.jsonl",
    urls: "url-audit.jsonl",
    verifiedFallbacks: "verified-non-reverse-fallbacks.json",
    verifiedMarketplaceProducts: "verified-marketplace-products.json",
    quarantine: "historical-quarantine.json",
    unmatchedApiCards: "unmatched-api-cards.json",
  },
};

await atomicWrite(path.join(OUTPUT_DIR, "registry.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
await atomicWrite(path.join(OUTPUT_DIR, "url-audit.jsonl"), `${[...urlAuditByUrl.values()].map((value) => JSON.stringify(value)).join("\n")}\n`);
await writeJson(path.join(OUTPUT_DIR, "verified-non-reverse-fallbacks.json"), verifiedFallbacks);
await writeJson(path.join(OUTPUT_DIR, "verified-marketplace-products.json"), verifiedMarketplaceProducts);
if (VERIFIED_PRODUCTS_OUTPUT) {
  await atomicWrite(path.resolve(ROOT, VERIFIED_PRODUCTS_OUTPUT), `${JSON.stringify(verifiedMarketplaceProducts)}\n`);
}
await writeJson(path.join(OUTPUT_DIR, "historical-quarantine.json"), quarantine);
await writeJson(path.join(OUTPUT_DIR, "unmatched-api-cards.json"), unmatchedApiCards);
await writeJson(path.join(OUTPUT_DIR, "summary.json"), summary);

console.log(JSON.stringify({ outputDirectory: OUTPUT_DIR, ...summary, sets: undefined }, null, 2));
if (apiFailures.length > 0 || records.some((record) => ["ambiguous", "mismatch"].includes(record.apiIdentityState))) process.exitCode = 2;
