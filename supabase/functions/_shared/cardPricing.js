// Scheduled syncs run every other day. Seven days tolerates three missed runs;
// after that the price is unavailable while the canonical marketplace identity remains.
export const TRUSTED_PRICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const REGULAR_PRICE_TYPES = ["normal", "holofoil", "reverseHolofoil"];
const INHERENT_HOLO_RARITY = /(?:holo|classic collection|double rare|ultra rare|secret rare|rare secret|illustration rare|hyper rare|amazing rare|radiant rare|shiny rare|ace spec|prism star|rare prime|rare break|legend)/i;

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

function isModeledBucket(bucket) {
  if (!bucket || typeof bucket !== "object") return false;
  return ["market", "low", "mid", "high", "directLow"].some((key) => bucket[key] != null);
}

export function selectTcgplayerPrice(apiCard, appCard) {
  const prices = apiCard?.tcgplayer?.prices || {};
  const modeledPriceTypes = REGULAR_PRICE_TYPES.filter((priceType) => isModeledBucket(prices[priceType]));
  const expectedPriceType = inferPrintingFinish(appCard, apiCard);
  const explicitPriceType = compactText(appCard?.tcgplayerPriceType || appCard?.priceFinish);

  const select = (priceType, reason) => {
    const price = prices[priceType];
    if (positiveNumber(price?.market) == null) {
      return { priceType: null, price: null, reason: "no_positive_market", expectedPriceType, modeledPriceTypes };
    }
    return { priceType, price, reason, expectedPriceType, modeledPriceTypes };
  };

  if (explicitPriceType) {
    if (REGULAR_PRICE_TYPES.includes(explicitPriceType) && modeledPriceTypes.includes(explicitPriceType)) {
      return select(explicitPriceType, "explicit_catalog_finish");
    }
    return { priceType: null, price: null, reason: "explicit_finish_missing", expectedPriceType, modeledPriceTypes };
  }
  if (expectedPriceType === "holofoil" && modeledPriceTypes.includes("holofoil")) {
    return select("holofoil", "rarity_evidence");
  }
  if (expectedPriceType === "holofoil") {
    return { priceType: null, price: null, reason: "expected_holofoil_missing", expectedPriceType, modeledPriceTypes };
  }
  if (expectedPriceType === "normal" && modeledPriceTypes.includes("normal")) {
    return select("normal", "rarity_evidence");
  }
  if (expectedPriceType === "normal") {
    return { priceType: null, price: null, reason: "expected_normal_missing", expectedPriceType, modeledPriceTypes };
  }
  if (expectedPriceType === "rare-era-dependent" && modeledPriceTypes.includes("normal")) {
    return select("normal", "rare_normal_printing");
  }
  if (expectedPriceType === "rare-era-dependent" && modeledPriceTypes.includes("holofoil")) {
    return select("holofoil", "rare_holo_printing");
  }
  if (expectedPriceType === "rare-era-dependent") {
    return { priceType: null, price: null, reason: "rare_finish_unproven", expectedPriceType, modeledPriceTypes };
  }
  const nonReverseModeledTypes = modeledPriceTypes.filter((priceType) => priceType !== "reverseHolofoil");
  if (nonReverseModeledTypes.length === 1 && modeledPriceTypes.length === 1) {
    return select(modeledPriceTypes[0], "single_modeled_variant");
  }
  if (modeledPriceTypes.length === 0) {
    return { priceType: null, price: null, reason: "no_tcgplayer_price_bucket", expectedPriceType, modeledPriceTypes };
  }
  return { priceType: null, price: null, reason: "ambiguous_variant", expectedPriceType, modeledPriceTypes };
}

export function buildMarketplaceRow(set, appCard, apiCard, selection, syncedAt = new Date().toISOString()) {
  const selectedPrice = selection?.price || null;
  return {
    card_id: compactText(apiCard?.id),
    set_id: compactText(set?.id),
    card_number: compactText(appCard?.number || apiCard?.number) || null,
    name: compactText(apiCard?.name || appCard?.name) || null,
    rarity: compactText(apiCard?.rarity || appCard?.rarity) || null,
    price_type: selection?.priceType || null,
    market_price_usd: positiveNumber(selectedPrice?.market),
    low_price_usd: positiveNumber(selectedPrice?.low),
    mid_price_usd: positiveNumber(selectedPrice?.mid),
    high_price_usd: positiveNumber(selectedPrice?.high),
    direct_low_price_usd: positiveNumber(selectedPrice?.directLow),
    tcgplayer_url: compactText(apiCard?.tcgplayer?.url) || null,
    source_updated_at: compactText(apiCard?.tcgplayer?.updatedAt) || null,
    synced_at: syncedAt,
  };
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
  if (currentRow.tcgplayer_url || !isCanonicalMarketplaceUrl(previousRow.tcgplayer_url)) return currentRow;
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
