import { createServer } from "vite";

const DEFAULT_PACKS = 10000;
const DEEP_PACKS = 100000;
const GOD_PACK_SET_IDS = new Set(["151", "prismatic-evolutions", "black-bolt", "white-flare", "ascended-heroes"]);
const MODERN_SV_ART_CATEGORIES = new Set(["illustrationRare", "specialIllustrationRare"]);
const NORMAL_SLOT_CATEGORIES = new Set(["common", "uncommon", "rare"]);
const FINAL_SLOT_CATEGORIES = new Set([
  "rare",
  "holoRare",
  "gx",
  "pokemonV",
  "vmaxOrVstar",
  "doubleRare",
  "megaDoubleRare",
  "ultraRare",
  "fullArt",
  "illustrationRare",
  "specialIllustrationRare",
  "rainbowRare",
  "secretRare",
  "hyperRare",
  "alternateArt",
  "blackWhiteRare",
  "victiniRare",
  "megaHyperRare",
  "megaAttackRare",
]);
const HIT_CATEGORIES = new Set(
  [...FINAL_SLOT_CATEGORIES, "breakRare", "radiantRare", "aceSpecRare", "trainerGallery", "galarianGallery", "classicCollection", "shinyRare", "shinyUltraRare"].filter(
    (category) => !["rare", "holoRare"].includes(category)
  )
);

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
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key}: ${formatPercent(count, total)}`)
    .join(", ");
}

function categoryOf(card, set, api) {
  return card?.pullCategory || api.getRarityCategory(card, set);
}

function getExpectedPackSize(set, api) {
  const profile = api.getPullRateProfile(set);

  return profile.packSize || ([...["detective-pikachu", "celebrations"]].includes(api.getNormalizedSetId(set)) ? 4 : 10);
}

function isModernSvArtSlotCard(card, set, api) {
  return api.isModernSVSet(set) && MODERN_SV_ART_CATEGORIES.has(categoryOf(card, set, api));
}

function isFinalSlotCard(card, set, api) {
  const category = categoryOf(card, set, api);

  return FINAL_SLOT_CATEGORIES.has(category) && !isModernSvArtSlotCard(card, set, api);
}

function isNormalSlotCard(card, set, api) {
  return NORMAL_SLOT_CATEGORIES.has(categoryOf(card, set, api));
}

function isSubsetOrSpecialSlotCard(card, set, api) {
  return isNormalSlotCard(card, set, api) || api.isSubsetCard(card, set) || isModernSvArtSlotCard(card, set, api);
}

function isValidSlot(card, set, index, api) {
  const profileName = set.pullRateProfile || "";

  if (profileName === "xyKalosStarter") return categoryOf(card, set, api) === "common";

  if (profileName === "xyDoubleCrisis") {
    if (index <= 2) return categoryOf(card, set, api) === "common";
    if (index <= 4) return categoryOf(card, set, api) === "uncommon";
    if (index === 5) return isNormalSlotCard(card, set, api);
    if (index === 6) return isFinalSlotCard(card, set, api);

    return true;
  }

  if (profileName === "xyGenerations") {
    if (index <= 3) return categoryOf(card, set, api) === "common";
    if (index <= 5) return categoryOf(card, set, api) === "uncommon";
    if (index === 6) return isNormalSlotCard(card, set, api);
    if (index === 7) return isFinalSlotCard(card, set, api);
    return api.isSubsetCard(card, set);
  }

  if (api.isXYSet(set)) {
    if (index <= 4) return categoryOf(card, set, api) === "common";
    if (index <= 7) {
      return categoryOf(card, set, api) === "uncommon" || (profileName === "xyEvolutions" && categoryOf(card, set, api) === "secretRare");
    }
    if (index === 8) return isNormalSlotCard(card, set, api) || (api.isXYBreakSet(set) && api.isBreakCard(card));
    if (index === 9) return isFinalSlotCard(card, set, api);

    return true;
  }

  if (getExpectedPackSize(set, api) === 4) {
    if (index <= 1) return isNormalSlotCard(card, set, api);
    if (index === 2) return api.getNormalizedSetId(set) === "celebrations" ? isSubsetOrSpecialSlotCard(card, set, api) : isNormalSlotCard(card, set, api);
    if (index === 3) return isFinalSlotCard(card, set, api);

    return true;
  }

  if (index <= 3) return categoryOf(card, set, api) === "common";
  if (index <= 6) return categoryOf(card, set, api) === "uncommon";
  if (index === 7) return isNormalSlotCard(card, set, api);
  if (index === 8) return isSubsetOrSpecialSlotCard(card, set, api);
  if (index === 9) return isFinalSlotCard(card, set, api) || (!api.isModernSVSet(set) && FINAL_SLOT_CATEGORIES.has(categoryOf(card, set, api)));

  return true;
}

function getSlotValidationError(card, set, index, api) {
  const category = categoryOf(card, set, api);
  const displaySlot = index + 1;

  if (api.isModernSVSet(set) && MODERN_SV_ART_CATEGORIES.has(category) && index !== 8) {
    return `FAIL: ${set.name} produced ${category} in slot ${displaySlot}. Expected slot 9 only.`;
  }

  if (api.isModernSVSet(set) && index === 9 && MODERN_SV_ART_CATEGORIES.has(category)) {
    return `FAIL: ${set.name} produced ${category} in final slot 10. Expected slot 9 only.`;
  }

  if (!isValidSlot(card, set, index, api)) {
    return `FAIL: ${set.name} produced ${category} in slot ${displaySlot}.`;
  }

  return "";
}

function expectedRangeFor(set, bucket) {
  const id = set.id;
  const era = set.era || "";
  const subsetHeavySetIds = new Set(["hidden-fates", "shining-fates", "crown-zenith", "crown-zentih", "celebrations", "g1"]);
  const specialStructureSetIds = new Set(["detective-pikachu", "dc1", "xy0", "g1", "shining-legends", "dragon-majesty", "champions-path", "pokemon-go"]);

  if (bucket === "subset") {
    if (id === "hidden-fates") return [25, 34];
    if (id === "shining-fates") return [24, 33];
    if (id === "crown-zenith") return [19, 28];
    if (id === "celebrations") return [25, 35];
    if (id === "g1") return null;
    return [0, 45];
  }

  if (specialStructureSetIds.has(id)) return null;
  if (subsetHeavySetIds.has(id)) return null;

  if (era === "Sun & Moon") {
    if (bucket === "rare") return [50, 75];
    if (bucket === "doubleRare") return [10, 35];
    if (bucket === "ultraRare") return [1, 18];
    if (bucket === "secretRare") return [0.5, 10];
  }

  if (era === "Sword & Shield") {
    if (bucket === "rare") return [50, 75];
    if (bucket === "doubleRare") return [10, 35];
    if (bucket === "ultraRare") return [1, 18];
    if (bucket === "secretRare") return [0.5, 10];
  }

  if (era === "Scarlet & Violet") {
    if (bucket === "rare") return [55, 78];
    if (bucket === "doubleRare") return [10, 30];
    if (bucket === "ultraRare") return [1, 15];
    if (bucket === "illustrationRare") return [3, 14];
    if (bucket === "specialIllustrationRare") return [0.5, 6];
  }

  return null;
}

function addRangeWarning(warnings, label, count, total, set, bucket) {
  const range = expectedRangeFor(set, bucket);

  if (!range || total < 1000 || count <= 0) return;

  const actual = (count / total) * 100;
  const [min, max] = range;

  if (actual < min || actual > max) {
    warnings.push(`${label} ${actual.toFixed(2)}% outside target ${min}-${max}%.`);
  }
}

function validatePools(set, api, warnings) {
  if (set.pullRateProfile === "xyKalosStarter") return api.getPackPools(set);

  const pools = api.getPackPools(set);
  const rarityCounts = new Map();

  for (const card of set.cards || []) {
    increment(rarityCounts, api.getRarityCategory(card, set));
  }

  if (set.cards?.length && pools.finalSlotPool.length === 0) warnings.push("Set has cards but no possible final-slot hit.");
  if (set.cards?.length && !rarityCounts.has("common") && getExpectedPackSize(set, api) !== 4) warnings.push("Set has no mapped common cards.");
  if (set.cards?.length && !rarityCounts.has("uncommon") && getExpectedPackSize(set, api) !== 4) warnings.push("Set has no mapped uncommon cards.");
  if (rarityCounts.has("other")) warnings.push(`${rarityCounts.get("other")} cards have unmapped/unknown rarity.`);

  return pools;
}

async function main() {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });

  try {
    const { sets } = await server.ssrLoadModule("/src/data/sets.js");
    const api = await server.ssrLoadModule("/src/utils/packGenerator.js");
    const isDeep = hasArg("deep");
    const packCount = Number(getArgValue("packs") || (isDeep ? DEEP_PACKS : DEFAULT_PACKS));
    const setFilter = getArgValue("sets")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const selectedSets = setFilter.length > 0 ? sets.filter((set) => setFilter.includes(set.id)) : sets;
    const failures = [];

    console.log(`PackDex Pack Rate Validation`);
    console.log(`Sets tested: ${selectedSets.length}`);
    console.log(`Packs per set: ${packCount.toLocaleString()}`);
    console.log("");

    for (const set of selectedSets) {
      const warnings = [];
      const finalCounts = new Map();
      const slotCounts = new Map();
      const subsetCounts = new Map();
      const godPackCounts = new Map();
      const invalidSlotExamples = [];
      let invalidSlotCount = 0;
      let wrongPackSizeCount = 0;
      let totalHits = 0;
      let anyHitPacks = 0;
      let normalPacks = 0;

      validatePools(set, api, warnings);

      for (let index = 0; index < packCount; index += 1) {
        const pack = api.generatePack(set);

        if (pack?.isGodPack) {
          increment(godPackCounts, pack.godPackFormat || pack.godPackDisplayName || "godPack");
          if (!GOD_PACK_SET_IDS.has(set.id)) warnings.push("God Pack triggered in non-god-pack set.");
          continue;
        }

        normalPacks += 1;

        const expectedPackSize = getExpectedPackSize(set, api);
        if (pack.length !== expectedPackSize) wrongPackSizeCount += 1;

        let packHitCount = 0;

        pack.forEach((card, slotIndex) => {
          const category = categoryOf(card, set, api);

          increment(slotCounts, `${slotIndex}:${category}`);

          const slotError = getSlotValidationError(card, set, slotIndex, api);

          if (slotError) {
            invalidSlotCount += 1;
            if (invalidSlotExamples.length < 5) {
              invalidSlotExamples.push(`${slotError} Card: ${card.name}`);
            }
          }

          if (slotIndex === pack.length - 1) increment(finalCounts, category);
          if (api.isSubsetCard(card, set) || isModernSvArtSlotCard(card, set, api) || (api.isXYBreakSet(set) && api.isBreakCard(card))) {
            if (slotIndex !== pack.length - 1) increment(subsetCounts, category);
          }

          if (HIT_CATEGORIES.has(category)) packHitCount += 1;
        });

        totalHits += packHitCount;
        if (packHitCount > 0) anyHitPacks += 1;
      }

      const sampleTotal = Math.max(normalPacks, 1);
      const rareCount = (finalCounts.get("rare") || 0) + (finalCounts.get("holoRare") || 0);
      const doubleRareCount =
        (finalCounts.get("doubleRare") || 0) +
        (finalCounts.get("gx") || 0) +
        (finalCounts.get("pokemonV") || 0) +
        (finalCounts.get("megaDoubleRare") || 0);
      const ultraRareCount =
        (finalCounts.get("ultraRare") || 0) +
        (finalCounts.get("fullArt") || 0) +
        (finalCounts.get("rainbowRare") || 0) +
        (finalCounts.get("hyperRare") || 0) +
        (finalCounts.get("megaHyperRare") || 0);
      const secretRareCount =
        (finalCounts.get("secretRare") || 0) +
        (finalCounts.get("alternateArt") || 0) +
        (finalCounts.get("blackWhiteRare") || 0) +
        (finalCounts.get("victiniRare") || 0);
      const subsetTotal = [...subsetCounts.values()].reduce((sum, value) => sum + value, 0);
      const godPackTotal = [...godPackCounts.values()].reduce((sum, value) => sum + value, 0);

      addRangeWarning(warnings, "Rare final-slot rate", rareCount, sampleTotal, set, "rare");
      addRangeWarning(warnings, "Double Rare final-slot rate", doubleRareCount, sampleTotal, set, "doubleRare");
      addRangeWarning(warnings, "Ultra/high final-slot rate", ultraRareCount, sampleTotal, set, "ultraRare");
      addRangeWarning(warnings, "Secret/chase final-slot rate", secretRareCount, sampleTotal, set, "secretRare");
      addRangeWarning(warnings, "Illustration Rare special-slot rate", subsetCounts.get("illustrationRare") || 0, sampleTotal, set, "illustrationRare");
      addRangeWarning(warnings, "Special Illustration Rare special-slot rate", subsetCounts.get("specialIllustrationRare") || 0, sampleTotal, set, "specialIllustrationRare");
      addRangeWarning(warnings, "Subset hit rate", subsetTotal, sampleTotal, set, "subset");

      if (wrongPackSizeCount > 0) warnings.push(`${wrongPackSizeCount} packs had the wrong pack size.`);
      if (invalidSlotCount > 0) warnings.push(`${invalidSlotCount} cards appeared in impossible slots: ${invalidSlotExamples.join("; ")}`);
      if (anyHitPacks === 0 && sampleTotal >= 1000) warnings.push("No hits appeared.");
      if (sampleTotal >= 1000 && set.pullRateProfile !== "xyGenerations" && anyHitPacks / sampleTotal > 0.45) {
        warnings.push(`Any-hit rate ${formatPercent(anyHitPacks, sampleTotal)} looks too high.`);
      }
      if (GOD_PACK_SET_IDS.has(set.id) && godPackTotal === 0 && packCount >= 10000) warnings.push("God Pack eligible set had no God Packs; this can happen rarely but should be watched.");

      const status = warnings.length > 0 ? "FAIL" : "OK";
      const row = {
        set: set.name,
        id: set.id,
        packs: sampleTotal,
        status,
        anyHit: formatPercent(anyHitPacks, sampleTotal),
        avgHits: (totalHits / sampleTotal).toFixed(3),
        finalSlot: mapToText(finalCounts, sampleTotal),
        specialSlot: mapToText(subsetCounts, sampleTotal),
        godPacks: godPackTotal > 0 ? `${godPackTotal} (${formatPercent(godPackTotal, packCount)})` : "none",
        warnings,
      };

      if (warnings.length > 0) failures.push(row);

      console.log(`Set: ${row.set} (${row.id})`);
      console.log(`  Packs simulated: ${row.packs.toLocaleString()}`);
      console.log(`  Any-hit rate: ${row.anyHit}`);
      console.log(`  Average hits per pack: ${row.avgHits}`);
      console.log(`  Final-slot distribution: ${row.finalSlot}`);
      console.log(`  Special/subset slot: ${row.specialSlot}`);
      console.log(`  God packs: ${row.godPacks}`);
      console.log(`  Validation: ${status}`);
      if (warnings.length > 0) {
        for (const warning of warnings) console.log(`  - ${warning}`);
      }
      console.log("");
    }

    if (failures.length > 0) {
      console.log("FAILED SETS");
      for (const failure of failures) {
        console.log(`- ${failure.set} (${failure.id}): ${failure.warnings.join(" | ")}`);
      }
      process.exitCode = 1;
    } else {
      console.log("All tested sets passed pack slot and rate validation.");
    }
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
