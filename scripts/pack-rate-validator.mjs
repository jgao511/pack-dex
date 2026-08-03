import { activeSets } from "../src/data/sets.js";
import {
  getRarityCategory,
  isHigherThanRare,
  isSubsetCard,
} from "../src/utils/packGenerator.js";
import { buildAudit } from "./audit-card-pull-integrity.mjs";

const DEFAULT_PACKS = 100;
const DEEP_PACKS = 10000;
const DEFAULT_SEED = "packdex-pack-rate-validator-v2";
const ROUTINE_CATEGORIES = new Set(["common", "uncommon", "rare", "holoRare"]);

function getArgValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));

  return arg ? arg.slice(prefix.length) : "";
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

function formatPercent(count, total) {
  return total > 0 ? `${((count / total) * 100).toFixed(2)}%` : "0.00%";
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function mapToText(map, total) {
  if (map.size === 0) return "none";

  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => `${key}: ${formatPercent(count, total)}`)
    .join(", ");
}

function parsePackCount() {
  const requested = Number(getArgValue("packs") || (hasArg("deep") ? DEEP_PACKS : DEFAULT_PACKS));
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new Error("--packs must be a positive integer.");
  }
  return requested;
}

function selectActiveSets() {
  const requestedIds = getArgValue("sets")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (requestedIds.length === 0) return activeSets;

  const requested = new Set(requestedIds);
  const selected = activeSets.filter((set) => requested.has(set.id));
  const missing = requestedIds.filter((id) => !selected.some((set) => set.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown or retired set id(s): ${missing.join(", ")}.`);
  }
  return selected;
}

function emptyRateReport() {
  return {
    anyHitPacks: 0,
    finalCounts: new Map(),
    specialSlotCounts: new Map(),
    totalHits: 0,
  };
}

function observePack(report, set, pack) {
  let packHits = 0;
  for (const [slotIndex, card] of pack.entries()) {
    const category = getRarityCategory(card, set);
    const isFinalSlot = slotIndex === pack.length - 1;
    if (isFinalSlot) increment(report.finalCounts, category);
    if (!isFinalSlot && (isSubsetCard(card, set) || !ROUTINE_CATEGORIES.has(category))) {
      increment(report.specialSlotCounts, category);
    }
    if (isHigherThanRare(card) || isSubsetCard(card, set)) packHits += 1;
  }

  report.totalHits += packHits;
  if (packHits > 0) report.anyHitPacks += 1;
}

function forcedFormats(auditRow) {
  const formats = Object.keys(auditRow.positivePullRoutes || {})
    .filter((route) => route.startsWith("god."))
    .map((route) => route.slice("god.".length));
  return formats.length > 0 ? formats.join(", ") : "none";
}

async function main() {
  const packCount = parsePackCount();
  const seed = getArgValue("seed") || DEFAULT_SEED;
  const selectedSets = selectActiveSets();
  const rateReports = new Map(activeSets.map((set) => [set.id, emptyRateReport()]));

  const { audit, failureMessages } = buildAudit({
    packsPerSet: packCount,
    seed,
    onNormalPack(set, pack) {
      observePack(rateReports.get(set.id), set, pack);
    },
  });
  if (audit.summary.totalFailures > 0) {
    console.error(
      `Authoritative card pull-integrity validation failed with ${audit.summary.totalFailures} error(s):`
    );
    for (const failure of failureMessages) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  const auditBySetId = new Map(audit.sets.map((row) => [row.id, row]));
  const failedRows = [];

  console.log("PackDex Pack Rate Validation");
  console.log(`Active sets structurally validated: ${audit.summary.activeSetCount}`);
  console.log(`Sets reported: ${selectedSets.length}`);
  console.log(`Normal packs per set: ${packCount.toLocaleString()}`);
  console.log(`Retired sets excluded: ${audit.scope.retiredSetsExcludedFromActiveCatalogAndPackAudit}`);
  console.log("");

  for (const set of selectedSets) {
    const auditRow = auditBySetId.get(set.id);
    if (!auditRow) {
      failedRows.push(`${set.name} (${set.id}): missing from authoritative active-set audit`);
      continue;
    }

    const report = rateReports.get(set.id);
    console.log(`Set: ${set.name} (${set.id})`);
    console.log(`  Expected pack size: ${auditRow.expectedPackSize}`);
    console.log(`  Packs simulated: ${packCount.toLocaleString()}`);
    console.log(`  Any-hit rate: ${formatPercent(report.anyHitPacks, packCount)}`);
    console.log(`  Average hits per pack: ${(report.totalHits / packCount).toFixed(3)}`);
    console.log(`  Final-slot distribution: ${mapToText(report.finalCounts, packCount)}`);
    console.log(`  Special/subset slots: ${mapToText(report.specialSlotCounts, packCount)}`);
    console.log(`  Forced special formats structurally validated: ${forcedFormats(auditRow)}`);
    console.log("  Validation: OK");
    console.log("");
  }

  if (failedRows.length > 0) {
    console.log("FAILED SETS");
    for (const failure of failedRows) console.log(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      `All ${selectedSets.length} reported active sets passed authoritative pack structure validation; ` +
        "rate distributions above are deterministic observations, not duplicated slot rules."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
