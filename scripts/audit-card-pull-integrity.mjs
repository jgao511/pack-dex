import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { activeSets, getSetCardById, isRetiredSet, sets } from "../src/data/sets.js";
import { getVintagePackRule } from "../src/data/vintagePackRules.js";
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";
import {
  getCollectionVisibleCards,
  getPullableCollectionCards,
  resolveSavedCollectionCard,
} from "../src/utils/collectionStorage.js";
import {
  buildXYFinalRareBuckets,
  canGeneratePack,
  generateForcedGodPack,
  generateNormalPackOnly,
  getFinalSlotCategoryDiagnostics,
  getMegaRareSlotWeights,
  getMegaSecondFoilSlotWeights,
  getModernSVSecondFoilSlotWeights,
  getNormalizedSetId,
  getPackPools,
  getPullRateProfile,
  getRarityCategory,
  getSubsetSlotWeight,
  getSubsetType,
  GOD_PACK_CONFIG,
  isBreakCard,
  isIllustrationRare,
  isMegaAttackRare,
  isMegaSet,
  isModernSVSet,
  isSpecialIllustrationRare,
  isXYBreakSet,
  isXYSet,
  normalizeRarity,
} from "../src/utils/packGenerator.js";

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(MODULE_PATH), "..");
const AUDIT_DIR = path.join(ROOT_DIR, "audits", "card-integrity");
const REGISTRY_PATH = path.join(AUDIT_DIR, "authoritative-set-registry.json");
const MANIFEST_PATH = path.join(AUDIT_DIR, "official-card-manifest.json");
const QUARANTINE_PATH = path.join(ROOT_DIR, "src", "data", "legacyCardQuarantine.json");
const PRICE_CATALOG_PATH = path.join(ROOT_DIR, "supabase", "functions", "sync-card-prices", "catalog.json");
const DEFAULT_OUTPUT_PATH = path.join(AUDIT_DIR, "per-set-validation.json");
const DEFAULT_PACKS_PER_SET = 100;
const DEFAULT_SEED = "packdex-card-integrity-v1";

const MINI_PACK_SET_IDS = new Set(["detective-pikachu", "celebrations"]);
const MODERN_SV_SECOND_FOIL_CATEGORIES = new Set([
  "illustrationRare",
  "specialIllustrationRare",
  "hyperRare",
]);
const MEGA_SECOND_FOIL_CATEGORIES = new Set([
  "illustrationRare",
  "specialIllustrationRare",
  "megaHyperRare",
]);

const GOD_PACK_TARGETS = Object.freeze({
  "151_THREE_CARD_EVOLUTION_LINE": [
    ["Bulbasaur", "Illustration Rare"],
    ["Ivysaur", "Illustration Rare"],
    ["Venusaur ex", "Special Illustration Rare"],
    ["Charmander", "Illustration Rare"],
    ["Charmeleon", "Illustration Rare"],
    ["Charizard ex", "Special Illustration Rare"],
    ["Squirtle", "Illustration Rare"],
    ["Wartortle", "Illustration Rare"],
    ["Blastoise ex", "Special Illustration Rare"],
  ],
  PRISMATIC_FULL_EEVEELUTION_PACK: [
    ["Eevee", "Common"],
    ["Umbreon ex", "Special Illustration Rare"],
    ["Sylveon ex", "Special Illustration Rare"],
    ["Leafeon ex", "Special Illustration Rare"],
    ["Glaceon ex", "Special Illustration Rare"],
    ["Vaporeon ex", "Special Illustration Rare"],
    ["Jolteon ex", "Special Illustration Rare"],
    ["Flareon ex", "Special Illustration Rare"],
    ["Espeon ex", "Special Illustration Rare"],
    ["Eevee ex", "Special Illustration Rare"],
  ],
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, contents);
  fs.renameSync(temporaryPath, filePath);
}

function parseArguments(argv) {
  const options = {
    check: argv.includes("--check"),
    packsPerSet: DEFAULT_PACKS_PER_SET,
    seed: DEFAULT_SEED,
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (const argument of argv) {
    if (argument.startsWith("--packs-per-set=")) {
      options.packsPerSet = Number.parseInt(argument.slice("--packs-per-set=".length), 10);
    } else if (argument.startsWith("--packs=")) {
      options.packsPerSet = Number.parseInt(argument.slice("--packs=".length), 10);
    } else if (argument.startsWith("--seed=")) {
      options.seed = argument.slice("--seed=".length);
    } else if (argument.startsWith("--output=")) {
      options.outputPath = path.resolve(ROOT_DIR, argument.slice("--output=".length));
    }
  }

  if (!Number.isInteger(options.packsPerSet) || options.packsPerSet <= 0) {
    throw new Error("--packs-per-set must be a positive integer.");
  }
  if (!options.seed) throw new Error("--seed must not be empty.");

  return options;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(initialSeed) {
  let state = initialSeed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function withSeededRandom(seed, callback) {
  const originalRandom = Math.random;
  Math.random = mulberry32(hashSeed(seed));
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function cardTargetMatches(card, [name, rarity]) {
  return card.name === name && normalizeRarity(card.rarity) === normalizeRarity(rarity);
}

function isRadiantCollectionCard(card) {
  return (
    String(card.number || "").toLowerCase().startsWith("rc") ||
    String(card.subset || card.collection || "").toLowerCase().includes("radiant collection")
  );
}

function addRoute(routeSets, routeName, cards) {
  const values = routeSets.get(routeName) || new Set();
  for (const card of cards || []) values.add(String(card.id));
  if (values.size > 0) routeSets.set(routeName, values);
}

function addFinalRoutes(routeSets, pools, set, prefix) {
  const diagnostics = getFinalSlotCategoryDiagnostics(pools.finalSlotPool, set);
  const secondFoilCategories = isMegaSet(set)
    ? MEGA_SECOND_FOIL_CATEGORIES
    : isModernSVSet(set)
      ? MODERN_SV_SECOND_FOIL_CATEGORIES
      : new Set();
  for (const category of Object.keys(diagnostics.activeWeights).sort()) {
    if (secondFoilCategories.has(category)) continue;
    addRoute(routeSets, `${prefix}.${category}`, diagnostics.cardsByCategory[category]);
  }
  return diagnostics;
}

function addGodPackRoutes(routeSets, pools, set) {
  const setId = getNormalizedSetId(set);
  const config = GOD_PACK_CONFIG[setId];
  if (!config?.enabled) return [];

  const formats = config.formats?.map((entry) => entry.format) || [config.format];
  for (const format of formats) {
    if (GOD_PACK_TARGETS[format]) {
      addRoute(
        routeSets,
        `god.${format}`,
        pools.cleanCards.filter((card) => GOD_PACK_TARGETS[format].some((target) => cardTargetMatches(card, target)))
      );
    } else if (format === "PRISMATIC_DEMI_GOD_PACK") {
      addRoute(routeSets, `god.${format}`, pools.cleanCards.filter(isSpecialIllustrationRare));
    } else if (format === "BLACK_BOLT_9_IR_1_SIR" || format === "WHITE_FLARE_9_IR_1_SIR") {
      addRoute(
        routeSets,
        `god.${format}`,
        pools.cleanCards.filter((card) => isIllustrationRare(card) || isSpecialIllustrationRare(card))
      );
    } else if (format === "ASCENDED_HEROES_3_MAR_7_SIR") {
      addRoute(
        routeSets,
        `god.${format}`,
        pools.cleanCards.filter((card) => isMegaAttackRare(card) || isSpecialIllustrationRare(card))
      );
    }
  }

  return formats;
}

function classifyPositivePullRoutes(set) {
  const pools = getPackPools(set);
  const profile = getPullRateProfile(set);
  const vintageRule = getVintagePackRule(set);
  const routeSets = new Map();

  if (vintageRule) {
    addRoute(routeSets, "vintage.common", pools.commonPool);
    addRoute(routeSets, "vintage.uncommon", pools.uncommonPool);
    addRoute(routeSets, "vintage.reverse", pools.reverseSlotPool);

    const nonHoloRare = pools.finalSlotPool.filter((card) => getRarityCategory(card, set) === "rare");
    const holoOrChase = pools.finalSlotPool.filter((card) =>
      ["holoRare", "ultraRare", "secretRare"].includes(getRarityCategory(card, set))
    );
    addRoute(routeSets, "vintage.final.nonHoloRare", nonHoloRare);
    if ((vintageRule.holoChance || 0) > 0) {
      addRoute(routeSets, "vintage.final.holoOrChase", holoOrChase);
    }

    if ((vintageRule.basicEnergySlots || 0) > 0) {
      const forcedNames = new Set(vintageRule.basicEnergyFileNames || []);
      addRoute(
        routeSets,
        "vintage.forcedBasicEnergy",
        pools.cleanCards.filter((card) =>
          forcedNames.has(card.fileName || card.imageFileName || card.filename)
        )
      );
    }
    if ((vintageRule.radiantCollectionSlots || 0) > 0) {
      addRoute(routeSets, "vintage.radiantCollection", pools.subsetPool);
    }
    if (vintageRule.type === "dragonVault") {
      addRoute(routeSets, "vintage.dragonVault.regular", pools.cleanCards);
      addRoute(routeSets, "vintage.final.dragonVault", pools.finalSlotPool);
    }
  } else if (isXYSet(set)) {
    addRoute(routeSets, "xy.common", pools.commonPool);

    if (set.pullRateProfile !== "xyKalosStarter") {
      addRoute(routeSets, "xy.uncommon", pools.uncommonPool);
      addRoute(routeSets, "xy.reverse", pools.reverseSlotPool);
      addFinalRoutes(routeSets, pools, set, "xy.final");

      const reverseConfig = profile.preRareSlot || profile.reverseOrBreakSlot || profile.reverseSlot || {};
      if (isXYBreakSet(set) && (reverseConfig.breakCard || 0) > 0) {
        addRoute(routeSets, "xy.reverse.break", pools.cleanCards.filter(isBreakCard));
      }
      if (set.pullRateProfile === "xyEvolutions" && (profile.uncommonSecretRate || 0) > 0) {
        addRoute(
          routeSets,
          "xy.evolutions.secretUncommon",
          buildXYFinalRareBuckets(pools, set).secretRare
        );
      }
      if (set.pullRateProfile === "xyGenerations") {
        addRoute(
          routeSets,
          "xy.generations.radiantCollection",
          pools.cleanCards.filter(isRadiantCollectionCard)
        );
      }
    }
  } else {
    addRoute(routeSets, "normal.common", pools.commonPool);
    addRoute(routeSets, "normal.uncommon", pools.uncommonPool);
    addRoute(routeSets, "normal.reverse", pools.reverseSlotPool);

    const subsetCards = pools.subsetPool.filter((card) => getSubsetSlotWeight(card, set) > 0);
    for (const subsetType of [...new Set(subsetCards.map((card) => getSubsetType(card, set) || "configured"))].sort()) {
      addRoute(
        routeSets,
        `normal.subset.${subsetType}`,
        subsetCards.filter((card) => (getSubsetType(card, set) || "configured") === subsetType)
      );
    }

    addFinalRoutes(routeSets, pools, set, "normal.final");
    if (isModernSVSet(set)) {
      const secondFoilWeights = getModernSVSecondFoilSlotWeights(set);
      for (const category of [...MODERN_SV_SECOND_FOIL_CATEGORIES].sort()) {
        if ((secondFoilWeights[category] || 0) > 0) {
          addRoute(
            routeSets,
            `modern.preRare.${category}`,
            pools.finalSlotPool.filter((card) => getRarityCategory(card, set) === category)
          );
        }
      }
    }

    if (isMegaSet(set)) {
      const secondFoilWeights = getMegaSecondFoilSlotWeights(set);
      for (const category of [...MEGA_SECOND_FOIL_CATEGORIES].sort()) {
        if ((secondFoilWeights[category] || 0) > 0) {
          addRoute(
            routeSets,
            `mega.secondFoil.${category}`,
            pools.finalSlotPool.filter((card) => getRarityCategory(card, set) === category)
          );
        }
      }

      const rareWeights = getMegaRareSlotWeights(set);
      for (const [category, weight] of Object.entries(rareWeights).sort(([left], [right]) => left.localeCompare(right))) {
        if (weight > 0) {
          addRoute(
            routeSets,
            `mega.rare.${category}`,
            pools.finalSlotPool.filter((card) => getRarityCategory(card, set) === category)
          );
        }
      }
    }
  }

  const godPackFormats = addGodPackRoutes(routeSets, pools, set);
  const cardRoutes = new Map();
  for (const [routeName, cardIds] of routeSets) {
    for (const cardId of cardIds) {
      const routes = cardRoutes.get(cardId) || new Set();
      routes.add(routeName);
      cardRoutes.set(cardId, routes);
    }
  }

  return {
    cardRoutes,
    godPackFormats,
    pools,
    routeCounts: Object.fromEntries(
      [...routeSets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([routeName, cardIds]) => [routeName, cardIds.size])
    ),
  };
}

function hasAnyRoute(cardRoutes, cardId, routes) {
  const actualRoutes = cardRoutes.get(String(cardId)) || new Set();
  return routes.some((route) =>
    route.endsWith(".*")
      ? [...actualRoutes].some((actualRoute) => actualRoute.startsWith(route.slice(0, -1)))
      : actualRoutes.has(route)
  );
}

function expectedNormalSlotRoutes(set, index, vintageRule, profile) {
  if (vintageRule) {
    if (vintageRule.type === "dragonVault") {
      return index < (vintageRule.regularSlots || 4)
        ? ["vintage.dragonVault.regular"]
        : ["vintage.final.*"];
    }

    let boundary = vintageRule.commonSlots || 0;
    if (index < boundary) return ["vintage.common"];
    boundary += vintageRule.basicEnergySlots || 0;
    if (index < boundary) return ["vintage.forcedBasicEnergy"];
    boundary += vintageRule.uncommonSlots || 0;
    if (index < boundary) return ["vintage.uncommon"];
    boundary += vintageRule.reverseSlots || 0;
    if (index < boundary) return ["vintage.reverse"];
    boundary += vintageRule.radiantCollectionSlots || 0;
    if (index < boundary) return ["vintage.radiantCollection"];
    return ["vintage.final.*"];
  }

  if (isXYSet(set)) {
    if (set.pullRateProfile === "xyKalosStarter") return ["xy.common"];
    if (set.pullRateProfile === "xyGenerations") {
      if (index < profile.coreSlots.commonSlots) return ["xy.common"];
      if (index < profile.coreSlots.commonSlots + profile.coreSlots.uncommonSlots) return ["xy.uncommon"];
      if (index === profile.coreSlots.commonSlots + profile.coreSlots.uncommonSlots) return ["xy.reverse"];
      if (index === profile.coreCards - 1) return ["xy.final.*"];
      return ["xy.generations.radiantCollection"];
    }

    const commonSlots = profile.commonSlots || 5;
    const uncommonSlots = profile.uncommonSlots || 3;
    if (index < commonSlots) return ["xy.common"];
    if (index < commonSlots + uncommonSlots) {
      return set.pullRateProfile === "xyEvolutions"
        ? ["xy.uncommon", "xy.evolutions.secretUncommon"]
        : ["xy.uncommon"];
    }
    if (index === commonSlots + uncommonSlots) return ["xy.reverse", "xy.reverse.break"];
    return ["xy.final.*"];
  }

  const packSize = profile.packSize || (MINI_PACK_SET_IDS.has(set.id) ? 4 : 10);
  const usesDedicatedSecondFoil = isModernSVSet(set) || isMegaSet(set);
  if (packSize === 4) {
    if (index < 2) return ["normal.reverse"];
    if (index === 2) return ["normal.reverse", "normal.subset.*"];
    return ["normal.final.*", "mega.rare.*"];
  }
  if (index < 4) return ["normal.common"];
  if (index < 7) return ["normal.uncommon"];
  if (index === 7) {
    return usesDedicatedSecondFoil
      ? ["normal.reverse", "normal.subset.*"]
      : ["normal.reverse"];
  }
  if (index === 8) {
    return usesDedicatedSecondFoil
      ? ["normal.reverse", "modern.preRare.*", "mega.secondFoil.*"]
      : ["normal.reverse", "normal.subset.*"];
  }
  return ["normal.final.*", "mega.rare.*"];
}

function validateForcedGodPack(set, format, pack, cardRoutes, reportFailure) {
  const routeName = `god.${format}`;
  let routedCards = pack;
  if (format === "151_THREE_CARD_EVOLUTION_LINE" || format === "PRISMATIC_DEMI_GOD_PACK") {
    routedCards = pack.slice(-3);
  }

  for (const card of routedCards) {
    if (!hasAnyRoute(cardRoutes, card.id, [routeName])) {
      reportFailure("simulationSlotFailures", `${set.id}/${format} emitted ${card.id} outside ${routeName}.`);
    }
  }

  const categories = pack.map((card) => getRarityCategory(card, set));
  if (format === "BLACK_BOLT_9_IR_1_SIR" || format === "WHITE_FLARE_9_IR_1_SIR") {
    const irCount = categories.filter((category) => category === "illustrationRare").length;
    const sirCount = categories.filter((category) => category === "specialIllustrationRare").length;
    if (irCount !== 9 || sirCount !== 1) {
      reportFailure("simulationSlotFailures", `${set.id}/${format} produced ${irCount} IR and ${sirCount} SIR.`);
    }
  } else if (format === "ASCENDED_HEROES_3_MAR_7_SIR") {
    const marCount = categories.filter((category) => category === "megaAttackRare").length;
    const sirCount = categories.filter((category) => category === "specialIllustrationRare").length;
    if (marCount !== 3 || sirCount !== 7) {
      reportFailure("simulationSlotFailures", `${set.id}/${format} produced ${marCount} MAR and ${sirCount} SIR.`);
    }
  }
}

function simulateSet(set, classification, packsPerSet, seed, expectedPackSize, reportFailure, onNormalPack) {
  const canonicalIds = new Set(set.cards.map((card) => String(card.id)));
  const observedIds = new Set();
  const vintageRule = getVintagePackRule(set);
  const profile = getPullRateProfile(set);
  let generatedCardCount = 0;
  let forcedGodPackCount = 0;

  withSeededRandom(`${seed}:${set.id}:normal`, () => {
    for (let packIndex = 0; packIndex < packsPerSet; packIndex += 1) {
      const pack = generateNormalPackOnly(set);
      onNormalPack?.(set, pack, packIndex);
      if (pack.length !== expectedPackSize) {
        reportFailure(
          "simulationPackLengthFailures",
          `${set.id} simulation pack ${packIndex} has ${pack.length} cards; expected ${expectedPackSize}.`
        );
      }

      const seenInPack = new Set();
      for (const [slotIndex, card] of pack.entries()) {
        const cardId = String(card.id);
        generatedCardCount += 1;
        observedIds.add(cardId);
        if (!canonicalIds.has(cardId)) {
          reportFailure("simulationForeignIds", `${set.id} simulation emitted foreign ID ${cardId}.`);
        }
        if (seenInPack.has(cardId)) {
          reportFailure("simulationDuplicateIds", `${set.id} simulation pack ${packIndex} repeated ${cardId}.`);
        }
        seenInPack.add(cardId);

        const expectedRoutes = expectedNormalSlotRoutes(set, slotIndex, vintageRule, profile);
        if (!hasAnyRoute(classification.cardRoutes, cardId, expectedRoutes)) {
          reportFailure(
            "simulationSlotFailures",
            `${set.id} simulation placed ${cardId} in slot ${slotIndex + 1}; expected ${expectedRoutes.join(" or ")}.`
          );
        }
      }
    }
  });

  for (const format of classification.godPackFormats) {
    withSeededRandom(`${seed}:${set.id}:god:${format}`, () => {
      const pack = generateForcedGodPack(set, undefined, format);
      forcedGodPackCount += 1;
      if (!pack.isGodPack || pack.godPackFormat !== format) {
        reportFailure("simulationSlotFailures", `${set.id} did not produce forced God-pack format ${format}.`);
      }
      if (pack.length !== expectedPackSize) {
        reportFailure(
          "simulationPackLengthFailures",
          `${set.id}/${format} has ${pack.length} cards; expected ${expectedPackSize}.`
        );
      }
      const ids = pack.map((card) => String(card.id));
      for (const cardId of ids) {
        if (!canonicalIds.has(cardId)) {
          reportFailure("simulationForeignIds", `${set.id}/${format} emitted foreign ID ${cardId}.`);
        }
      }
      if (new Set(ids).size !== ids.length) {
        reportFailure("simulationDuplicateIds", `${set.id}/${format} repeated a canonical card ID.`);
      }
      validateForcedGodPack(set, format, pack, classification.cardRoutes, reportFailure);
    });
  }

  return {
    packsGenerated: packsPerSet,
    forcedGodPacksValidated: forcedGodPackCount,
    cardsGenerated: generatedCardCount,
    observedUniqueCanonicalCards: observedIds.size,
  };
}

function findDuplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function compareIdSets(expected, actual) {
  return {
    missing: [...expected].filter((value) => !actual.has(value)).sort(),
    extra: [...actual].filter((value) => !expected.has(value)).sort(),
  };
}

export function buildAudit(options) {
  const registry = readJson(REGISTRY_PATH);
  const manifest = readJson(MANIFEST_PATH);
  const quarantine = readJson(QUARANTINE_PATH);
  const priceCatalog = readJson(PRICE_CATALOG_PATH);
  const scannerCatalog = buildScannerCatalog();
  const registryBySetId = new Map(registry.sets.map((set) => [set.id, set]));
  const manifestByCardId = new Map(manifest.cards.map((card) => [String(card.packDexCardId), card]));
  const scannerBySetId = new Map();
  const priceBySetId = new Map(priceCatalog.map((set) => [set.id, set]));
  const failureCounts = {
    foreignIds: 0,
    duplicateIds: 0,
    manifestMismatches: 0,
    scannerOmissions: 0,
    priceOmissions: 0,
    imageGaps: 0,
    rarityGaps: 0,
    pullRouteGaps: 0,
    countMismatches: 0,
    simulationForeignIds: 0,
    simulationDuplicateIds: 0,
    simulationSlotFailures: 0,
    simulationPackLengthFailures: 0,
    historicalLifecycleFailures: 0,
    historicalCountMismatches: 0,
    historicalDuplicateIds: 0,
    historicalFieldGaps: 0,
    historicalRuntimeResolutionFailures: 0,
    historicalCollectionFailures: 0,
    historicalCatalogLeakage: 0,
  };
  const failureMessages = [];
  const reportFailure = (category, message) => {
    failureCounts[category] += 1;
    if (failureMessages.length < 200) failureMessages.push(message);
  };

  for (const scannerCard of scannerCatalog) {
    const values = scannerBySetId.get(scannerCard.setId) || [];
    values.push(scannerCard);
    scannerBySetId.set(scannerCard.setId, values);
  }

  const duplicateGroups = [
    ["active runtime", activeSets.flatMap((set) => set.cards.map((card) => String(card.id)))],
    ["manifest", manifest.cards.map((card) => String(card.packDexCardId))],
    ["manifest source", manifest.cards.map((card) => String(card.sourceCardId))],
    ["scanner", scannerCatalog.map((card) => String(card.cardId))],
    ["price", priceCatalog.flatMap((set) => set.cards.map((card) => String(card.id)))],
  ];
  for (const [catalogName, values] of duplicateGroups) {
    for (const duplicate of findDuplicateValues(values)) {
      reportFailure("duplicateIds", `${catalogName} catalog repeats ${duplicate}.`);
    }
  }

  const setRows = [];
  const nonCollectibleCanonicalCards = [];
  let simulatedNormalPacks = 0;
  let simulatedForcedGodPacks = 0;
  let simulatedCards = 0;
  let simulatedObservedUniqueCards = 0;

  for (const set of activeSets) {
    const registrySet = registryBySetId.get(set.id);
    if (!registrySet) {
      reportFailure("countMismatches", `${set.id} is absent from the authoritative registry.`);
      continue;
    }

    const canonicalIds = new Set(set.cards.map((card) => String(card.id)));
    const manifestCards = manifest.cards.filter((card) => card.packDexSetId === set.id);
    const manifestIds = new Set(manifestCards.map((card) => String(card.packDexCardId)));
    const scannerCards = scannerBySetId.get(set.id) || [];
    const scannerIds = new Set(scannerCards.map((card) => String(card.cardId)));
    const priceSet = priceBySetId.get(set.id);
    const priceCards = priceSet?.cards || [];
    const priceIds = new Set(priceCards.map((card) => String(card.id)));
    const collectionCards = getPullableCollectionCards(set);
    const collectionIds = new Set(collectionCards.map((card) => String(card.id)));
    const classification = classifyPositivePullRoutes(set);
    const pullableIds = new Set(classification.cardRoutes.keys());
    const usesDedicatedRareSlot =
      !getVintagePackRule(set) && !isXYSet(set) && (isModernSVSet(set) || isMegaSet(set));
    if (usesDedicatedRareSlot) {
      const finalSlotDiagnostics = getFinalSlotCategoryDiagnostics(
        classification.pools.finalSlotPool,
        set
      );
      for (const category of finalSlotDiagnostics.profileWeightsWithoutCards) {
        reportFailure(
          "pullRouteGaps",
          `${set.id} has positive dedicated Rare-slot weight for ${category} but no eligible card pool.`
        );
      }

      const secondFoilWeights = isMegaSet(set)
        ? getMegaSecondFoilSlotWeights(set)
        : getModernSVSecondFoilSlotWeights(set);
      for (const [category, rawWeight] of Object.entries(secondFoilWeights)) {
        if (category === "normal" || (Number(rawWeight) || 0) <= 0) continue;
        const hasEligibleCard = classification.pools.finalSlotPool.some(
          (card) => getRarityCategory(card, set) === category
        );
        if (!hasEligibleCard) {
          reportFailure(
            "pullRouteGaps",
            `${set.id} has positive dedicated second-foil weight for ${category} but no eligible card pool.`
          );
        }
      }
    }

    const manifestDiff = compareIdSets(canonicalIds, manifestIds);
    for (const id of [...manifestDiff.missing, ...manifestDiff.extra]) {
      reportFailure("manifestMismatches", `${set.id} manifest identity mismatch for ${id}.`);
    }
    const scannerDiff = compareIdSets(canonicalIds, scannerIds);
    for (const id of [...scannerDiff.missing, ...scannerDiff.extra]) {
      reportFailure("scannerOmissions", `${set.id} scanner identity mismatch for ${id}.`);
    }
    const priceDiff = compareIdSets(canonicalIds, priceIds);
    for (const id of [...priceDiff.missing, ...priceDiff.extra]) {
      reportFailure("priceOmissions", `${set.id} price identity mismatch for ${id}.`);
    }
    const routeDiff = compareIdSets(collectionIds, pullableIds);
    for (const id of [...routeDiff.missing, ...routeDiff.extra]) {
      reportFailure("pullRouteGaps", `${set.id} pull-route/checklist mismatch for ${id}.`);
    }

    const allowedSourceSetIds = new Set(registrySet.allowedSourceSetIds || []);
    for (const card of set.cards) {
      const cardId = String(card.id);
      const manifestCard = manifestByCardId.get(cardId);
      if (!card.image || !String(card.image).trim()) reportFailure("imageGaps", `${set.id}/${cardId} has no image.`);
      if (!card.rarity || !String(card.rarity).trim()) reportFailure("rarityGaps", `${set.id}/${cardId} has no rarity.`);
      if (!manifestCard) continue;

      if (
        manifestCard.packDexSetId !== set.id ||
        manifestCard.canonicalName !== card.name ||
        String(manifestCard.number) !== String(card.number) ||
        manifestCard.localRarity !== card.rarity ||
        manifestCard.image !== card.image
      ) {
        reportFailure("manifestMismatches", `${set.id}/${cardId} differs from its pinned manifest fields.`);
      }
      if (!allowedSourceSetIds.has(manifestCard.sourceSetId)) {
        reportFailure(
          "foreignIds",
          `${set.id}/${cardId} maps to foreign source set ${manifestCard.sourceSetId}.`
        );
      }
    }

    for (const scannerCard of scannerCards) {
      const runtimeCard = set.cards.find((card) => String(card.id) === String(scannerCard.cardId));
      if (!runtimeCard || scannerCard.setId !== set.id || scannerCard.card !== runtimeCard) {
        reportFailure("foreignIds", `${set.id} scanner entry ${scannerCard.cardId} is foreign or detached.`);
      }
      if (runtimeCard && (scannerCard.imageUrl !== runtimeCard.image || scannerCard.rarity !== runtimeCard.rarity)) {
        reportFailure("scannerOmissions", `${set.id}/${scannerCard.cardId} scanner metadata is stale.`);
      }
    }

    const priceByCardId = new Map(priceCards.map((card) => [String(card.id), card]));
    for (const runtimeCard of set.cards) {
      const priceCard = priceByCardId.get(String(runtimeCard.id));
      const manifestCard = manifestByCardId.get(String(runtimeCard.id));
      if (!priceCard || !manifestCard) continue;
      if (
        priceCard.name !== runtimeCard.name ||
        String(priceCard.number) !== String(runtimeCard.number) ||
        priceCard.rarity !== runtimeCard.rarity ||
        priceCard.sourceSetId !== manifestCard.sourceSetId ||
        priceCard.sourceCardId !== manifestCard.sourceCardId
      ) {
        reportFailure("priceOmissions", `${set.id}/${runtimeCard.id} price metadata is stale.`);
      }
    }

    const expectedCounts = {
      authoritativeSource: registrySet.expectedCounts.source,
      canonicalRuntime: set.cards.length,
      authoritativeManifest: manifestCards.length,
      positivePackPool: pullableIds.size,
      collectionChecklist: collectionCards.length,
      scanner: scannerCards.length,
      price: priceCards.length,
    };
    for (const [countName, count] of Object.entries(expectedCounts)) {
      if (["positivePackPool", "collectionChecklist"].includes(countName)) continue;
      if (count !== set.cards.length) {
        reportFailure("countMismatches", `${set.id} ${countName} count ${count} != ${set.cards.length}.`);
      }
    }
    if (expectedCounts.positivePackPool !== expectedCounts.collectionChecklist) {
      reportFailure(
        "countMismatches",
        `${set.id} positive pack pool ${expectedCounts.positivePackPool} != checklist ${expectedCounts.collectionChecklist}.`
      );
    }
    if (!canGeneratePack(set)) {
      reportFailure("pullRouteGaps", `${set.id} cannot generate a complete normal pack.`);
    }

    const excludedIds = [...canonicalIds].filter((cardId) => !collectionIds.has(cardId)).sort();
    for (const cardId of excludedIds) {
      nonCollectibleCanonicalCards.push({
        setId: set.id,
        cardId,
        reason: "generic bonus Energy without a verified numbered checklist identity",
      });
    }

    const simulation = simulateSet(
      set,
      classification,
      options.packsPerSet,
      options.seed,
      registrySet.pack.size,
      reportFailure,
      options.onNormalPack
    );
    simulatedNormalPacks += simulation.packsGenerated;
    simulatedForcedGodPacks += simulation.forcedGodPacksValidated;
    simulatedCards += simulation.cardsGenerated;
    simulatedObservedUniqueCards += simulation.observedUniqueCanonicalCards;

    setRows.push({
      id: set.id,
      name: set.name,
      allowedSourceSetIds: [...allowedSourceSetIds].sort(),
      expectedPackSize: registrySet.pack.size,
      counts: expectedCounts,
      exclusions: {
        nonCollectibleCanonicalCount: excludedIds.length,
        nonCollectibleCanonicalIds: excludedIds,
        legacyResolvableCount: registrySet.expectedCounts.legacyResolvable,
      },
      positivePullRoutes: classification.routeCounts,
      checks: {
        sourceCountMatchesCanonical: expectedCounts.authoritativeSource === expectedCounts.canonicalRuntime,
        manifestMatchesCanonical: manifestDiff.missing.length === 0 && manifestDiff.extra.length === 0,
        packPoolMatchesCollectionChecklist:
          routeDiff.missing.length === 0 && routeDiff.extra.length === 0,
        scannerMatchesCanonical: scannerDiff.missing.length === 0 && scannerDiff.extra.length === 0,
        priceMatchesCanonical: priceDiff.missing.length === 0 && priceDiff.extra.length === 0,
        imageAndRarityComplete: set.cards.every(
          (card) => Boolean(String(card.image || "").trim()) && Boolean(String(card.rarity || "").trim())
        ),
        canGenerateNormalPack: canGeneratePack(set),
      },
      simulation,
    });
  }

  const retiredRegistrySets = registry.sets.filter((set) => set.lifecycle.status === "retired");
  const retiredRuntimeSets = sets.filter((set) => isRetiredSet(set));
  const runtimeBySetId = new Map(sets.map((set) => [set.id, set]));
  const activeSetIds = new Set(activeSets.map((set) => set.id));
  const runtimeIdOwners = new Map();
  for (const runtimeSet of sets) {
    for (const card of runtimeSet.cards || []) {
      const cardId = String(card.id || "");
      const owners = runtimeIdOwners.get(cardId) || [];
      owners.push(runtimeSet.id);
      runtimeIdOwners.set(cardId, owners);
    }
  }

  const retiredRegistryIds = new Set(retiredRegistrySets.map((set) => set.id));
  for (const runtimeSet of retiredRuntimeSets) {
    if (!retiredRegistryIds.has(runtimeSet.id)) {
      reportFailure(
        "historicalLifecycleFailures",
        `${runtimeSet.id} is retired at runtime but absent from the retired registry.`
      );
    }
  }

  const historicalSetRows = [];
  for (const registrySet of retiredRegistrySets) {
    const runtimeSet = runtimeBySetId.get(registrySet.id);
    const registryLifecycleIsHistoricalOnly =
      registrySet.lifecycle.historicallyResolvable === true &&
      registrySet.lifecycle.discoverable === false &&
      registrySet.lifecycle.openable === false;
    if (!registryLifecycleIsHistoricalOnly) {
      reportFailure(
        "historicalLifecycleFailures",
        `${registrySet.id} must be historically resolvable but neither discoverable nor openable.`
      );
    }
    if (!runtimeSet) {
      reportFailure(
        "historicalRuntimeResolutionFailures",
        `${registrySet.id} is retired and historically resolvable but absent from the full runtime set registry.`
      );
      historicalSetRows.push({
        id: registrySet.id,
        name: registrySet.displayName,
        classification: registrySet.classification,
        counts: {
          expectedRegistryCards: registrySet.expectedCounts.canonicalCatalog,
          runtimeCards: 0,
          collectionChecklistCards: 0,
          collectionVisibleCards: 0,
          activeManifestCards: 0,
          activeScannerCards: 0,
          activePriceCards: 0,
        },
        checks: {
          retiredAndHistoricallyResolvableButNotDiscoverableOrOpenable: false,
          excludedFromActiveRuntime: true,
          expectedRegistryCountMatchesRuntime: false,
          stableIdsUniqueAcrossRuntime: false,
          requiredFieldsComplete: false,
          everyCardRuntimeResolvable: false,
          everyCardCollectionVisibleAndResolvable: false,
          absentFromActiveManifestScannerAndPriceCatalogs: true,
        },
        reason:
          "Excluded from active catalogs and pack-opening audit; included in historical validation for runtime and saved-collection resolution.",
      });
      continue;
    }

    const canonicalIds = new Set(runtimeSet.cards.map((card) => String(card.id)));
    const duplicateIds = [...canonicalIds].filter(
      (cardId) => cardId.length === 0 || (runtimeIdOwners.get(cardId) || []).length !== 1
    );
    for (const cardId of duplicateIds) {
      reportFailure(
        "historicalDuplicateIds",
        `${runtimeSet.id} historical card ID ${cardId || "<empty>"} is not globally unique.`
      );
    }

    const fieldGapIds = [];
    const runtimeResolutionFailures = [];
    for (const card of runtimeSet.cards) {
      const cardId = String(card.id || "");
      if (
        !cardId ||
        !String(card.name || "").trim() ||
        !String(card.number || "").trim() ||
        !String(card.rarity || "").trim() ||
        !String(card.image || "").trim()
      ) {
        fieldGapIds.push(cardId || "<empty>");
        reportFailure(
          "historicalFieldGaps",
          `${runtimeSet.id}/${cardId || "<empty>"} lacks a stable ID, name, number, rarity, or image.`
        );
      }

      const resolved = getSetCardById(runtimeSet, cardId);
      if (resolved !== card || String(resolved?.id || "") !== cardId) {
        runtimeResolutionFailures.push(cardId || "<empty>");
        reportFailure(
          "historicalRuntimeResolutionFailures",
          `${runtimeSet.id}/${cardId || "<empty>"} does not resolve to its canonical runtime card.`
        );
      }
    }

    const savedCollection = {
      [runtimeSet.id]: Object.fromEntries(
        runtimeSet.cards.map((card) => [
          String(card.id),
          { count: 1, firstCollectedAt: 1, lastCollectedAt: 1 },
        ])
      ),
    };
    const collectionCards = getPullableCollectionCards(runtimeSet);
    const collectionVisibleCards = getCollectionVisibleCards(runtimeSet, savedCollection);
    const collectionVisibleIds = new Set(collectionVisibleCards.map((card) => String(card.id)));
    const collectionDiff = compareIdSets(canonicalIds, collectionVisibleIds);
    for (const cardId of [...collectionDiff.missing, ...collectionDiff.extra]) {
      reportFailure(
        "historicalCollectionFailures",
        `${runtimeSet.id} historical collection visibility differs for ${cardId}.`
      );
    }
    const collectionResolutionFailures = runtimeSet.cards.filter(
      (card) => resolveSavedCollectionCard(runtimeSet, card.id) !== card
    );
    for (const card of collectionResolutionFailures) {
      reportFailure(
        "historicalCollectionFailures",
        `${runtimeSet.id}/${card.id} does not resolve from a saved collection identity.`
      );
    }

    const manifestLeaks = manifest.cards.filter(
      (card) => card.packDexSetId === runtimeSet.id || canonicalIds.has(String(card.packDexCardId))
    );
    const scannerLeaks = scannerCatalog.filter(
      (card) => card.setId === runtimeSet.id || canonicalIds.has(String(card.cardId))
    );
    const priceLeaks = priceCatalog.flatMap((priceSet) =>
      (priceSet.cards || [])
        .filter((card) => priceSet.id === runtimeSet.id || canonicalIds.has(String(card.id)))
        .map((card) => ({ setId: priceSet.id, cardId: card.id }))
    );
    for (const [catalogName, leaks] of [
      ["manifest", manifestLeaks],
      ["scanner", scannerLeaks],
      ["price", priceLeaks],
    ]) {
      if (leaks.length > 0) {
        reportFailure(
          "historicalCatalogLeakage",
          `${runtimeSet.id} has ${leaks.length} retired card(s) in the active ${catalogName} catalog.`
        );
      }
    }

    if (!isRetiredSet(runtimeSet) || activeSetIds.has(runtimeSet.id)) {
      reportFailure(
        "historicalLifecycleFailures",
        `${runtimeSet.id} is not confined to the retired runtime registry.`
      );
    }
    if (runtimeSet.cards.length !== registrySet.expectedCounts.canonicalCatalog) {
      reportFailure(
        "historicalCountMismatches",
        `${runtimeSet.id} runtime count ${runtimeSet.cards.length} != registry count ${registrySet.expectedCounts.canonicalCatalog}.`
      );
    }
    if (collectionCards.length !== registrySet.expectedCounts.collectionChecklist) {
      reportFailure(
        "historicalCountMismatches",
        `${runtimeSet.id} collection checklist count ${collectionCards.length} != registry count ${registrySet.expectedCounts.collectionChecklist}.`
      );
    }

    historicalSetRows.push({
      id: runtimeSet.id,
      name: runtimeSet.name,
      classification: registrySet.classification,
      counts: {
        expectedRegistryCards: registrySet.expectedCounts.canonicalCatalog,
        runtimeCards: runtimeSet.cards.length,
        collectionChecklistCards: collectionCards.length,
        collectionVisibleCards: collectionVisibleCards.length,
        activeManifestCards: manifestLeaks.length,
        activeScannerCards: scannerLeaks.length,
        activePriceCards: priceLeaks.length,
      },
      checks: {
        retiredAndHistoricallyResolvableButNotDiscoverableOrOpenable:
          isRetiredSet(runtimeSet) && registryLifecycleIsHistoricalOnly,
        excludedFromActiveRuntime: !activeSetIds.has(runtimeSet.id),
        expectedRegistryCountMatchesRuntime:
          runtimeSet.cards.length === registrySet.expectedCounts.canonicalCatalog,
        stableIdsUniqueAcrossRuntime: duplicateIds.length === 0,
        requiredFieldsComplete: fieldGapIds.length === 0,
        everyCardRuntimeResolvable: runtimeResolutionFailures.length === 0,
        everyCardCollectionVisibleAndResolvable:
          collectionDiff.missing.length === 0 &&
          collectionDiff.extra.length === 0 &&
          collectionResolutionFailures.length === 0,
        absentFromActiveManifestScannerAndPriceCatalogs:
          manifestLeaks.length === 0 && scannerLeaks.length === 0 && priceLeaks.length === 0,
      },
      reason:
        "Excluded from active catalogs and pack-opening audit; included in historical validation for runtime and saved-collection resolution.",
    });
  }

  const retiredSets = historicalSetRows.map((set) => ({
    id: set.id,
    classification: set.classification,
    canonicalCardCount: set.counts.expectedRegistryCards,
    reason:
      "Excluded from active catalogs and pack-opening audit; included in historical validation for runtime and saved-collection resolution.",
  }));
  const totalFailures = Object.values(failureCounts).reduce((sum, count) => sum + count, 0);

  const audit = {
    schemaVersion: 2,
    sourceSnapshot: registry.sourceSnapshot,
    auditConfiguration: {
      seed: options.seed,
      normalPacksPerActiveSet: options.packsPerSet,
      deterministicClassification:
        "Positive reachability is derived from exported pack pools, configured positive weights, special-slot helpers, and explicit forced God-pack formats. Simulation is supplemental and is not used to prove reachability.",
    },
    scope: {
      activeOfficialSets: activeSets.length,
      retiredSetsExcluded: retiredSets.length,
      retiredSetsExcludedFromActiveCatalogAndPackAudit: retiredSets.length,
      retiredSetsIncludedInHistoricalValidation: historicalSetRows.length,
      activeCanonicalCards: activeSets.reduce((sum, set) => sum + set.cards.length, 0),
      historicalRuntimeCards: historicalSetRows.reduce((sum, set) => sum + set.counts.runtimeCards, 0),
    },
    intentionalExclusions: {
      retiredSets,
      quarantinedLegacyIdentities: quarantine.map((card) => ({
        setId: card.setId,
        cardId: card.id,
        canonicalSetId: card.canonicalSetId,
        canonicalCardId: card.canonicalCardId,
        reason: "Historical wrong-set identity retained only for saved-collection resolution.",
      })),
      nonCollectibleCanonicalCards,
    },
    representationalLimitations: [
      {
        id: "parallel-foil-identity",
        statement:
          "PackDex persists canonical printing IDs. Parallel treatments such as reverse foil, Poke Ball foil, Master Ball foil, and the transient Prismatic God-pack parallelType are not separate canonical rows, so this audit proves canonical-card reachability but cannot prove a distinct catalog identity for every physical parallel foil variant.",
      },
    ],
    historicalValidation: {
      statement:
        "Retired sets are not active, discoverable, openable, simulated, or included in active manifest/scanner/price counts. Their frozen runtime identities remain validated for saved-collection visibility and resolution.",
      retiredSetCount: historicalSetRows.length,
      runtimeCardCount: historicalSetRows.reduce((sum, set) => sum + set.counts.runtimeCards, 0),
      sets: historicalSetRows,
    },
    summary: {
      activeSetCount: setRows.length,
      authoritativeSourceCardCount: setRows.reduce((sum, set) => sum + set.counts.authoritativeSource, 0),
      canonicalRuntimeCardCount: setRows.reduce((sum, set) => sum + set.counts.canonicalRuntime, 0),
      authoritativeManifestCardCount: setRows.reduce((sum, set) => sum + set.counts.authoritativeManifest, 0),
      positivePackPoolCardCount: setRows.reduce((sum, set) => sum + set.counts.positivePackPool, 0),
      collectionChecklistCardCount: setRows.reduce((sum, set) => sum + set.counts.collectionChecklist, 0),
      scannerCardCount: setRows.reduce((sum, set) => sum + set.counts.scanner, 0),
      priceCardCount: setRows.reduce((sum, set) => sum + set.counts.price, 0),
      intentionallyNonCollectibleCanonicalCardCount: nonCollectibleCanonicalCards.length,
      simulatedNormalPacks,
      simulatedForcedGodPacks,
      simulatedCards,
      sumOfPerSetObservedUniqueCards: simulatedObservedUniqueCards,
      historicalValidatedSetCount: historicalSetRows.length,
      historicalRuntimeCardCount: historicalSetRows.reduce(
        (sum, set) => sum + set.counts.runtimeCards,
        0
      ),
      failureCounts,
      totalFailures,
      result: totalFailures === 0 ? "pass" : "fail",
    },
    sets: setRows,
  };

  return { audit, failureMessages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  const options = parseArguments(process.argv.slice(2));
  const { audit, failureMessages } = buildAudit(options);
  const serialized = stableJson(audit);

  if (audit.summary.totalFailures > 0) {
    throw new Error(
      `Card pull-integrity audit failed with ${audit.summary.totalFailures} error(s):\n${failureMessages.join("\n")}`
    );
  }

  if (options.check) {
    const actual = fs.existsSync(options.outputPath) ? fs.readFileSync(options.outputPath, "utf8") : "";
    if (actual !== serialized) {
      throw new Error(`${path.relative(ROOT_DIR, options.outputPath)} is stale. Run this script without --check.`);
    }
    console.log(
      `Card pull-integrity audit is current: ${audit.summary.activeSetCount} sets, ` +
        `${audit.summary.canonicalRuntimeCardCount} canonical cards, ${audit.summary.totalFailures} failures.`
    );
  } else {
    writeAtomic(options.outputPath, serialized);
    console.log(
      `Wrote ${path.relative(ROOT_DIR, options.outputPath)}: ${audit.summary.activeSetCount} sets, ` +
        `${audit.summary.canonicalRuntimeCardCount} canonical cards, ${audit.summary.totalFailures} failures.`
    );
  }
}
