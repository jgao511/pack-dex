import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeLivePriceCoverage } from "./live-price-coverage-metrics.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(root, "supabase/functions/sync-card-prices/catalog.json");
const outputPath = resolve(root, process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) || "reports/packdex-live-price-coverage-2026-08-03.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const requestedSets = new Set(
  (process.argv.find((arg) => arg.startsWith("--sets="))?.slice(7) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const selectedCatalog = requestedSets.size ? catalog.filter((set) => requestedSets.has(set.id)) : catalog;
const apiSetIds = [...new Set(selectedCatalog.flatMap((set) => set.apiSetIds || [set.apiSetId]).filter(Boolean))];

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "PackDex pricing identity coverage audit",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
      await delay(1_500 * 2 ** attempt);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`Pokemon TCG API ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchApiSet(apiSetId) {
  const cards = [];
  let page = 1;
  let totalCount = null;
  do {
    const query = encodeURIComponent(`set.id:${apiSetId}`);
    const payload = await fetchJson(`https://api.pokemontcg.io/v2/cards?q=${query}&page=${page}&pageSize=250`);
    cards.push(...(payload.data || []));
    totalCount = Number.isFinite(Number(payload.totalCount)) ? Number(payload.totalCount) : cards.length;
    page += 1;
  } while (cards.length < totalCount);
  return { apiSetId, cards, totalCount };
}

async function mapWithConcurrency(items, concurrency, task) {
  const output = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        output[index] = { status: "fulfilled", value: await task(items[index]) };
      } catch (error) {
        output[index] = { status: "rejected", reason: error instanceof Error ? error.message : String(error) };
      }
      completed += 1;
      if (completed % 10 === 0 || completed === items.length) console.error(`Audited ${completed}/${items.length} API sets`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

const fetchedResults = await mapWithConcurrency(apiSetIds, 4, fetchApiSet);
const fetchedBySet = new Map();
const errorsBySet = new Map();
fetchedResults.forEach((result, index) => {
  const apiSetId = apiSetIds[index];
  if (result.status === "fulfilled") fetchedBySet.set(apiSetId, result.value);
  else errorsBySet.set(apiSetId, result.reason);
});

const sets = selectedCatalog.map((set) => {
  const mappedApiSetIds = set.apiSetIds || [set.apiSetId];
  const apiCards = mappedApiSetIds.flatMap((apiSetId) => fetchedBySet.get(apiSetId)?.cards || []);
  const apiErrors = mappedApiSetIds.flatMap((apiSetId) => errorsBySet.has(apiSetId) ? [{ apiSetId, error: errorsBySet.get(apiSetId) }] : []);
  return summarizeLivePriceCoverage(set, apiCards, apiErrors);
});

const totals = sets.reduce((sum, item) => {
  for (const key of [
    "packDexCanonicalCardCount", "apiCardsFetched", "exactCardMatches", "exactApiIdMatches",
    "setNumberNameMatches", "uniqueSetNumberMatches", "cardsWithTcgplayerObject",
    "cardsWithCanonicalTcgplayerUrl", "cardsWithAnyPositiveMarketPrice",
    "cardsWithAcceptedMarketPrice", "cardsWithUrlButNoAcceptedMarketPrice",
    "packDexCardsWithNoApiMatch", "apiCardsWithNoPackDexMapping", "skippedVariants",
    "ambiguousApiCards", "suspiciousMappings",
  ]) sum[key] = (sum[key] || 0) + item[key];
  return sum;
}, {});
totals.acceptedMarketCoveragePercentage = totals.packDexCanonicalCardCount
  ? Number((totals.cardsWithAcceptedMarketPrice * 100 / totals.packDexCanonicalCardCount).toFixed(2))
  : 0;
totals.identityCoveragePercentage = totals.packDexCanonicalCardCount
  ? Number((totals.exactCardMatches * 100 / totals.packDexCanonicalCardCount).toFixed(2))
  : 0;

const report = {
  generatedAt: new Date().toISOString(),
  source: "Pokemon TCG API v2 live cards endpoint",
  catalogPath: "supabase/functions/sync-card-prices/catalog.json",
  setCount: sets.length,
  apiSetCount: apiSetIds.length,
  failedApiSetCount: errorsBySet.size,
  failedApiSets: [...errorsBySet].map(([apiSetId, error]) => ({ apiSetId, error })),
  totals,
  sets,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...report, sets: undefined }, null, 2));
