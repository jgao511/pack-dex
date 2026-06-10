import {
  generatePack,
  getFinalSlotWeight,
  getFinalSlotCategoryDiagnostics,
  getFinalSlotWeights,
  getFoilClass,
  getNormalizedSetId,
  getPackPools,
  getPullRateProfile,
  getRarityCategory,
  getSubsetSlotConfig,
  getSubsetType,
  isHigherThanRare,
  isSubsetCard,
  normalizeRarity,
  subsetSlotRules,
} from "./packGenerator.js";
import { hardcodedPullRates } from "../data/hardcodedPullRates.js";

function percent(count, total) {
  return total > 0 ? (count / total) * 100 : 0;
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function mapToRows(map, total, expected = {}) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => {
      const actualPercent = percent(count, total);
      const expectedPercent = expected[category];

      return {
        category,
        count,
        actual: formatPercent(actualPercent),
        expected: expectedPercent === undefined ? "N/A" : `~${expectedPercent}%`,
        difference:
          expectedPercent === undefined ? "N/A" : `${(actualPercent - expectedPercent).toFixed(2)} pts`,
      };
    });
}

function getProfileName(set) {
  const setId = getNormalizedSetId(set);

  if (hardcodedPullRates[setId]) return setId;

  return set.pullRateProfile || "default";
}

function getExpectedProfilePercentages(profile, set = {}) {
  const weights = getFinalSlotWeights(profile, set);
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);

  return Object.fromEntries(
    Object.entries(weights).map(([category, weight]) => [category, percent(weight, total)])
  );
}

function getExpectedActivePercentages(activeWeights) {
  const total = Object.values(activeWeights).reduce((sum, weight) => sum + weight, 0);

  return Object.fromEntries(
    Object.entries(activeWeights).map(([category, weight]) => [category, percent(weight, total)])
  );
}

function getSubsetExpectedPercentages(subsetSlotConfig) {
  const rates = subsetSlotConfig?.rates || {};
  const subsetRates = Object.fromEntries(Object.entries(rates).filter(([category]) => category !== "normal"));
  const total = Object.values(rates).reduce((sum, weight) => sum + weight, 0);

  if (total <= 0) return {};

  return Object.fromEntries(
    Object.entries(subsetRates).map(([category, weight]) => [category, percent(weight, total)])
  );
}

function formatBreakdown(counts, total) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${category} ${formatPercent(percent(count, total))}`)
    .join(", ");
}

function getRarityCounts(cards, set) {
  const counts = new Map();

  for (const card of cards) {
    increment(counts, getRarityCategory(card, set));
  }

  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function getPoolSizes(set) {
  const pools = getPackPools(set);

  return {
    commonPool: pools.commonPool.length,
    uncommonPool: pools.uncommonPool.length,
    reverseSlotPool: pools.reverseSlotPool.length,
    finalSlotPool: pools.finalSlotPool.length,
    subsetPool: pools.subsetPool.length,
  };
}

function hasExpectedSubsetRule(set) {
  return Boolean(getSubsetSlotConfig(set) || subsetSlotRules[getNormalizedSetId(set)]);
}

export function getPackRaritySummary(pack, set) {
  const finalCard = pack.at(-1);
  const subsetHits = pack.filter((card, index) => index !== pack.length - 1 && isSubsetCard(card, set));

  return {
    packSize: pack.length,
    finalCategory: finalCard ? getRarityCategory(finalCard, set) : "missing",
    finalRarity: finalCard?.rarity || "Missing",
    finalName: finalCard?.name || "Missing",
    finalIsHigherThanRare: Boolean(finalCard && isHigherThanRare(finalCard)),
    finalFoilClass: finalCard ? getFoilClass(finalCard) : "",
    subsetHits: subsetHits.map((card) => ({
      name: card.name,
      rarity: card.rarity,
      subset: card.subset || getSubsetType(card, set),
      category: getRarityCategory(card, set),
    })),
  };
}

export function compareActualToExpected(results, set) {
  const expected = getExpectedActivePercentages(results.finalSlotDiagnostics.activeWeights);

  return mapToRows(results.finalCategoryCounts, results.packCount, expected);
}

export function testPullRates(set, packCount = 10000) {
  if (!set?.cards?.length) {
    console.warn("Cannot test pull rates: missing set or card data.", set);
    return undefined;
  }

  if (packCount >= 100000) {
    console.warn(`Running ${packCount.toLocaleString()} pack simulations may briefly pause the browser.`);
  }

  const profile = getPullRateProfile(set);
  const profileName = getProfileName(set);
  const finalSlotWeights = getFinalSlotWeights(profile, set);
  const subsetSlotConfig = getSubsetSlotConfig(set);
  const pools = getPackPools(set);
  const finalSlotDiagnostics = getFinalSlotCategoryDiagnostics(pools.finalSlotPool, set);
  const expectedPercentages = getExpectedActivePercentages(finalSlotDiagnostics.activeWeights);
  const subsetExpectedPercentages = getSubsetExpectedPercentages(subsetSlotConfig);
  const finalCategoryCounts = new Map();
  const finalRarityCounts = new Map();
  const subsetTypeCounts = new Map();
  const chaseCounts = new Map();
  let higherHitCount = 0;
  let normalRareCount = 0;
  let subsetHitCount = 0;
  let totalPackSize = 0;
  const warnings = [];
  const profileNotes = [];

  for (let index = 0; index < packCount; index += 1) {
    const pack = generatePack(set.cards, set);
    const finalCard = pack.at(-1);

    totalPackSize += pack.length;

    if (!finalCard) {
      increment(finalCategoryCounts, "missing");
      continue;
    }

    const finalCategory = getRarityCategory(finalCard, set);

    increment(finalCategoryCounts, finalCategory);
    increment(finalRarityCounts, finalCard.rarity || "Unknown");

    if (finalCategory === "rare" || finalCategory === "holoRare") {
      normalRareCount += 1;
    }

    if (isHigherThanRare(finalCard)) {
      higherHitCount += 1;
    }

    if (["victiniRare", "blackWhiteRare", "megaHyperRare"].includes(finalCategory)) {
      increment(chaseCounts, finalCategory);
    }

    for (let slotIndex = 0; slotIndex < pack.length - 1; slotIndex += 1) {
      const card = pack[slotIndex];

      if (isSubsetCard(card, set)) {
        subsetHitCount += 1;
        increment(subsetTypeCounts, getRarityCategory(card, set) || getSubsetType(card, set) || card.subset || "subset");
      }
    }
  }

  const rarityCounts = getRarityCounts(set.cards, set);
  const finalHigherCards = pools.finalSlotPool.filter((card) => isHigherThanRare(card));
  const uniqueFinalCategories = finalCategoryCounts.size;
  const actualRarePercent = percent(finalCategoryCounts.get("rare") || 0, packCount);
  const expectedRarePercent = expectedPercentages.rare;

  if (higherHitCount === 0) {
    warnings.push("No higher-than-rare cards were pulled in this simulation.");
  }

  if (profile.packSize !== 4 && pools.commonPool.length === 0) {
    warnings.push("commonPool is empty.");
  }

  if (profile.packSize !== 4 && pools.uncommonPool.length === 0) {
    warnings.push("uncommonPool is empty.");
  }

  if (pools.finalSlotPool.length === 0) {
    warnings.push("finalSlotPool is empty.");
  }

  if (finalHigherCards.length === 0) {
    warnings.push("No higher-than-rare cards detected. Check rarity parsing or card data.");
  }

  if (hasExpectedSubsetRule(set) && pools.subsetPool.length === 0) {
    warnings.push("Expected subset cards, but none were detected. Check subset detection.");
  }

  if (uniqueFinalCategories <= 1) {
    warnings.push("Final slot always returned the same rarity/category.");
  }

  for (const category of finalSlotDiagnostics.categoriesWithoutWeight) {
    profileNotes.push(`Category ${category} exists in finalSlotPool but has no configured weight.`);
  }

  for (const category of finalSlotDiagnostics.profileWeightsWithoutCards) {
    profileNotes.push(`Configured final-slot rate ${category} has no matching cards and was skipped.`);
  }

  for (const category of Object.keys(finalSlotDiagnostics.activeWeights)) {
    if (category !== "rare" && !finalCategoryCounts.has(category)) {
      warnings.push(`Higher-rarity category ${category} has active weight but never appeared in this simulation.`);
    }
  }

  if (expectedRarePercent !== undefined && actualRarePercent - expectedRarePercent > 10) {
    warnings.push(
      `Actual rare percentage is more than 10 points above expected (${formatPercent(actualRarePercent)} vs ${formatPercent(expectedRarePercent)}).`
    );
  }

  const results = {
    setId: set.id,
    setName: set.name,
    profileName,
    profile,
    packCount,
    averagePackSize: totalPackSize / packCount,
    rarityCounts,
    finalSlotDiagnostics,
    source: profile.source || "fallback profile",
    sourceUrl: profile.sourceUrl || "",
    notes: profile.notes || "",
    finalSlotWeights,
    subsetSlotConfig,
    subsetExpectedPercentages,
    poolSizes: getPoolSizes(set),
    finalCategoryCounts,
    finalRarityCounts,
    subsetTypeCounts,
    subsetHitCount,
    higherHitCount,
    normalRareCount,
    chaseCounts,
    profileNotes,
    warnings,
  };

  console.group(`${set.name} - ${packCount.toLocaleString()} packs simulated`);
  console.log("Set id:", set.id);
  console.log("Profile:", profileName, profile);
  console.log("Source:", results.source);
  if (results.sourceUrl) console.log("Source URL:", results.sourceUrl);
  if (results.notes) console.log("Notes:", results.notes);
  console.log("Average pack size:", results.averagePackSize.toFixed(2));
  console.log("Configured final-slot rates:");
  console.table(finalSlotWeights);
  if (subsetSlotConfig) {
    console.log("Configured subset-slot rates:");
    console.table(subsetSlotConfig.rates);
  }
  console.log("Detected rarity/category counts before simulation:");
  console.table(rarityCounts);
  console.log("Pool sizes:");
  console.table(results.poolSizes);
  console.log("Final slot category pool:");
  console.table(results.finalSlotDiagnostics.poolCounts);
  console.log("Final slot active weights:");
  console.table(results.finalSlotDiagnostics.activeWeights);
  if (results.finalSlotDiagnostics.categoriesWithoutWeight.length > 0) {
    console.info(
      "Profile notes - final slot categories with no active configured weight:",
      results.finalSlotDiagnostics.categoriesWithoutWeight
    );
  }
  if (results.finalSlotDiagnostics.profileWeightsWithoutCards.length > 0) {
    console.info(
      "Profile notes - configured rates with no matching final-slot cards:",
      results.finalSlotDiagnostics.profileWeightsWithoutCards
    );
  }
  console.log("Final slot:");
  console.table(mapToRows(finalCategoryCounts, packCount, expectedPercentages));
  console.log("Final slot raw rarity labels:");
  console.table(mapToRows(finalRarityCounts, packCount));

  if (subsetTypeCounts.size > 0 || hasExpectedSubsetRule(set)) {
    console.log("Special subset slots:");
    console.table(mapToRows(subsetTypeCounts, packCount, subsetExpectedPercentages));
  } else {
    console.log("Special subset slots: None");
  }

  if (chaseCounts.size > 0) {
    console.log("Chase rare hits:");
    console.table(mapToRows(chaseCounts, packCount));
  }

  console.log("Expected vs actual:");
  console.table(compareActualToExpected(results, set));
  console.log("Profile notes:", profileNotes.length > 0 ? profileNotes : "None");
  console.log("Warnings:", warnings.length > 0 ? warnings : "None");
  console.groupEnd();

  return results;
}

export function testAllPullRates(sets, packCount = 10000) {
  if (packCount >= 100000) {
    console.warn("Running 100,000 pack tests for all sets can take a while. Consider testing one set first.");
  }

  const rows = [];
  const resultsBySet = [];

  console.group(`All sets - ${packCount.toLocaleString()} packs each`);

  for (const set of sets) {
    if (!set?.cards?.length) {
      console.warn(`Skipping ${set?.name || "unknown set"}: missing or empty card data.`);
      continue;
    }

    const results = testPullRates(set, packCount);

    if (!results) continue;

    const higherPercent = percent(results.higherHitCount, packCount);
    const normalRarePercent = percent(results.normalRareCount, packCount);
    const subsetPercent = results.subsetTypeCounts.size > 0 ? percent(results.subsetHitCount, packCount) : undefined;
    const chaseTotal = [...results.chaseCounts.values()].reduce((sum, count) => sum + count, 0);
    const status =
      results.warnings.length > 0 || higherPercent === 0
        ? "CHECK RARITY DATA"
        : "OK";

    rows.push({
      "Set Name": results.setName,
      Profile: results.profileName,
      "Pack Size": results.averagePackSize.toFixed(0),
      Packs: packCount,
      "Normal Rare %": formatPercent(normalRarePercent),
      "Higher Hit %": formatPercent(higherPercent),
      "Subset Hit %": subsetPercent === undefined ? "N/A" : formatPercent(subsetPercent),
      "Chase Hit %": formatPercent(percent(chaseTotal, packCount)),
      "Final Slot Breakdown": formatBreakdown(results.finalCategoryCounts, packCount),
      Status: status,
    });
    resultsBySet.push(results);
  }

  console.log("Compact comparison summary:");
  console.table(rows);
  console.groupEnd();

  return {
    rows,
    resultsBySet,
  };
}

export function logUniqueRarities(sets) {
  const rarityValues = new Set();

  for (const set of sets) {
    for (const card of set.cards || []) {
      rarityValues.add(card.rarity ?? "");
    }
  }

  const rows = [...rarityValues]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((rawRarity) => {
      const card = { rarity: rawRarity, name: "", id: "", number: "" };

      return {
        "Raw Rarity": rawRarity || "(missing)",
        Normalized: normalizeRarity(rawRarity),
        Category: getRarityCategory(card),
      };
    });

  console.group("Unique card rarity values");
  console.table(rows);
  console.groupEnd();

  return rows;
}

export function printHardcodedRateTable() {
  const rows = Object.entries(hardcodedPullRates).map(([setId, config]) => ({
    "Set Id": setId,
    Source: config.source || "fallback",
    "Pack Size": config.packSize || 10,
    "Final Slot Rates": Object.entries(config.finalSlot || {})
      .map(([category, weight]) => `${category}: ${weight}`)
      .join(", "),
    "Subset Slot Rates": config.subsetSlot
      ? Object.entries(config.subsetSlot.rates || {})
          .map(([category, weight]) => `${category}: ${weight}`)
          .join(", ")
      : "None",
    Notes: config.notes || "",
  }));

  console.group("Hardcoded pull-rate table");
  console.table(rows);
  console.groupEnd();

  return rows;
}

export function validateHardcodedPullRates(sets) {
  const rows = sets.map((set) => {
    const setId = getNormalizedSetId(set);
    const config = hardcodedPullRates[setId];
    const pools = getPackPools(set);
    const diagnostics = getFinalSlotCategoryDiagnostics(pools.finalSlotPool, set);
    const finalWeights = config?.finalSlot || {};
    const subsetConfig = getSubsetSlotConfig(set);
    const seriousWarnings = [];
    const notes = [];

    if (!config) {
      notes.push("No hardcoded rate entry; app will use fallback profile.");
    }

    if (pools.finalSlotPool.length === 0) {
      seriousWarnings.push("finalSlotPool is empty.");
    }

    if (subsetConfig && pools.subsetPool.length === 0) {
      seriousWarnings.push("Subset slot configured, but subsetPool is empty.");
    }

    for (const category of Object.keys(finalWeights)) {
      if (!diagnostics.cardsByCategory[category]) {
        notes.push(`${category} has a configured rate but no direct card category; aliases may cover it.`);
      }
    }

    for (const category of diagnostics.categoriesWithoutWeight) {
      notes.push(`${category} exists in finalSlotPool but has no active configured weight.`);
    }

    return {
      "Set Name": set.name,
      "Set Id": set.id,
      "Has Hardcoded Rates": Boolean(config),
      "Pack Size": config?.packSize || "fallback",
      "Final Pool": pools.finalSlotPool.length,
      "Subset Pool": pools.subsetPool.length,
      "Active Final Weights": Object.keys(diagnostics.activeWeights).join(", ") || "None",
      Notes: notes.join(" | ") || "None",
      Warnings: seriousWarnings.join(" | ") || "None",
    };
  });

  console.group("Hardcoded pull-rate validation");
  console.table(rows);
  console.groupEnd();

  return rows;
}

if (typeof window !== "undefined") {
  window.pullRateTester = {
    testPullRates,
    testAllPullRates,
    getPackRaritySummary,
    compareActualToExpected,
    logUniqueRarities,
    printHardcodedRateTable,
    validateHardcodedPullRates,
  };
  window.testPullRates = testPullRates;
  window.testAllPullRates = testAllPullRates;
  window.printHardcodedRateTable = printHardcodedRateTable;
  window.validateHardcodedPullRates = validateHardcodedPullRates;
}
