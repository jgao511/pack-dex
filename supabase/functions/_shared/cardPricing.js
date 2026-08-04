// Scheduled syncs run every other day. Seven days tolerates three missed runs;
// after that the price is unavailable while the canonical marketplace identity remains.
export const TRUSTED_PRICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const REVERSE_PRICE_TYPE = "reverseHolofoil";
const INHERENT_HOLO_RARITY = /(?:holo|classic collection|double rare|ultra rare|secret rare|rare secret|illustration rare|hyper rare|amazing rare|radiant rare|shiny rare|ace spec|prism star|rare prime|rare break|legend)/i;
const SINGLE_PRINTING_SPECIAL_RARITY = /(?:classic collection|double rare|ultra rare|secret rare|rare secret|illustration rare|hyper rare|amazing rare|radiant rare|shiny rare|ace spec|prism star|rare holo (?:star|ex|gx|v|max|vstar)|rare prime|rare break|legend|trainer gallery|galarian gallery)/i;

export function compactText(value) {
  return String(value ?? "").trim();
}

export function positiveNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

export function normalizeCollectorNumber(value) {
  const raw = compactText(value).replace(/^#+\s*/u, "").toLowerCase();
  if (!raw) return "";

  const normalizePart = (part) => {
    const match = part.trim().match(/^([a-z]*?)0*(\d+)([a-z]*)$/iu);
    return match ? `${match[1]}${Number.parseInt(match[2], 10)}${match[3]}` : part.trim();
  };
  return raw.split("/").map(normalizePart).join("/");
}

export function getCollectorNumberAliases(value) {
  const strict = normalizeCollectorNumber(value);
  if (!strict) return [];
  const aliases = new Set([strict]);
  const [numerator, denominator, ...extra] = strict.split("/");
  if (denominator && extra.length === 0) {
    // Only name-backed matching may use these documented subset conventions.
    // Plain numeric denominators remain meaningful and are never discarded.
    const prefix = numerator.match(/^([a-z]+)\d+[a-z]*$/iu)?.[1] || "";
    const denominatorPrefix = denominator.match(/^([a-z]+)\d+[a-z]*$/iu)?.[1] || "";
    if (prefix && prefix === denominatorPrefix && ["h", "sh", "sv", "tg", "gg"].includes(prefix)) aliases.add(numerator);
  }
  return [...aliases];
}

export function collectorNumbersDescribeSamePrinting(left, right) {
  const normalizedLeft = normalizeCollectorNumber(left);
  const normalizedRight = normalizeCollectorNumber(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (getCollectorNumberAliases(left).includes(normalizedRight) || getCollectorNumberAliases(right).includes(normalizedLeft)) return true;
  const [leftNumerator, leftDenominator, ...leftExtra] = normalizedLeft.split("/");
  const [rightNumerator, rightDenominator, ...rightExtra] = normalizedRight.split("/");
  return leftNumerator === rightNumerator && leftExtra.length === 0 && rightExtra.length === 0 && Boolean(leftDenominator) !== Boolean(rightDenominator);
}

export function normalizeCanonicalName(value) {
  return compactText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[★⭐]/gu, " star ")
    .replace(/♀/gu, " female ")
    .replace(/♂/gu, " male ")
    .replace(/&/gu, " and ")
    .replace(/[’‘`]/gu, "'")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function append(map, key, value) {
  if (!key) return;
  map.set(key, [...(map.get(key) || []), value]);
}

function uniqueMatch(candidates = []) {
  const unique = [...new Map(candidates.map((card) => [compactText(card?.id || card?.sourceCardId), card])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function getApiCardSetId(apiCard) {
  const embedded = compactText(apiCard?.set?.id);
  if (embedded) return embedded;
  const id = compactText(apiCard?.id);
  return id.includes("-") ? id.slice(0, id.indexOf("-")) : "";
}

export function buildCanonicalCardLookup(cards = []) {
  const byApiId = new Map();
  const bySetNumberName = new Map();
  const bySetNumber = new Map();

  cards.forEach((card) => {
    const sourceSetId = compactText(card?.sourceSetId).toLowerCase();
    const sourceCardId = compactText(card?.sourceCardId).toLowerCase();
    const number = normalizeCollectorNumber(card?.number);
    const name = normalizeCanonicalName(card?.name);

    append(byApiId, sourceCardId, card);
    if (!sourceSetId || !number) return;
    append(bySetNumber, `${sourceSetId}:${number}`, card);
    if (name) getCollectorNumberAliases(card?.number).forEach((alias) => append(bySetNumberName, `${sourceSetId}:${alias}:${name}`, card));
  });

  return { byApiId, bySetNumberName, bySetNumber };
}

export function matchCanonicalCard(apiCard, lookup) {
  const apiCardId = compactText(apiCard?.id).toLowerCase();
  const apiSetId = getApiCardSetId(apiCard).toLowerCase();
  const number = normalizeCollectorNumber(apiCard?.number);
  const name = normalizeCanonicalName(apiCard?.name);

  const exactCandidates = (lookup?.byApiId?.get(apiCardId) || [])
    .filter((card) => !card?.sourceSetId || compactText(card.sourceSetId).toLowerCase() === apiSetId);
  const exact = uniqueMatch(exactCandidates);
  if (exact) return { card: exact, matchType: "api_card_id", ambiguous: false };
  if (exactCandidates.length > 1) return { card: null, matchType: null, ambiguous: true };

  const nameCandidates = getCollectorNumberAliases(apiCard?.number)
    .flatMap((alias) => lookup?.bySetNumberName?.get(`${apiSetId}:${alias}:${name}`) || []);
  const setNumberName = uniqueMatch(nameCandidates);
  if (setNumberName) return { card: setNumberName, matchType: "set_number_name", ambiguous: false };
  if (nameCandidates.length > 1) return { card: null, matchType: null, ambiguous: true };

  const numberCandidates = lookup?.bySetNumber?.get(`${apiSetId}:${number}`) || [];
  const uniqueNumber = uniqueMatch(numberCandidates);
  if (uniqueNumber) return { card: uniqueNumber, matchType: "set_unique_number", ambiguous: false };

  return { card: null, matchType: null, ambiguous: numberCandidates.length > 1 };
}

export function inferPrintingFinish(appCard, apiCard) {
  const rarity = compactText(apiCard?.rarity || appCard?.rarity);
  if (INHERENT_HOLO_RARITY.test(rarity)) return "holofoil";
  if (/^(?:common|uncommon)$/i.test(rarity)) return "normal";
  if (/^rare$/i.test(rarity)) return "rare-era-dependent";
  return null;
}

export function isSinglePrintingSpecialCard(appCard, apiCard) {
  return SINGLE_PRINTING_SPECIAL_RARITY.test(compactText(apiCard?.rarity || appCard?.rarity));
}

export function getVerifiedMarketplaceUrl(appCard) {
  const explicitUrl = compactText(appCard?.verifiedTcgplayerUrl);
  if (explicitUrl) return explicitUrl;
  const productId = compactText(appCard?.verifiedTcgplayerProductId);
  const sourceCardId = compactText(appCard?.sourceCardId);
  if (!productId || !sourceCardId) return "";
  return `https://prices.pokemontcg.io/tcgplayer/${encodeURIComponent(sourceCardId)}`;
}

export function isCanonicalIdentityConsistent(apiCard, appCard) {
  const apiSetId = getApiCardSetId(apiCard).toLowerCase();
  const sourceSetId = compactText(appCard?.sourceSetId).toLowerCase();
  const sourceCardId = compactText(appCard?.sourceCardId).toLowerCase();
  const apiCardId = compactText(apiCard?.id).toLowerCase();
  const verifiedMarketplaceUrl = getVerifiedMarketplaceUrl(appCard);
  const hasAuditedNumberOverride = Boolean(
    appCard?.allowVerifiedNumberOverride === true &&
    compactText(appCard?.verifiedTcgplayerProductId) &&
    verifiedMarketplaceUrl &&
    verifiedMarketplaceUrl === compactText(apiCard?.tcgplayer?.url)
  );
  return Boolean(
    apiCardId &&
    sourceCardId === apiCardId &&
    (!sourceSetId || sourceSetId === apiSetId) &&
    normalizeCanonicalName(appCard?.name) === normalizeCanonicalName(apiCard?.name) &&
    (collectorNumbersDescribeSamePrinting(appCard?.number, apiCard?.number) || hasAuditedNumberOverride)
  );
}

function isModeledBucket(bucket) {
  if (!bucket || typeof bucket !== "object") return false;
  return ["market", "low", "mid", "high", "directLow"].some((key) => bucket[key] != null);
}

export function selectTcgplayerPrice(apiCard, appCard, options = {}) {
  const prices = apiCard?.tcgplayer?.prices || {};
  const modeledPriceTypes = Object.keys(prices).filter((priceType) => isModeledBucket(prices[priceType]));
  const positiveMarketTypes = modeledPriceTypes.filter((priceType) => positiveNumber(prices[priceType]?.market) != null);
  const positiveNonReverseTypes = positiveMarketTypes.filter((priceType) => priceType !== REVERSE_PRICE_TYPE);
  const expectedPriceType = inferPrintingFinish(appCard, apiCard);
  const explicitPriceType = compactText(appCard?.tcgplayerPriceType || appCard?.priceFinish);
  const verifiedFallbackPriceType = compactText(appCard?.verifiedFallbackPriceType);
  const verifiedUrl = getVerifiedMarketplaceUrl(appCard);
  const hasVerifiedExactProduct = Boolean(
    compactText(appCard?.verifiedTcgplayerProductId) &&
    verifiedUrl &&
    verifiedUrl === compactText(apiCard?.tcgplayer?.url)
  );

  const unavailable = (reason) => ({
    priceType: null,
    price: null,
    reason,
    expectedPriceType,
    modeledPriceTypes,
    positiveMarketTypes,
    hasVerifiedExactProduct,
  });

  const select = (priceType, reason) => {
    const price = prices[priceType];
    if (positiveNumber(price?.market) == null) {
      return unavailable("no_positive_market");
    }
    return { priceType, price, reason, expectedPriceType, modeledPriceTypes, positiveMarketTypes, hasVerifiedExactProduct };
  };

  if (options?.requireVerifiedProduct === true && !hasVerifiedExactProduct) {
    return unavailable("marketplace_product_unverified");
  }

  if (explicitPriceType) {
    if (modeledPriceTypes.includes(explicitPriceType)) {
      return select(explicitPriceType, "explicit_catalog_finish");
    }
    return unavailable("explicit_finish_missing");
  }
  if (expectedPriceType === "holofoil" && positiveMarketTypes.includes("holofoil")) {
    return select("holofoil", "rarity_evidence");
  }
  if (expectedPriceType === "holofoil") {
    if (
      isSinglePrintingSpecialCard(appCard, apiCard) &&
      hasVerifiedExactProduct &&
      positiveNonReverseTypes.length === 1 &&
      verifiedFallbackPriceType === positiveNonReverseTypes[0] &&
      ["normal", "holofoil"].includes(positiveNonReverseTypes[0])
    ) {
      return select(positiveNonReverseTypes[0], "single_verified_non_reverse_bucket");
    }
    return unavailable("expected_holofoil_missing");
  }
  if (expectedPriceType === "normal" && positiveMarketTypes.includes("normal")) {
    return select("normal", "rarity_evidence");
  }
  if (expectedPriceType === "normal") {
    return unavailable("expected_normal_missing");
  }
  if (expectedPriceType === "rare-era-dependent") {
    const standardTypes = positiveNonReverseTypes.filter((priceType) => ["normal", "holofoil"].includes(priceType));
    if (standardTypes.length === 1) return select(standardTypes[0], standardTypes[0] === "normal" ? "rare_normal_printing" : "rare_holo_printing");
    return unavailable(standardTypes.length > 1 ? "multiple_non_reverse_ambiguity" : "rare_finish_unproven");
  }
  if (positiveMarketTypes.length === 1 && positiveNonReverseTypes.length === 1 && ["normal", "holofoil"].includes(positiveNonReverseTypes[0])) {
    return select(positiveNonReverseTypes[0], "single_modeled_variant");
  }
  if (modeledPriceTypes.length === 0) {
    return unavailable("no_tcgplayer_price_bucket");
  }
  if (positiveMarketTypes.length === 0) return unavailable("no_positive_market");
  return unavailable(positiveNonReverseTypes.length > 1 ? "multiple_non_reverse_ambiguity" : "ambiguous_variant");
}

export function buildMarketplaceRow(set, appCard, apiCard, selection, syncedAt = new Date().toISOString()) {
  const apiMarketplaceUrl = compactText(apiCard?.tcgplayer?.url);
  const verifiedMarketplaceUrl = getVerifiedMarketplaceUrl(appCard);
  const hasAuditedMarketplaceIdentity = Boolean(compactText(appCard?.verifiedTcgplayerProductId) && verifiedMarketplaceUrl);
  const hasVerifiedMarketplaceIdentity = Boolean(
    hasAuditedMarketplaceIdentity &&
    apiMarketplaceUrl &&
    verifiedMarketplaceUrl === apiMarketplaceUrl
  );
  // Price fields and direct links share one proof boundary. This prevents an
  // incorrect provider redirect from contributing value even if its API card
  // ID otherwise looks canonical.
  const selectedPrice = hasVerifiedMarketplaceIdentity ? selection?.price || null : null;
  const row = {
    card_id: compactText(apiCard?.id),
    set_id: compactText(set?.id),
    card_number: compactText(appCard?.number || apiCard?.number) || null,
    name: compactText(apiCard?.name || appCard?.name) || null,
    rarity: compactText(apiCard?.rarity || appCard?.rarity) || null,
    price_type: hasVerifiedMarketplaceIdentity ? selection?.priceType || null : null,
    market_price_usd: positiveNumber(selectedPrice?.market),
    low_price_usd: positiveNumber(selectedPrice?.low),
    mid_price_usd: positiveNumber(selectedPrice?.mid),
    high_price_usd: positiveNumber(selectedPrice?.high),
    direct_low_price_usd: positiveNumber(selectedPrice?.directLow),
    tcgplayer_url: hasVerifiedMarketplaceIdentity ? apiMarketplaceUrl : null,
    source_updated_at: compactText(apiCard?.tcgplayer?.updatedAt) || null,
    synced_at: syncedAt,
  };
  Object.defineProperty(row, "verifiedMarketplaceUrl", {
    value: hasAuditedMarketplaceIdentity ? verifiedMarketplaceUrl : null,
    enumerable: false,
  });
  return row;
}

export function isCanonicalMarketplaceUrl(value) {
  try {
    const url = new URL(compactText(value));
    return url.protocol === "https:" && url.hostname.toLowerCase() === "prices.pokemontcg.io" && url.pathname.startsWith("/tcgplayer/");
  } catch {
    return false;
  }
}

export function preserveCanonicalMarketplaceIdentity(currentRow, previousRow) {
  if (!currentRow || !previousRow || compactText(currentRow.card_id) !== compactText(previousRow.card_id)) return currentRow;
  const verifiedMarketplaceUrl = compactText(currentRow.verifiedMarketplaceUrl);
  if (
    currentRow.tcgplayer_url ||
    !verifiedMarketplaceUrl ||
    verifiedMarketplaceUrl !== compactText(previousRow.tcgplayer_url) ||
    !isCanonicalMarketplaceUrl(previousRow.tcgplayer_url)
  ) return currentRow;
  return {
    ...currentRow,
    tcgplayer_url: previousRow.tcgplayer_url,
    source_updated_at: currentRow.source_updated_at || previousRow.source_updated_at || null,
  };
}

export function isTrustedCurrentPriceRow(row, now = Date.now(), maxAgeMs = TRUSTED_PRICE_MAX_AGE_MS) {
  if (positiveNumber(row?.market_price_usd ?? row?.marketPriceUsd) == null) return false;
  const syncedAt = Date.parse(row?.synced_at || row?.syncedAt || "");
  return Number.isFinite(syncedAt) && syncedAt <= now && now - syncedAt <= maxAgeMs;
}
