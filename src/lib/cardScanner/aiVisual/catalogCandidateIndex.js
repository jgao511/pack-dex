import { getScannerCatalog } from "../buildScannerCatalog.js";
import { normalizeCollectorNumber } from "../normalizeScannerText.js";
import { getCardImageUrl } from "../../../utils/assetUrls.js";

const DEFAULT_FUZZY_NAME_LIMIT = 3;
const DEFAULT_FUZZY_NAME_THRESHOLD = 0.72;
const DEFAULT_MAX_FUZZY_NAME_QUERIES = 4;
const DEFAULT_MAX_FUZZY_GROUP_COMPARISONS = 128;
const MAX_COLLECTOR_VARIANTS = 12;
const PAIR_SEPARATOR = "\u0000";

const NAME_NOISE_TOKENS = new Set([
  "ability", "attack", "basic", "copyright", "creatures", "damage", "discard",
  "energy", "evolves", "from", "game", "freak", "hp", "item", "nintendo",
  "pokemon", "resistance", "retreat", "rule", "stage", "stadium", "supporter",
  "tool", "trademark", "weakness",
]);

const FAMILY_MODIFIERS = new Set([
  "and", "break", "ex", "gx", "legend", "lv", "m", "mega", "star", "the",
  "v", "vmax", "vstar", "x",
]);

const OCR_DIGIT_OPTIONS = new Map([
  ["A", ["4"]], ["B", ["8", "3"]], ["D", ["0"]], ["G", ["6"]],
  ["I", ["1"]], ["L", ["1"]], ["O", ["0"]], ["Q", ["0"]],
  ["S", ["5"]], ["T", ["7"]], ["Z", ["2"]],
]);

const FULL_CATALOG_REASON = Object.freeze({
  code: "full-catalog-fallback",
  family: "fallback",
  weight: 0,
});
const FULL_CATALOG_REASONS = Object.freeze([FULL_CATALOG_REASON]);

function asArray(value) {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function addIndex(map, key, value) {
  if (key === null || key === undefined || key === "") return;
  const values = map.get(key);
  if (values) {
    if (values[values.length - 1] !== value && !values.includes(value)) values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pairKey(number, total) {
  return `${number}${PAIR_SEPARATOR}${total}`;
}

export function normalizeCatalogSearchName(value) {
  return String(value ?? "")
    // Preserve symbols that are identity-bearing in trusted card names before
    // punctuation folding. These distinguish, for example, Pikachu from
    // Pikachu Star and ordinary cards from delta-species/Prism Star cards.
    .replace(/\bunown\s*(?:\[\s*)?!(?:\s*\])?/gi, "unown exclamation")
    .replace(/\bunown\s*(?:\[\s*)?\?(?:\s*\])?/gi, "unown question")
    .replace(/\u00e2\u2122\u201a/g, " male ")
    .replace(/\u00e2\u2122\u20ac/g, " female ")
    .replace(/\u2642/g, " male ")
    .replace(/\u2640/g, " female ")
    .replace(/\u2605/g, " star ")
    .replace(/\u25c7/g, " prism star ")
    .replace(/\u03b1/gi, " alpha ")
    .replace(/\u03b2/gi, " beta ")
    .replace(/\u03b3/gi, " gamma ")
    .replace(/\u03b4/gi, " delta ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    // Joining apostrophes makes Farfetch'd and owner names resilient to OCR that
    // drops the mark. A separate compact key handles OCR that inserts spaces.
    .replace(/[\u2018\u2019\u02bc'`]/g, "")
    .replace(/[\u2010-\u2015-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactNameKey(value) {
  return normalizeCatalogSearchName(value).replace(/\s+/g, "");
}

function ocrNameSkeleton(value) {
  return compactNameKey(value)
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[a4]/g, "a")
    .replace(/[b8]/g, "b")
    .replace(/[e3]/g, "e")
    .replace(/[g69]/g, "g")
    .replace(/[i1l|!]/g, "i")
    .replace(/[o0]/g, "o")
    .replace(/[s5]/g, "s")
    .replace(/[t7]/g, "t")
    .replace(/[z2]/g, "z");
}

function nameTrigrams(value) {
  const compact = compactNameKey(value);
  if (compact.length < 3) return compact ? [compact] : [];
  const trigrams = new Set();
  for (let index = 0; index <= compact.length - 3; index += 1) trigrams.add(compact.slice(index, index + 3));
  return [...trigrams];
}

function megaAliases(normalizedName) {
  const aliases = [];
  const shortPrefix = normalizedName.match(/^m\s+(.+)$/);
  const longPrefix = normalizedName.match(/^mega\s+(.+)$/);
  if (shortPrefix) aliases.push(`mega ${shortPrefix[1]}`);
  if (longPrefix) aliases.push(`m ${longPrefix[1]}`);
  return aliases;
}

function familyTokensFor(normalizedName) {
  return [...new Set(normalizedName.split(" ").filter((token) => (
    token.length > 1 && !FAMILY_MODIFIERS.has(token)
  )))];
}

function normalizeTrustedCollectorPart(value) {
  const compact = String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
  return compact ? normalizeCollectorNumber(compact) : "";
}

function imageUrlFor(entry) {
  return getCardImageUrl(entry.card || entry);
}

/**
 * Builds scanner-AI-only integer lookup maps over the trusted PackDex catalog.
 * Card IDs are validated as unique and every lookup map stores card/name indexes,
 * not duplicate metadata objects.
 */
export function createCatalogCandidateIndex(sourceCatalog = getScannerCatalog()) {
  const byCardId = new Map();
  const byCollectorNumber = new Map();
  const byCollectorPair = new Map();
  const byPrintedTotal = new Map();
  const bySetId = new Map();
  const familyTokenCache = new Map();

  const cards = sourceCatalog.map((entry, cardIndex) => {
    const cardId = String(entry.cardId ?? entry.id ?? entry.card?.id ?? "").trim();
    if (!cardId) throw new Error(`Trusted catalog entry ${cardIndex} has no card ID`);
    if (byCardId.has(cardId)) throw new Error(`Duplicate trusted card ID: ${cardId}`);

    const canonicalName = String(entry.name ?? entry.canonicalName ?? entry.card?.name ?? "").trim();
    if (!canonicalName) throw new Error(`Trusted catalog card ${cardId} has no canonical name`);
    const normalizedName = normalizeCatalogSearchName(canonicalName);
    let familyTokens = familyTokenCache.get(normalizedName);
    if (!familyTokens) {
      familyTokens = Object.freeze(familyTokensFor(normalizedName));
      familyTokenCache.set(normalizedName, familyTokens);
    }

    const collectorNumber = String(entry.cardNumber ?? entry.collectorNumber ?? entry.card?.number ?? "").trim();
    const printedTotal = String(entry.printedSetTotal ?? entry.printedTotal ?? "").trim();
    const normalizedCollectorNumber = normalizeTrustedCollectorPart(collectorNumber);
    const normalizedPrintedTotal = normalizeTrustedCollectorPart(printedTotal);
    const card = {
      cardId,
      canonicalName,
      normalizedName,
      setId: String(entry.setId ?? entry.card?.setId ?? entry.card?.set ?? ""),
      collectorNumber,
      printedTotal,
      rarity: entry.rarity ?? entry.card?.rarity ?? null,
      imageUrl: imageUrlFor(entry),
      familyTokens,
      normalizedCollectorNumber,
      normalizedPrintedTotal,
    };

    byCardId.set(cardId, cardIndex);
    addIndex(byCollectorNumber, normalizedCollectorNumber, cardIndex);
    addIndex(byPrintedTotal, normalizedPrintedTotal, cardIndex);
    if (normalizedCollectorNumber && normalizedPrintedTotal) {
      addIndex(byCollectorPair, pairKey(normalizedCollectorNumber, normalizedPrintedTotal), cardIndex);
    }
    addIndex(bySetId, card.setId, cardIndex);
    return card;
  });

  const groups = [];
  const groupIndexByNormalizedName = new Map();
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
    const card = cards[cardIndex];
    let groupIndex = groupIndexByNormalizedName.get(card.normalizedName);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groupIndexByNormalizedName.set(card.normalizedName, groupIndex);
      const aliases = megaAliases(card.normalizedName);
      groups.push({
        canonicalName: card.canonicalName,
        normalizedName: card.normalizedName,
        compactKey: compactNameKey(card.normalizedName),
        skeletonKey: ocrNameSkeleton(card.normalizedName),
        aliases,
        familyTokens: card.familyTokens,
        cardIndices: [],
      });
    }
    groups[groupIndex].cardIndices.push(cardIndex);
  }

  const byNormalizedName = new Map();
  const byCompactName = new Map();
  const byMegaAlias = new Map();
  const byOcrNameSkeleton = new Map();
  const byNameTrigram = new Map();
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    addIndex(byNormalizedName, group.normalizedName, groupIndex);
    addIndex(byCompactName, group.compactKey, groupIndex);
    addIndex(byOcrNameSkeleton, group.skeletonKey, groupIndex);
    for (const trigram of new Set([
      ...nameTrigrams(group.normalizedName),
      ...nameTrigrams(group.skeletonKey),
      ...group.aliases.flatMap(nameTrigrams),
    ])) addIndex(byNameTrigram, trigram, groupIndex);
    for (const alias of group.aliases) {
      addIndex(byMegaAlias, `n:${alias}`, groupIndex);
      addIndex(byMegaAlias, `c:${compactNameKey(alias)}`, groupIndex);
      addIndex(byOcrNameSkeleton, ocrNameSkeleton(alias), groupIndex);
    }
  }

  const collectorPrefixes = [...new Set(cards.map((card) => (
    card.normalizedCollectorNumber.match(/^[A-Z]+/)?.[0] || ""
  )).filter(Boolean))].sort((left, right) => right.length - left.length || left.localeCompare(right));

  return {
    schemaVersion: 1,
    cards,
    nameGroups: groups,
    byCardId,
    byCollectorNumber,
    byCollectorPair,
    byPrintedTotal,
    bySetId,
    byNormalizedName,
    byCompactName,
    byMegaAlias,
    byOcrNameSkeleton,
    byNameTrigram,
    collectorPrefixes,
    stats: {
      cardCount: cards.length,
      nameCount: groups.length,
      setCount: bySetId.size,
    },
  };
}

let cachedCatalogCandidateIndex;

export function getCatalogCandidateIndex() {
  if (!cachedCatalogCandidateIndex) cachedCatalogCandidateIndex = createCatalogCandidateIndex();
  return cachedCatalogCandidateIndex;
}

function editDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = [...Array(right.length + 1).keys()];
  for (let rowIndex = 1; rowIndex <= left.length; rowIndex += 1) {
    const current = [rowIndex];
    for (let columnIndex = 1; columnIndex <= right.length; columnIndex += 1) {
      current[columnIndex] = Math.min(
        current[columnIndex - 1] + 1,
        previous[columnIndex] + 1,
        previous[columnIndex - 1] + (left[rowIndex - 1] === right[columnIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function editSimilarity(left, right) {
  if (!left || !right) return 0;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function tokenDice(left, right) {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function fuzzyNameScore(query, group) {
  const comparisons = [group.normalizedName, ...group.aliases];
  let best = 0;
  for (const comparison of comparisons) {
    const compactScore = editSimilarity(compactNameKey(query), compactNameKey(comparison));
    const skeletonScore = editSimilarity(ocrNameSkeleton(query), ocrNameSkeleton(comparison)) * 0.98;
    const wordScore = editSimilarity(query, comparison) * 0.72 + tokenDice(query, comparison) * 0.28;
    best = Math.max(best, compactScore, skeletonScore, wordScore);
  }
  return best;
}

function fuzzyGroupCandidates(index, normalized, maximumComparisons) {
  const overlapCounts = new Map();
  const queryKeys = new Set([
    ...nameTrigrams(normalized),
    ...nameTrigrams(ocrNameSkeleton(normalized)),
  ]);
  for (const key of queryKeys) {
    for (const groupIndex of index.byNameTrigram.get(key) || []) {
      overlapCounts.set(groupIndex, (overlapCounts.get(groupIndex) || 0) + 1);
    }
  }
  return [...overlapCounts]
    .sort(([leftIndex, leftCount], [rightIndex, rightCount]) => rightCount - leftCount
      || index.nameGroups[leftIndex].normalizedName.localeCompare(index.nameGroups[rightIndex].normalizedName))
    .slice(0, maximumComparisons)
    .map(([groupIndex]) => groupIndex);
}

function reasonKey(reason) {
  return `${reason.code}\u0000${reason.query ?? ""}\u0000${reason.setId ?? ""}`;
}

function addReason(map, cardIndex, reason) {
  let reasons = map.get(cardIndex);
  if (!reasons) {
    reasons = new Map();
    map.set(cardIndex, reasons);
  }
  const key = reasonKey(reason);
  const prior = reasons.get(key);
  if (!prior || (reason.weight || 0) > (prior.weight || 0)) reasons.set(key, reason);
}

function addGroupReason(target, index, groupIndices, reason) {
  for (const groupIndex of groupIndices || []) {
    for (const cardIndex of index.nameGroups[groupIndex].cardIndices) addReason(target, cardIndex, reason);
  }
}

function collectNameInputs(evidence) {
  return [
    ...asArray(evidence.names),
    ...asArray(evidence.nameCandidates),
    ...asArray(evidence.name),
    ...asArray(evidence.ocrName),
  ];
}

function nameValue(input) {
  if (typeof input === "string" || typeof input === "number") return String(input);
  return String(input?.raw ?? input?.value ?? input?.name ?? input?.normalized ?? "");
}

function isExplicitlyUnreliable(input) {
  return typeof input === "object" && input !== null && (
    input.reliable === false || input.usable === false
  );
}

function fuzzyQueryIsUsable(normalized) {
  if (normalized.length < 3 || normalized.length > 64 || !/[a-z]/.test(normalized)) return false;
  const informative = normalized.split(" ").filter((token) => (
    /[a-z]/.test(token) && !NAME_NOISE_TOKENS.has(token)
  ));
  return informative.length > 0;
}

function collectNameMatches(index, evidence, options) {
  const matches = new Map();
  const queries = [];
  let fuzzyGroupCount = 0;
  let fuzzyQueriesUsed = 0;
  let fuzzyScannedGroupCount = 0;
  const seen = new Set();

  for (const input of collectNameInputs(evidence)) {
    if (isExplicitlyUnreliable(input)) continue;
    const normalized = normalizeCatalogSearchName(nameValue(input));
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const compact = compactNameKey(normalized);
    const skeleton = ocrNameSkeleton(normalized);
    const sourcePass = typeof input === "object" && input ? input.sourcePass || null : null;
    const summary = { raw: nameValue(input), normalized, sourcePass, matchType: null };

    let groupIndices = index.byNormalizedName.get(normalized);
    let reason;
    if (groupIndices?.length) {
      summary.matchType = "exact";
      reason = { code: "name-exact", family: "name", weight: 80, query: normalized, sourcePass };
    } else {
      groupIndices = index.byCompactName.get(compact);
      if (groupIndices?.length) {
        summary.matchType = "spacing-punctuation";
        reason = { code: "name-spacing-punctuation", family: "name", weight: 76, query: normalized, sourcePass };
      }
    }
    if (!groupIndices?.length) {
      groupIndices = [
        ...(index.byMegaAlias.get(`n:${normalized}`) || []),
        ...(index.byMegaAlias.get(`c:${compact}`) || []),
      ];
      if (groupIndices.length) {
        groupIndices = [...new Set(groupIndices)];
        summary.matchType = "mega-prefix-alias";
        reason = { code: "name-mega-prefix-alias", family: "name", weight: 74, query: normalized, sourcePass };
      }
    }
    if (!groupIndices?.length) {
      groupIndices = index.byOcrNameSkeleton.get(skeleton);
      if (groupIndices?.length) {
        summary.matchType = "ocr-skeleton";
        reason = { code: "name-ocr-skeleton", family: "name", weight: 70, query: normalized, sourcePass };
      }
    }

    if (groupIndices?.length) {
      addGroupReason(matches, index, groupIndices, reason);
      queries.push(summary);
      continue;
    }

    if (!fuzzyQueryIsUsable(normalized)) {
      summary.matchType = "unusable";
      queries.push(summary);
      continue;
    }

    if (fuzzyQueriesUsed >= (options.maxFuzzyNameQueries ?? DEFAULT_MAX_FUZZY_NAME_QUERIES)) {
      summary.matchType = "skipped-fuzzy-budget";
      queries.push(summary);
      continue;
    }
    fuzzyQueriesUsed += 1;

    const threshold = Math.max(
      options.fuzzyNameThreshold ?? DEFAULT_FUZZY_NAME_THRESHOLD,
      normalized.length <= 4 ? 0.8 : 0,
    );
    const fuzzyGroupIndices = fuzzyGroupCandidates(
      index,
      normalized,
      Math.max(1, options.maxFuzzyGroupComparisons ?? DEFAULT_MAX_FUZZY_GROUP_COMPARISONS),
    );
    fuzzyScannedGroupCount += fuzzyGroupIndices.length;
    const ranked = fuzzyGroupIndices
      .map((groupIndex) => ({ groupIndex, score: fuzzyNameScore(normalized, index.nameGroups[groupIndex]) }))
      .filter(({ score }) => score >= threshold)
      .sort((left, right) => right.score - left.score
        || index.nameGroups[left.groupIndex].normalizedName.localeCompare(index.nameGroups[right.groupIndex].normalizedName));
    const bestScore = ranked[0]?.score || 0;
    const selected = ranked
      .filter(({ score }) => score >= bestScore - 0.1)
      .slice(0, Math.max(1, options.fuzzyNameLimit ?? DEFAULT_FUZZY_NAME_LIMIT));
    if (selected.length) {
      summary.matchType = "fuzzy";
      summary.bestSimilarity = selected[0].score;
      fuzzyGroupCount += selected.length;
      for (const { groupIndex, score } of selected) {
        addGroupReason(matches, index, [groupIndex], {
          code: "name-fuzzy",
          family: "name",
          weight: Math.round(45 + score * 25),
          query: normalized,
          similarity: score,
          sourcePass,
        });
      }
    } else {
      summary.matchType = "unusable";
    }
    queries.push(summary);
  }

  return { matches, queries, fuzzyGroupCount, fuzzyQueriesUsed, fuzzyScannedGroupCount };
}

function expandOcrDigits(value) {
  let variants = [{ value: "", corrections: [] }];
  for (const character of value) {
    const options = /\d/.test(character) ? [character] : OCR_DIGIT_OPTIONS.get(character);
    if (!options) return [];
    variants = variants.flatMap((variant) => options.map((option) => ({
      value: `${variant.value}${option}`,
      corrections: /\d/.test(character) ? variant.corrections : [...variant.corrections, `${character}->${option}`],
    }))).slice(0, MAX_COLLECTOR_VARIANTS);
  }
  return variants;
}

export function createCollectorSearchVariants(value, collectorPrefixes = []) {
  const compact = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "");
  if (!compact || compact.length > 10 || !/^[A-Z0-9]+$/.test(compact)) return [];

  const variants = new Map();
  const exactValue = normalizeTrustedCollectorPart(compact);
  variants.set(exactValue, { value: exactValue, kind: "exact", corrections: [] });

  const splits = [{ prefix: "", numericPart: compact }];
  for (const prefix of collectorPrefixes) {
    if (compact.startsWith(prefix) && compact.length > prefix.length) {
      splits.push({ prefix, numericPart: compact.slice(prefix.length) });
    }
  }
  const generic = compact.match(/^([A-Z]+)([A-Z0-9]*\d[A-Z0-9]*)$/);
  if (generic) splits.push({ prefix: generic[1], numericPart: generic[2] });

  for (const { prefix, numericPart } of splits) {
    for (const expanded of expandOcrDigits(numericPart)) {
      const normalized = normalizeTrustedCollectorPart(`${prefix}${expanded.value}`);
      if (!normalized || variants.has(normalized)) continue;
      variants.set(normalized, {
        value: normalized,
        kind: expanded.corrections.length ? "ocr-corrected" : "exact",
        corrections: expanded.corrections,
      });
      if (variants.size >= MAX_COLLECTOR_VARIANTS) break;
    }
    if (variants.size >= MAX_COLLECTOR_VARIANTS) break;
  }
  return [...variants.values()];
}

function collectCollectorInputs(evidence) {
  const explicit = [
    ...asArray(evidence.collectorNumbers),
    ...asArray(evidence.collectors),
  ];
  if (evidence.collectorNumber !== null && evidence.collectorNumber !== undefined) {
    explicit.push({
      cardNumber: evidence.collectorNumber,
      printedSetTotal: evidence.printedTotal ?? evidence.printedSetTotal ?? null,
    });
  }
  return explicit;
}

function parseCollectorInput(input, index) {
  if (isExplicitlyUnreliable(input)) return null;
  const isObject = typeof input === "object" && input !== null;
  const raw = isObject
    ? String(input.raw ?? "")
    : String(input ?? "");
  const rawParts = raw.normalize("NFKC").replace(/[\uFF0F\u2044]/g, "/").split("/");
  const number = isObject
    ? input.cardNumber ?? input.collectorNumber ?? input.number ?? input.normalized ?? rawParts[0]
    : rawParts[0];
  const total = isObject
    ? input.printedSetTotal ?? input.printedTotal ?? input.total ?? input.normalizedTotal ?? rawParts[1]
    : rawParts[1];
  const numberVariants = createCollectorSearchVariants(number, index.collectorPrefixes);
  const totalVariants = createCollectorSearchVariants(total, index.collectorPrefixes);
  if (!numberVariants.length) return null;
  // The production extractor expands ambiguous OCR into separate corrected
  // objects. Compare its retained raw match with the selected expansion so the
  // fusion layer never mistakes a repaired value for literal exact OCR.
  const rawNumber = normalizeTrustedCollectorPart(rawParts[0]);
  const rawTotal = normalizeTrustedCollectorPart(rawParts[1]);
  const selectedNumber = normalizeTrustedCollectorPart(number);
  const selectedTotal = normalizeTrustedCollectorPart(total);
  const inputCorrections = [];
  if (rawNumber && selectedNumber && rawNumber !== selectedNumber) {
    inputCorrections.push(`${rawNumber}->${selectedNumber}`);
  }
  if (rawTotal && selectedTotal && rawTotal !== selectedTotal) {
    inputCorrections.push(`${rawTotal}->${selectedTotal}`);
  }
  return {
    raw: raw || `${number}${total ? `/${total}` : ""}`,
    sourcePass: isObject ? input.sourcePass || null : null,
    numberVariants,
    totalVariants,
    inputCorrections,
  };
}

function collectorPrefix(value) {
  return value.match(/^[A-Z]+/)?.[0] || "";
}

function isNearCollectorNumber(left, right) {
  return collectorPrefix(left) === collectorPrefix(right)
    && Math.abs(left.length - right.length) <= 1
    && editDistance(left, right) === 1;
}

function collectCollectorMatches(index, evidence, options, nameCardIndices = new Set()) {
  const matches = new Map();
  const queries = [];
  let pairMatchCount = 0;
  let nearMatchCount = 0;
  const hasNameMatches = nameCardIndices.size > 0;

  for (const input of collectCollectorInputs(evidence)) {
    const query = parseCollectorInput(input, index);
    if (!query) continue;
    let queryPairMatches = 0;
    for (const numberVariant of query.numberVariants) {
      for (const totalVariant of query.totalVariants) {
        const cardIndices = index.byCollectorPair.get(pairKey(numberVariant.value, totalVariant.value)) || [];
        if (!cardIndices.length) continue;
        const corrected = query.inputCorrections.length > 0
          || numberVariant.kind !== "exact"
          || totalVariant.kind !== "exact";
        const reason = {
          code: corrected ? "collector-number-total-ocr-corrected" : "collector-number-total-exact",
          family: "collector",
          weight: corrected ? 92 : 100,
          query: `${numberVariant.value}/${totalVariant.value}`,
          sourcePass: query.sourcePass,
          corrections: [...query.inputCorrections, ...numberVariant.corrections, ...totalVariant.corrections],
        };
        for (const cardIndex of cardIndices) addReason(matches, cardIndex, reason);
        queryPairMatches += cardIndices.length;
      }
    }
    pairMatchCount += queryPairMatches;

    if (!queryPairMatches) {
      for (const numberVariant of query.numberVariants) {
        const cardIndices = index.byCollectorNumber.get(numberVariant.value) || [];
        const corrected = query.inputCorrections.length > 0 || numberVariant.kind !== "exact";
        const reason = {
          code: corrected ? "collector-number-ocr-corrected" : "collector-number-exact",
          family: "collector",
          weight: corrected ? 48 : 55,
          query: numberVariant.value,
          sourcePass: query.sourcePass,
          corrections: [...query.inputCorrections, ...numberVariant.corrections],
        };
        for (const cardIndex of cardIndices) addReason(matches, cardIndex, reason);
      }
    }

    // Near-number expansion is bounded by an exact/variant total. It is mainly a
    // rescue path when name evidence can intersect it, or when the exact pair did
    // not exist at all.
    if (options.allowNearCollector !== false && query.totalVariants.length && (hasNameMatches || !queryPairMatches)) {
      const checked = new Set();
      for (const totalVariant of query.totalVariants) {
        for (const cardIndex of index.byPrintedTotal.get(totalVariant.value) || []) {
          if (checked.has(cardIndex)) continue;
          checked.add(cardIndex);
          const card = index.cards[cardIndex];
          const nearVariant = query.numberVariants.find(({ value }) => (
            isNearCollectorNumber(value, card.normalizedCollectorNumber)
          ));
          if (!nearVariant) continue;
          addReason(matches, cardIndex, {
            code: "collector-number-near",
            family: "collector",
            weight: 36,
            query: `${nearVariant.value}/${totalVariant.value}`,
            similarity: 1 - (1 / Math.max(nearVariant.value.length, card.normalizedCollectorNumber.length)),
            sourcePass: query.sourcePass,
          });
          nearMatchCount += 1;
        }
      }
    }

    // A number without a reliable printed total is not strong enough to erase
    // same-name variants. Rescue one-edit collector neighbors only inside the
    // already bounded name pool so a single OCR digit cannot remove the right
    // artwork while unrelated catalog cards do not flood the candidate set.
    if (options.allowNearCollector !== false && !query.totalVariants.length && hasNameMatches) {
      for (const cardIndex of nameCardIndices) {
        const card = index.cards[cardIndex];
        const nearVariant = query.numberVariants.find(({ value }) => (
          isNearCollectorNumber(value, card.normalizedCollectorNumber)
        ));
        if (!nearVariant) continue;
        addReason(matches, cardIndex, {
          code: "collector-number-near",
          family: "collector",
          weight: 36,
          query: nearVariant.value,
          similarity: 1 - (1 / Math.max(nearVariant.value.length, card.normalizedCollectorNumber.length)),
          sourcePass: query.sourcePass,
        });
        nearMatchCount += 1;
      }
    }

    queries.push({
      raw: query.raw,
      sourcePass: query.sourcePass,
      numberVariants: query.numberVariants,
      totalVariants: query.totalVariants,
      pairMatchCount: queryPairMatches,
    });
  }

  return { matches, queries, pairMatchCount, nearMatchCount };
}

function setIdValue(input) {
  if (typeof input === "string" || typeof input === "number") return String(input);
  return String(input?.setId ?? input?.id ?? input?.value ?? "");
}

function collectSetMatches(index, evidence) {
  const matches = new Map();
  const narrowingCardIndices = new Set();
  const setIds = [];
  const seen = new Set();
  for (const input of [...asArray(evidence.setIds), ...asArray(evidence.setId)]) {
    if (typeof input === "object" && input !== null && input.usable === false) continue;
    const setId = setIdValue(input).trim();
    if (!setId || seen.has(setId)) continue;
    seen.add(setId);
    const cardIndices = index.bySetId.get(setId) || [];
    if (!cardIndices.length) continue;
    setIds.push(setId);
    const reliableForNarrowing = typeof input !== "object" || input === null || input.reliable === true;
    for (const cardIndex of cardIndices) {
      addReason(matches, cardIndex, {
        code: reliableForNarrowing ? "set-exact" : "set-support",
        family: "set",
        weight: reliableForNarrowing ? 25 : 12,
        setId,
      });
      if (reliableForNarrowing) narrowingCardIndices.add(cardIndex);
    }
  }
  return { matches, narrowingCardIndices, setIds };
}

function intersection(left, right) {
  const output = new Set();
  for (const value of left) if (right.has(value)) output.add(value);
  return output;
}

function union(left, right) {
  return new Set([...left, ...right]);
}

function reasonsFor(cardIndex, ...maps) {
  const reasons = new Map();
  for (const map of maps) {
    for (const reason of map.get(cardIndex)?.values() || []) reasons.set(reasonKey(reason), reason);
  }
  return [...reasons.values()].sort((left, right) => (right.weight || 0) - (left.weight || 0)
    || left.code.localeCompare(right.code));
}

function evidenceScore(reasons) {
  const bestByFamily = new Map();
  for (const reason of reasons) {
    bestByFamily.set(reason.family, Math.max(bestByFamily.get(reason.family) || 0, reason.weight || 0));
  }
  return [...bestByFamily.values()].reduce((sum, value) => sum + value, 0);
}

/**
 * Narrows the complete catalog without ever inventing or rewriting a trusted ID.
 * If OCR has no usable match, every catalog card is returned for visual search.
 */
export function buildCatalogCandidates(index, evidence = {}, options = {}) {
  if (!index?.cards || !index?.nameGroups) throw new TypeError("A catalog candidate index is required");

  const nameResult = collectNameMatches(index, evidence, options);
  const nameSet = new Set(nameResult.matches.keys());
  const collectorResult = collectCollectorMatches(index, evidence, options, nameSet);
  const setResult = collectSetMatches(index, evidence);
  const collectorSet = new Set(collectorResult.matches.keys());
  const setSet = new Set(setResult.matches.keys());
  const setNarrowingSet = setResult.narrowingCardIndices;

  let selected = new Set();
  let mode = "full-catalog-fallback";
  let evidenceConflict = false;
  let setNarrowed = false;

  if (nameSet.size && collectorSet.size) {
    const shared = intersection(nameSet, collectorSet);
    if (shared.size) {
      selected = shared;
      mode = "number-name-intersection";
    } else {
      // Conflicting OCR channels both remain searchable; the visual embedder and
      // fusion stage can resolve which channel was wrong.
      selected = union(nameSet, collectorSet);
      mode = "ocr-evidence-union";
      evidenceConflict = true;
    }
  } else if (collectorSet.size) {
    selected = collectorSet;
    mode = collectorResult.pairMatchCount ? "collector-number-total" : "collector-number";
  } else if (nameSet.size) {
    selected = nameSet;
    mode = nameResult.fuzzyGroupCount ? "fuzzy-name" : "exact-name";
  }

  if (selected.size && setNarrowingSet.size) {
    const shared = intersection(selected, setNarrowingSet);
    if (shared.size) {
      const sizeBeforeSet = selected.size;
      selected = shared;
      setNarrowed = shared.size < sizeBeforeSet;
    }
  } else if (!selected.size && setNarrowingSet.size) {
    selected = setNarrowingSet;
    mode = "set-only";
  }

  const usedFullCatalogFallback = selected.size === 0;
  if (usedFullCatalogFallback) selected = new Set(index.cards.map((_, cardIndex) => cardIndex));

  const candidates = [...selected].map((cardIndex) => {
    const card = index.cards[cardIndex];
    const reasons = usedFullCatalogFallback
      ? FULL_CATALOG_REASONS
      : reasonsFor(cardIndex, collectorResult.matches, nameResult.matches, setResult.matches);
    return {
      cardIndex,
      ...card,
      evidenceScore: evidenceScore(reasons),
      reasons,
    };
  }).sort((left, right) => right.evidenceScore - left.evidenceScore || left.cardId.localeCompare(right.cardId));

  return {
    mode,
    usedFullCatalogFallback,
    evidenceConflict,
    query: {
      names: nameResult.queries,
      collectorNumbers: collectorResult.queries,
      setIds: setResult.setIds,
    },
    candidates,
    candidateIds: candidates.map(({ cardId }) => cardId),
    stats: {
      catalogSize: index.cards.length,
      candidateCount: candidates.length,
      nameCandidateCount: nameSet.size,
      collectorCandidateCount: collectorSet.size,
      collectorPairMatchCount: collectorResult.pairMatchCount,
      nearCollectorMatchCount: collectorResult.nearMatchCount,
      setCandidateCount: setSet.size,
      fuzzyNameGroupCount: nameResult.fuzzyGroupCount,
      fuzzyQueriesUsed: nameResult.fuzzyQueriesUsed,
      fuzzyScannedGroupCount: nameResult.fuzzyScannedGroupCount,
      setNarrowed,
    },
  };
}
