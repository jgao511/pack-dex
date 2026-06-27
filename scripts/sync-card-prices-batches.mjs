import fs from "node:fs";
import path from "node:path";
import { loadAppPriceSyncData } from "./load-app-price-sync-data.mjs";

const ROOT_DIR = process.cwd();
const PROJECT_REF_PATH = path.join(ROOT_DIR, "supabase", ".temp", "project-ref");
const NEWER_MISSING_MARKET_SET_IDS = ["ascended-heroes", "perfect-order", "chaos-rising"];

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;

  return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readProjectRef() {
  const explicit = getArg("--project-ref");
  if (explicit) return explicit.trim();

  if (!fs.existsSync(PROJECT_REF_PATH)) {
    throw new Error(
      "Could not find supabase/.temp/project-ref. Run this from the repo root after linking the Supabase project, or pass --project-ref <ref>."
    );
  }

  return fs.readFileSync(PROJECT_REF_PATH, "utf8").trim();
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 12) return `${key.slice(0, 4)}...`;
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postBatch({ url, anonKey, setIds, setApiIds, setTcgplayerSlugs, appCardCounts, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ setIds, setApiIds, setTcgplayerSlugs, appCardCounts }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Batch request failed with HTTP ${response.status}.`);
    error.body = body;
    throw error;
  }

  return body;
}

async function postBatchWithRetry({
  url,
  anonKey,
  setIds,
  setApiIds,
  setTcgplayerSlugs,
  appCardCounts,
  timeoutMs,
  retries,
  retryDelayMs,
}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await postBatch({ url, anonKey, setIds, setApiIds, setTcgplayerSlugs, appCardCounts, timeoutMs });

      if (Array.isArray(result.errors) && result.errors.length > 0) {
        const error = new Error(`Batch returned ${result.errors.length} set error(s).`);
        error.body = result;
        throw error;
      }

      if (result.success === false) {
        const error = new Error("Batch returned success:false.");
        error.body = result;
        throw error;
      }

      return result;
    } catch (error) {
      lastError = error;

      if (attempt >= retries) break;

      const delay = retryDelayMs * 2 ** attempt;
      console.warn(`Attempt ${attempt + 1} failed. Retrying in ${Math.round(delay / 1000)}s...`);
      await wait(delay);
    }
  }

  throw lastError || new Error("Batch failed.");
}

function getRequestedSetIds() {
  if (hasFlag("--newer-missing-market")) return NEWER_MISSING_MARKET_SET_IDS;

  const setArgs = process.argv
    .filter((arg) => arg.startsWith("--set="))
    .map((arg) => arg.slice("--set=".length).trim())
    .filter(Boolean);

  if (hasFlag("--all") || setArgs.some((setId) => setId.toLowerCase() === "all")) return null;

  return setArgs;
}

function logSetInventory({ appSets, requestedSetIds, selectedSets, skippedSets, syncableSets }) {
  const totalCards = selectedSets.reduce((total, set) => total + set.cardCount, 0);
  const totalLookupCards = selectedSets.reduce((total, set) => total + set.cardsWithPriceLookupInfo, 0);
  const totalMissingLookupCards = selectedSets.reduce((total, set) => total + set.cardsMissingPriceLookupInfo, 0);
  const unknownRequestedSetIds = requestedSetIds
    ? requestedSetIds.filter((setId) => !appSets.some((set) => set.id === setId))
    : [];

  console.log(`Total app sets found: ${appSets.length}`);
  console.log(`Selected app sets: ${selectedSets.length}`);
  console.log(`Syncable sets: ${syncableSets.length}`);
  console.log(`Skipped sets: ${skippedSets.length}`);
  console.log(`Cards found in selected sets: ${totalCards}`);
  console.log(`Cards with price lookup info: ${totalLookupCards}`);
  console.log(`Cards skipped due to missing price lookup info: ${totalMissingLookupCards}`);

  if (unknownRequestedSetIds.length > 0) {
    console.warn(`Requested set ids not found in app data: ${unknownRequestedSetIds.join(", ")}`);
  }

  console.log("Set IDs found:");
  selectedSets.forEach((set) => {
    const apiLabel = set.apiSetId || "none";
    const slugLabel = set.tcgplayerSetSlug || "none";
    const status = set.canSync ? `sync via API ${apiLabel}` : `skip: ${set.skipReason}`;
    console.log(
      `- ${set.id} (${set.name}): ${set.cardCount} cards, API=${apiLabel}, TCGplayer slug=${slugLabel}, ${set.cardsWithPriceLookupInfo} with lookup info, ${status}`
    );
  });

  if (skippedSets.length > 0) {
    console.log("Sets skipped because no price source exists:");
    skippedSets.forEach((set) => {
      console.log(`- ${set.id} (${set.name}): ${set.cardCount} cards, ${set.skipReason}`);
    });
  }
}

async function main() {
  const anonKey = getArg("--anon-key") || process.env.PACKDEX_SYNC_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const batchSize = Math.max(1, Number(getArg("--batch-size", "3")) || 3);
  const delayMs = Math.max(0, Number(getArg("--delay-ms", "2500")) || 0);
  const timeoutMs = Math.max(15000, Number(getArg("--timeout-ms", "150000")) || 150000);
  const retries = Math.max(0, Number(getArg("--retries", "2")) || 0);
  const retryDelayMs = Math.max(1000, Number(getArg("--retry-delay-ms", "7000")) || 7000);
  const startAtBatch = Math.max(1, Number(getArg("--start-at-batch", "1")) || 1);
  const endAtBatchArg = getArg("--end-at-batch");
  const endAtBatch = endAtBatchArg ? Math.max(startAtBatch, Number(endAtBatchArg) || startAtBatch) : null;
  const continueOnFailure = hasFlag("--continue-on-failure");
  const requestedSetIds = getRequestedSetIds();

  if (!anonKey) {
    throw new Error(
      'Missing anon/publishable key. Pass --anon-key "sb_publishable_..." or set PACKDEX_SYNC_ANON_KEY for this terminal session.'
    );
  }

  const projectRef = readProjectRef();
  const url = `https://${projectRef}.functions.supabase.co/sync-card-prices`;
  const appSets = await loadAppPriceSyncData(ROOT_DIR);
  const selectedSets = requestedSetIds && requestedSetIds.length > 0
    ? requestedSetIds.map((setId) => appSets.find((set) => set.id === setId)).filter(Boolean)
    : appSets;
  const syncableSets = selectedSets.filter((set) => set.canSync);
  const skippedSets = selectedSets.filter((set) => !set.canSync);
  const setIds = syncableSets.map((set) => set.id);
  const setApiIds = Object.fromEntries(syncableSets.map((set) => [set.id, set.apiSetId]));
  const setTcgplayerSlugs = Object.fromEntries(
    syncableSets.filter((set) => set.tcgplayerSetSlug).map((set) => [set.id, set.tcgplayerSetSlug])
  );
  const appCardCounts = Object.fromEntries(syncableSets.map((set) => [set.id, set.cardCount]));
  const batches = chunk(setIds, batchSize);
  const dryRun = hasFlag("--dry-run");
  const selectedBatches = batches
    .map((batch, index) => ({ batch, index }))
    .filter(({ index }) => index + 1 >= startAtBatch && (!endAtBatch || index + 1 <= endAtBatch));

  console.log(`PackDex price sync batch runner`);
  console.log(`Project: ${projectRef}`);
  console.log(`Key: ${maskKey(anonKey)}`);
  logSetInventory({ appSets, requestedSetIds, selectedSets, skippedSets, syncableSets });
  console.log(`Sets attempted for API lookup: ${setIds.length}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Request timeout: ${Math.round(timeoutMs / 1000)}s`);
  console.log(`Retries per batch: ${retries}`);
  if (startAtBatch > 1 || endAtBatch) {
    console.log(`Running batch range: ${startAtBatch}-${endAtBatch || batches.length}`);
  }

  if (dryRun) {
    selectedBatches.forEach(({ batch, index }) => console.log(`Batch ${index + 1}/${batches.length}: ${batch.join(", ")}`));
    return;
  }

  if (setIds.length === 0) {
    console.warn("No syncable sets found. Nothing was posted to the Edge Function.");
    return;
  }

  let totalUpserted = 0;
  let totalSkipped = 0;
  let totalNoMarket = 0;
  let totalExcluded = 0;
  let totalDeleted = 0;
  let totalPreserved = 0;
  const failures = [];

  for (const { batch, index } of selectedBatches) {
    const label = `Batch ${index + 1}/${batches.length}`;
    console.log(`${label}: ${batch.join(", ")}`);

    try {
      const result = await postBatchWithRetry({
        url,
        anonKey,
        setIds: batch,
        setApiIds,
        setTcgplayerSlugs,
        appCardCounts,
        timeoutMs,
        retries,
        retryDelayMs,
      });
      totalUpserted += Number(result.cardsUpserted || 0);
      totalSkipped += Number(result.skippedNoPrice || 0);
      totalNoMarket += Number(result.skippedNoMarketPrice || 0);
      totalExcluded += Number(result.skippedExcludedVariant || 0);
      totalDeleted += Number(result.stalePricesDeleted || 0);
      totalPreserved += Number(result.stalePricesPreserved || 0);

      console.log(
        `${label} done: ${result.cardsUpserted || 0} upserted, ${result.skippedNoMarketPrice || 0} no-market skipped, ${
          result.skippedExcludedVariant || 0
        } variant skipped, ${result.stalePricesDeleted || 0} stale deleted.`
      );

      if (Array.isArray(result.setResults)) {
        result.setResults.forEach((setResult) => {
          console.log(
            `  ${setResult.setId}: API=${setResult.apiSetId || "none"}, slug=${
              setResult.tcgplayerSetSlug || "none"
            }, app cards=${setResult.appCardCount ?? "unknown"}, external cards=${setResult.externalCardsFetched || 0}, prices=${
              setResult.pricesUpserted || 0
            }, skipped=${setResult.cardsSkipped || 0}, coverage=${Math.round(Number(setResult.marketCoverage || 0) * 100)}%${
              setResult.stalePricesPreserved ? `, stale preserved=${setResult.stalePricesPreserved}` : ""
            }`
          );
          if (setResult.warning) {
            console.warn(`    warning: ${setResult.warning}`);
          }
        });
      }

      if (Array.isArray(result.errors) && result.errors.length > 0) {
        failures.push(...result.errors.map((error) => ({ batch, error })));
        console.warn(`${label} returned ${result.errors.length} set error(s).`);
      }
    } catch (error) {
      failures.push({ batch, error: error.body || error.message });
      console.error(`${label} failed.`);
      console.error(JSON.stringify(error.body || error.message, null, 2));
      console.error(`Stopped at ${label}. Resume after fixing with --start-at-batch ${index + 1}, or retry just this batch with:`);
      console.error(batch.map((setId) => `--set=${setId}`).join(" "));

      if (!continueOnFailure) {
        process.exitCode = 1;
        break;
      }
    }

    if (index < batches.length - 1 && delayMs > 0) {
      await wait(delayMs);
    }
  }

  console.log("Price sync finished.");
  console.log(`${totalUpserted} cards upserted.`);
  console.log(`${totalNoMarket} cards had no TCGplayer market price from the API.`);
  console.log(`${totalSkipped} cards had no current usable TCGplayer price from the API.`);
  console.log(`${totalExcluded} cards were skipped as excluded vintage variants.`);
  console.log(`${totalDeleted} stale prices deleted.`);
  console.log(`${totalPreserved} stale prices preserved because upstream market coverage was too low.`);

  if (failures.length > 0) {
    console.warn(`${failures.length} batch/set issue(s) were reported. Review the output above.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
