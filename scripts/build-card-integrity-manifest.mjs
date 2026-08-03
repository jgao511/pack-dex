import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeSets, isRetiredSet, sets } from "../src/data/sets.js";
import { PRICE_SET_ALIASES } from "../src/lib/priceSetAliases.js";
import { PRICE_SET_MAP } from "../src/lib/priceSetMap.js";
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";
import { normalizeCardName } from "../src/lib/cardScanner/normalizeScannerText.js";
import { CARD_SUBSET_SOURCE_IDS, getCardPrintedTotalOverride } from "../src/lib/cardSourceIdentity.js";
import { getVintagePackRule } from "../src/data/vintagePackRules.js";
import { GOD_PACK_CONFIG, getPackPools, getPullRateProfile, getSubsetSlotConfig } from "../src/utils/packGenerator.js";
import { getPullableCollectionCards } from "../src/utils/collectionStorage.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_DIR = path.join(ROOT_DIR, "audits", "card-integrity");
const REGISTRY_PATH = path.join(AUDIT_DIR, "authoritative-set-registry.json");
const MANIFEST_PATH = path.join(AUDIT_DIR, "official-card-manifest.json");
const COLLISIONS_PATH = path.join(AUDIT_DIR, "normalization-collisions.json");
const RUNTIME_METADATA_PATH = path.join(ROOT_DIR, "src", "data", "officialSetMetadata.json");
const QUARANTINE_PATH = path.join(ROOT_DIR, "src", "data", "legacyCardQuarantine.json");

export const SOURCE_REPOSITORY = "PokemonTCG/pokemon-tcg-data";
export const SOURCE_COMMIT = "8b4e387930ead7be6595b4d4c59b7ba7a3a79f08";
const SOURCE_BASE_URL = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/${SOURCE_COMMIT}`;

export const SUBSET_SOURCE_IDS = CARD_SUBSET_SOURCE_IDS;

const SOURCE_CARD_OVERRIDES = Object.freeze({
  "black-bolt-60-antique-cover-fossil": "zsv10pt5-80",
});
const MINI_PACK_SET_IDS = new Set(["detective-pikachu", "celebrations"]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, contents);
  fs.renameSync(temporaryPath, filePath);
}

function sourceSetIdFor(set) {
  return (
    PRICE_SET_MAP[set.id] ||
    PRICE_SET_ALIASES[set.id]?.pokemonTcgApiSetId ||
    set.pokemonTcgApiSetId ||
    null
  );
}

function sourceSetIdForCard(set, card) {
  return SUBSET_SOURCE_IDS[set.id]?.[card.subset] || sourceSetIdFor(set);
}

function expectedPackSize(set) {
  const vintageRule = getVintagePackRule(set);
  if (vintageRule?.packSize) return vintageRule.packSize;
  if (set.packConfig?.packSize) return set.packConfig.packSize;
  const profile = getPullRateProfile(set);
  return profile.packSize || (MINI_PACK_SET_IDS.has(set.id) ? 4 : 10);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
  return response.json();
}

async function fetchSourceSnapshot() {
  const sourceSetIds = new Set();
  for (const set of activeSets) {
    sourceSetIds.add(sourceSetIdFor(set));
    for (const subsetSourceId of Object.values(SUBSET_SOURCE_IDS[set.id] || {})) {
      sourceSetIds.add(subsetSourceId);
    }
  }
  sourceSetIds.delete(null);

  const [sourceSets, sourceCards] = await Promise.all([
    fetchJson(`${SOURCE_BASE_URL}/sets/en.json`),
    Promise.all(
      [...sourceSetIds].sort().map(async (sourceSetId) => [
        sourceSetId,
        await fetchJson(`${SOURCE_BASE_URL}/cards/en/${sourceSetId}.json`),
      ])
    ),
  ]);

  return {
    setsById: new Map(sourceSets.map((set) => [String(set.id), set])),
    cardsBySetId: new Map(sourceCards),
  };
}

function findSourceCard(set, card, sourceCards) {
  const overrideId = SOURCE_CARD_OVERRIDES[card.id];
  if (overrideId) {
    const overridden = sourceCards.find((candidate) => candidate.id === overrideId);
    if (!overridden) throw new Error(`Missing source override ${overrideId} for ${card.id}.`);
    return overridden;
  }

  const exactId = sourceCards.find((candidate) => String(candidate.id).toLowerCase() === String(card.id).toLowerCase());
  if (exactId) return exactId;

  const sameNumber = sourceCards.filter(
    (candidate) => String(candidate.number).toLowerCase() === String(card.number).toLowerCase()
  );
  const exactName = sameNumber.find((candidate) => candidate.name === card.name);
  if (exactName) return exactName;
  if (sameNumber.length === 1) return sameNumber[0];

  throw new Error(
    `${set.id}/${card.id} did not resolve uniquely in ${sourceSetIdForCard(set, card)}; ` +
      `collector number ${card.number} produced ${sameNumber.length} candidates.`
  );
}

function sourceFileForSet(set) {
  if (set.vintage) return path.join(ROOT_DIR, "src", "data", "vintageSets.json");
  return path.join(ROOT_DIR, "src", "data", `${set.id}.json`);
}

function applySourceCorrections(nameByCardId) {
  const quarantineIds = new Set(JSON.parse(fs.readFileSync(QUARANTINE_PATH, "utf8")).map((card) => card.id));
  const files = new Map();

  for (const set of activeSets) {
    const filePath = sourceFileForSet(set);
    if (!files.has(filePath)) {
      const source = fs.readFileSync(filePath, "utf8");
      files.set(filePath, {
        source,
        newline: source.includes("\r\n") ? "\r\n" : "\n",
        parsed: JSON.parse(source),
      });
    }

    const file = files.get(filePath);
    const cards = set.vintage
      ? file.parsed.find((candidate) => candidate.id === set.id)?.cards
      : file.parsed;
    if (!Array.isArray(cards)) throw new Error(`Could not locate card array for ${set.id} in ${filePath}.`);

    const canonicalCards = cards.filter((card) => !quarantineIds.has(card.id));
    for (const card of canonicalCards) {
      const canonicalName = nameByCardId.get(card.id);
      if (canonicalName) card.name = canonicalName;
      delete card.excludeFromPulls;
    }

    if (set.vintage) {
      file.parsed.find((candidate) => candidate.id === set.id).cards = canonicalCards;
    } else {
      file.parsed = canonicalCards;
    }
  }

  for (const [filePath, file] of files) {
    const serialized = stableJson(file.parsed).replaceAll("\n", file.newline);
    if (serialized !== file.source) writeAtomic(filePath, serialized);
  }
}

function buildNormalizationCollisions(manifestCards) {
  const runtimeSetsById = new Map(activeSets.map((set) => [set.id, set]));
  const scannerEntriesByCardId = new Map(
    buildScannerCatalog(activeSets).map((entry) => [String(entry.cardId), entry])
  );
  const pullPoolsBySetId = new Map(
    activeSets.map((set) => {
      const pools = getPackPools(set);
      return [set.id, Object.fromEntries(
        ["cleanCards", "commonPool", "uncommonPool", "reverseSlotPool", "subsetPool", "finalSlotPool"]
          .map((poolName) => [poolName, new Set((pools[poolName] || []).map((card) => String(card.id)))])
      )];
    })
  );
  const collectionIdsBySetId = new Map(
    activeSets.map((set) => [set.id, new Set(getPullableCollectionCards(set).map((card) => String(card.id)))])
  );
  const describeCard = (card) => {
    const scannerEntry = scannerEntriesByCardId.get(String(card.packDexCardId));
    const poolIds = pullPoolsBySetId.get(card.packDexSetId) || {};
    const normalizedName = normalizeCardName(card.canonicalName);
    return {
      packDexSetId: card.packDexSetId,
      packDexCardId: card.packDexCardId,
      sourceSetId: card.sourceSetId,
      sourceCardId: card.sourceCardId,
      originalName: card.canonicalName,
      normalizedName,
      collectorNumber: String(card.number),
      normalizedCollectorNumber: scannerEntry?.normalizedNumber || String(card.number),
      printedSetTotal: scannerEntry?.printedSetTotal || "",
      imagePath: card.image,
      currentAliases: {
        normalizedName,
        normalizedNameTokens: normalizedName.split(" ").filter(Boolean),
      },
      currentPullPoolAssignments: Object.entries(poolIds)
        .filter(([, ids]) => ids.has(String(card.packDexCardId)))
        .map(([poolName]) => poolName),
      collectionChecklist: collectionIdsBySetId.get(card.packDexSetId)?.has(String(card.packDexCardId)) || false,
      runtimeSetPresent: runtimeSetsById.has(card.packDexSetId),
    };
  };
  const groupBy = (keyForCard) => {
    const groups = new Map();
    for (const card of manifestCards) {
      const key = keyForCard(card);
      const values = groups.get(key) || [];
      values.push(card);
      groups.set(key, values);
    }
    return groups;
  };
  const withinSetGroups = [...groupBy(
    (card) => `${card.packDexSetId}\u0000${normalizeCardName(card.canonicalName)}`
  ).entries()]
    .filter(([, cards]) => cards.length > 1)
    .map(([key, cards]) => {
      const [, normalizedName] = key.split("\u0000");
      return {
        packDexSetId: cards[0].packDexSetId,
        normalizedName,
        classification: new Set(cards.map((card) => card.canonicalName)).size === 1
          ? "same-display-name-distinct-printings"
          : "destructive-name-normalization",
        identityStatus: "contained-by-distinct-canonical-ids",
        cards: cards.map(describeCard),
      };
    })
    .sort((left, right) =>
      left.packDexSetId.localeCompare(right.packDexSetId) || left.normalizedName.localeCompare(right.normalizedName)
    );
  const crossSetNormalizedNameGroups = [...groupBy(
    (card) => normalizeCardName(card.canonicalName)
  ).entries()]
    .filter(([, cards]) => cards.length > 1 && new Set(cards.map((card) => card.packDexSetId)).size > 1)
    .map(([normalizedName, cards]) => ({
      normalizedName,
      setCount: new Set(cards.map((card) => card.packDexSetId)).size,
      identityStatus: "contained-by-set-and-canonical-id",
      cards: cards.map(describeCard),
    }))
    .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName));
  const scannerKeyGroups = [...groupBy((card) => {
    const scannerEntry = scannerEntriesByCardId.get(String(card.packDexCardId));
    return [
      scannerEntry?.normalizedName || normalizeCardName(card.canonicalName),
      scannerEntry?.normalizedNumber || String(card.number),
      scannerEntry?.printedSetTotal || "",
    ].join("\u0000");
  }).entries()]
    .filter(([, cards]) => cards.length > 1 && new Set(cards.map((card) => card.packDexSetId)).size > 1)
    .map(([key, cards]) => {
      const [normalizedName, normalizedCollectorNumber, printedSetTotal] = key.split("\u0000");
      return {
        normalizedName,
        normalizedCollectorNumber,
        printedSetTotal,
        recognitionStatus: "ambiguous-without-set-visual-or-user-confirmation",
        identityStatus: "contained-by-canonical-id",
        cards: cards.map(describeCard),
      };
    })
    .sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName) ||
      left.normalizedCollectorNumber.localeCompare(right.normalizedCollectorNumber) ||
      left.printedSetTotal.localeCompare(right.printedSetTotal)
    );

  return {
    schemaVersion: 2,
    invariant: "Normalized names are search aliases only and never authoritative card identities.",
    aliasPolicy: "The current catalog has no identity-changing per-card alias table. Scanner normalized names and tokens are search evidence only; acceptance remains canonical-ID scoped.",
    groupCount: withinSetGroups.length,
    destructiveGroupCount: withinSetGroups.filter((group) => group.classification === "destructive-name-normalization").length,
    crossSetNormalizedNameGroupCount: crossSetNormalizedNameGroups.length,
    scannerKeyCollisionGroupCount: scannerKeyGroups.length,
    groups: withinSetGroups,
    crossSetNormalizedNameGroups,
    scannerKeyCollisionGroups: scannerKeyGroups,
  };
}

function buildRuntimeMetadata(registry) {
  return Object.fromEntries(
    registry.sets
      .filter((set) => set.classification === "official")
      .map((set) => [set.id, {
        sourceSetId: set.sources.find((source) => source.role === "main")?.setId || null,
        allowedSourceSetIds: set.allowedSourceSetIds,
        printedTotal: set.printedTotal,
        sourceCardCount: set.expectedCounts.source,
      }])
  );
}

function compareTrackedArtifact(filePath, expected) {
  const actual = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (actual !== expected) throw new Error(`${path.relative(ROOT_DIR, filePath)} is stale. Run this script with --refresh.`);
}

function validateCommittedArtifacts() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  const canonicalSets = new Map(activeSets.map((set) => [set.id, set]));
  const manifestByCardId = new Map(manifest.cards.map((card) => [card.packDexCardId, card]));
  const localCards = activeSets.flatMap((set) => set.cards.map((card) => ({ set, card })));

  if (registry.sourceSnapshot.commit !== SOURCE_COMMIT || manifest.sourceSnapshot.commit !== SOURCE_COMMIT) {
    throw new Error("Card-integrity artifacts are not pinned to the configured source commit.");
  }
  if (registry.sets.length !== sets.length || registry.activeSetCount !== activeSets.length) {
    throw new Error("Authoritative set registry does not match the runtime set inventory.");
  }
  if (manifest.cards.length !== localCards.length) {
    throw new Error(`Official manifest has ${manifest.cards.length} cards; runtime active catalog has ${localCards.length}.`);
  }

  for (const { set, card } of localCards) {
    const expected = manifestByCardId.get(card.id);
    if (!expected) throw new Error(`Active card ${set.id}/${card.id} is missing from the official manifest.`);
    if (expected.packDexSetId !== set.id || expected.canonicalName !== card.name || String(expected.number) !== String(card.number)) {
      throw new Error(`Active card ${set.id}/${card.id} no longer matches its pinned manifest identity.`);
    }
  }

  const providerIds = new Set();
  for (const card of manifest.cards) {
    if (providerIds.has(card.sourceCardId)) throw new Error(`Provider identity ${card.sourceCardId} maps to multiple active cards.`);
    providerIds.add(card.sourceCardId);
    if (!canonicalSets.has(card.packDexSetId)) throw new Error(`Manifest references unknown set ${card.packDexSetId}.`);
  }

  const legacyIds = new Set(JSON.parse(fs.readFileSync(QUARANTINE_PATH, "utf8")).map((card) => card.id));
  for (const set of activeSets) {
    if (set.cards.some((card) => legacyIds.has(card.id))) throw new Error(`${set.id} still contains a quarantined card.`);
  }

  compareTrackedArtifact(RUNTIME_METADATA_PATH, stableJson(buildRuntimeMetadata(registry)));
  compareTrackedArtifact(COLLISIONS_PATH, stableJson(buildNormalizationCollisions(manifest.cards)));
  console.log(`Card-integrity artifacts are current: ${registry.sets.length} sets, ${manifest.cards.length} active official cards.`);
}

async function refreshArtifacts({ writeSourceFixes = false } = {}) {
  const snapshot = await fetchSourceSnapshot();
  const manifestCards = [];
  const nameByCardId = new Map();
  const usedSourceCardIds = new Set();
  const quarantineIds = new Set(JSON.parse(fs.readFileSync(QUARANTINE_PATH, "utf8")).map((card) => card.id));

  for (const set of activeSets) {
    const localCards = set.cards.filter((card) => !quarantineIds.has(card.id));
    for (const card of localCards) {
      const sourceSetId = sourceSetIdForCard(set, card);
      const sourceCard = findSourceCard(set, card, snapshot.cardsBySetId.get(sourceSetId) || []);
      if (usedSourceCardIds.has(sourceCard.id)) throw new Error(`Provider card ${sourceCard.id} mapped more than once.`);
      usedSourceCardIds.add(sourceCard.id);
      nameByCardId.set(card.id, sourceCard.name);
      manifestCards.push({
        packDexSetId: set.id,
        packDexCardId: card.id,
        sourceSetId,
        sourceCardId: sourceCard.id,
        number: card.number,
        sourceNumber: sourceCard.number,
        canonicalName: sourceCard.name,
        localRarity: card.rarity,
        sourceRarity: sourceCard.rarity || null,
        printedTotalOverride: getCardPrintedTotalOverride(card),
        subset: card.subset || null,
        image: card.image || null,
      });
    }
  }

  for (const set of activeSets) {
    const sourceIds = [sourceSetIdFor(set), ...Object.values(SUBSET_SOURCE_IDS[set.id] || {})];
    const expected = sourceIds.reduce((total, sourceId) => total + (snapshot.cardsBySetId.get(sourceId)?.length || 0), 0);
    const actual = manifestCards.filter((card) => card.packDexSetId === set.id).length;
    if (actual !== expected) throw new Error(`${set.id} maps ${actual} cards but its pinned sources contain ${expected}.`);
  }

  if (writeSourceFixes) applySourceCorrections(nameByCardId);

  const sourceSnapshot = {
    repository: SOURCE_REPOSITORY,
    commit: SOURCE_COMMIT,
    cardManifestCount: snapshot.cardsBySetId.size,
  };
  const registrySets = sets.map((set) => {
    const mainSourceId = sourceSetIdFor(set);
    const subsetSources = Object.entries(SUBSET_SOURCE_IDS[set.id] || {});
    const sources = mainSourceId
      ? [
          { provider: "pokemon-tcg-data", setId: mainSourceId, role: "main", expectedCards: snapshot.cardsBySetId.get(mainSourceId).length },
          ...subsetSources.map(([subset, setId]) => ({ provider: "pokemon-tcg-data", setId, role: "subset", subset, expectedCards: snapshot.cardsBySetId.get(setId).length })),
        ]
      : [];
    const officialSourceSet = mainSourceId ? snapshot.setsById.get(mainSourceId) : null;
    const canonicalCards = isRetiredSet(set) ? set.cards : manifestCards.filter((card) => card.packDexSetId === set.id);
    const sourceCount = sources.reduce((total, source) => total + source.expectedCards, 0);
    const legacyCount = (set.legacyCards || []).length;
    const vintageRule = getVintagePackRule(set);
    const subsetRule = getSubsetSlotConfig(set);
    return {
      id: set.id,
      canonicalSourceSetId: mainSourceId,
      displayName: set.name,
      era: set.era,
      classification: mainSourceId ? "official" : "packdex-custom-preview",
      lifecycle: {
        status: isRetiredSet(set) ? "retired" : "active",
        discoverable: !isRetiredSet(set),
        openable: !isRetiredSet(set),
        historicallyResolvable: true,
      },
      releaseDate: set.releaseDate || null,
      printedTotal: Number(officialSourceSet?.printedTotal || set.printedTotal || 0) || null,
      sources,
      allowedSourceSetIds: sources.map((source) => source.setId),
      expectedCounts: {
        source: mainSourceId ? sourceCount : set.cards.length,
        canonicalCatalog: canonicalCards.length,
        collectionChecklist: isRetiredSet(set) ? getPullableCollectionCards(set).length : getPullableCollectionCards({ ...set, cards: set.cards.filter((card) => !quarantineIds.has(card.id)) }).length,
        legacyResolvable: legacyCount,
      },
      assets: {
        logo: set.logoPath,
        imageDirectory: `sets/${set.setFolder || set.id}/cards`,
      },
      pack: {
        profile: set.pullRateProfile || null,
        size: expectedPackSize(set),
        vintageRule: vintageRule || null,
        subsetRule: subsetRule || null,
        godPackRule: GOD_PACK_CONFIG[set.id] || null,
        codeCardsExcluded: true,
        genericEnergiesExcluded: true,
        numberedSetEnergiesIncluded: true,
        promosPermitted: false,
      },
      exceptions: (set.legacyCards || []).map((card) => ({
        cardId: card.id,
        status: "legacy-resolution-only",
        canonicalSetId: card.canonicalSetId,
        canonicalCardId: card.canonicalCardId,
        reason: "Preserved historical wrong-set identity; excluded from all active catalogs.",
      })),
    };
  });

  const registry = {
    schemaVersion: 1,
    sourceSnapshot,
    setCount: registrySets.length,
    activeSetCount: activeSets.length,
    officialActiveSetCount: registrySets.filter((set) => set.classification === "official" && set.lifecycle.status === "active").length,
    customRetiredSetCount: registrySets.filter((set) => set.classification === "packdex-custom-preview").length,
    sets: registrySets,
  };
  const manifest = {
    schemaVersion: 1,
    sourceSnapshot,
    identityInvariant: "sourceCardId is authoritative; PackDex IDs remain stable persistence keys and are never derived from display names.",
    activeOfficialCardCount: manifestCards.length,
    cards: manifestCards,
  };
  const collisions = buildNormalizationCollisions(manifestCards);

  writeAtomic(REGISTRY_PATH, stableJson(registry));
  writeAtomic(MANIFEST_PATH, stableJson(manifest));
  writeAtomic(COLLISIONS_PATH, stableJson(collisions));
  writeAtomic(RUNTIME_METADATA_PATH, stableJson(buildRuntimeMetadata(registry)));
  console.log(`Refreshed card-integrity artifacts from ${SOURCE_COMMIT}: ${registrySets.length} sets, ${manifestCards.length} active cards.`);
}

const refresh = process.argv.includes("--refresh");
const writeSourceFixes = process.argv.includes("--write-source-fixes");
if (writeSourceFixes && !refresh) throw new Error("--write-source-fixes requires --refresh.");

if (refresh) {
  await refreshArtifacts({ writeSourceFixes });
} else {
  validateCommittedArtifacts();
}
