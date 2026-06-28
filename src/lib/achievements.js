import { getRarityCategory, isActualEnergyCard } from "../utils/packGenerator.js";

export const ACHIEVEMENT_ERAS = {
  VINTAGE: "vintage",
  MIDDLE: "middle",
  MODERN: "modern",
  UNKNOWN: "unknown",
};

export const ACHIEVEMENT_ADMIN_OVERRIDES = {
  chaseCardsBySetId: {},
  specialTagsByCardKey: {},
};

const VINTAGE_ACHIEVEMENT_SET_IDS = new Set([
  "base-set",
  "jungle",
  "fossil",
  "base-set-2",
  "team-rocket",
  "gym-heroes",
  "gym-challenge",
  "neo-genesis",
  "neo-discovery",
  "neo-revelation",
  "neo-destiny",
  "legendary-collection",
  "expedition-base-set",
  "aquapolis",
  "skyridge",
  "ex-ruby-sapphire",
  "ex-sandstorm",
  "ex-dragon",
  "ex-team-magma-vs-team-aqua",
  "ex-hidden-legends",
  "ex-firered-leafgreen",
  "ex-team-rocket-returns",
  "ex-deoxys",
  "ex-emerald",
  "ex-unseen-forces",
  "ex-delta-species",
  "ex-legend-maker",
  "ex-holon-phantoms",
  "ex-crystal-guardians",
  "ex-dragon-frontiers",
  "ex-power-keepers",
]);

const MIDDLE_ACHIEVEMENT_SET_IDS = new Set([
  "diamond-pearl",
  "diamond-pearl-mysterious-treasures",
  "diamond-pearl-secret-wonders",
  "diamond-pearl-great-encounters",
  "diamond-pearl-majestic-dawn",
  "diamond-pearl-legends-awakened",
  "diamond-pearl-stormfront",
  "platinum",
  "platinum-rising-rivals",
  "platinum-supreme-victors",
  "platinum-arceus",
  "heartgold-soulsilver",
  "hs-unleashed",
  "hs-undaunted",
  "hs-triumphant",
  "call-of-legends",
  "black-white",
  "black-white-emerging-powers",
  "black-white-noble-victories",
  "black-white-next-destinies",
  "black-white-dark-explorers",
  "black-white-dragons-exalted",
  "black-white-boundaries-crossed",
  "black-white-plasma-storm",
  "black-white-plasma-freeze",
  "black-white-plasma-blast",
  "black-white-legendary-treasures",
  "dragon-vault",
  "xy0",
  "xy1",
  "xy2",
  "xy3",
  "xy4",
  "xy5",
  "dc1",
  "xy6",
  "xy7",
  "xy8",
  "xy9",
  "g1",
  "xy10",
  "xy11",
  "xy12",
]);

const REAL_HIT_CATEGORIES = new Set([
  "holoRare",
  "gx",
  "pokemonV",
  "vmaxOrVstar",
  "doubleRare",
  "breakRare",
  "ultraRare",
  "fullArt",
  "illustrationRare",
  "specialIllustrationRare",
  "rainbowRare",
  "secretRare",
  "hyperRare",
  "alternateArt",
  "shinyRare",
  "shinyUltraRare",
  "trainerGallery",
  "galarianGallery",
  "classicCollection",
  "radiantRare",
  "aceSpecRare",
  "blackWhiteRare",
  "victiniRare",
  "megaDoubleRare",
  "megaHyperRare",
  "futuristicRare",
  "classic",
]);

const MAJOR_HIT_CATEGORIES = new Set([
  "ultraRare",
  "fullArt",
  "illustrationRare",
  "specialIllustrationRare",
  "rainbowRare",
  "secretRare",
  "hyperRare",
  "alternateArt",
  "shinyUltraRare",
  "trainerGallery",
  "galarianGallery",
  "classicCollection",
  "radiantRare",
  "aceSpecRare",
  "blackWhiteRare",
  "victiniRare",
  "megaHyperRare",
  "futuristicRare",
  "classic",
]);

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSetId(setOrId = "") {
  return typeof setOrId === "string" ? setOrId : String(setOrId?.id || "");
}

function getCardId(card = {}, setOrId = "") {
  if (card?.id) return String(card.id);

  return [getSetId(setOrId), card?.number || "unknown", card?.name || "card"].filter(Boolean).join("-");
}

export function getAchievementCardKey(card, setOrId = "") {
  return `${getSetId(setOrId)}::${getCardId(card, setOrId)}`;
}

export function mergeAchievementOverrides(overrides = {}) {
  return {
    chaseCardsBySetId: {
      ...ACHIEVEMENT_ADMIN_OVERRIDES.chaseCardsBySetId,
      ...(overrides.chaseCardsBySetId || {}),
    },
    specialTagsByCardKey: {
      ...ACHIEVEMENT_ADMIN_OVERRIDES.specialTagsByCardKey,
      ...(overrides.specialTagsByCardKey || {}),
    },
  };
}

export function getAchievementScope({ user, guestId = "guest" } = {}) {
  if (user?.id) return { type: "account", ownerId: String(user.id) };

  return { type: "guest", ownerId: String(guestId || "guest") };
}

export function canAwardAccountAchievement(user, expectedUserId = "") {
  if (!user?.id) return false;
  if (!expectedUserId) return true;

  return String(user.id) === String(expectedUserId);
}

export function getAchievementAwardKey({ achievementId, scope, eventKey = "" } = {}) {
  const safeScope = scope?.type && scope?.ownerId ? scope : getAchievementScope();

  return [safeScope.type, safeScope.ownerId, achievementId, eventKey].filter(Boolean).map(String).join("::");
}

export function hasAlreadyAwarded(existingAwardKeys = new Set(), awardKey = "") {
  if (!awardKey) return true;

  return existingAwardKeys instanceof Set ? existingAwardKeys.has(awardKey) : existingAwardKeys.includes?.(awardKey);
}

export function shouldAwardAchievement({ user, expectedUserId = "", existingAwardKeys, awardKey } = {}) {
  if (expectedUserId && !canAwardAccountAchievement(user, expectedUserId)) return false;

  return !hasAlreadyAwarded(existingAwardKeys, awardKey);
}

export function getAchievementEra(setOrId = "") {
  const setId = getSetId(setOrId);

  if (VINTAGE_ACHIEVEMENT_SET_IDS.has(setId)) return ACHIEVEMENT_ERAS.VINTAGE;
  if (MIDDLE_ACHIEVEMENT_SET_IDS.has(setId)) return ACHIEVEMENT_ERAS.MIDDLE;
  if (setId || setOrId?.releaseDate || setOrId?.era) return ACHIEVEMENT_ERAS.MODERN;

  return ACHIEVEMENT_ERAS.UNKNOWN;
}

export function getValidMarketPriceUsd(priceOrRow) {
  const rawValue =
    typeof priceOrRow === "number" || typeof priceOrRow === "string"
      ? priceOrRow
      : priceOrRow?.market_price_usd ?? priceOrRow?.marketPriceUsd ?? null;
  const value = Number(rawValue);

  return Number.isFinite(value) && value > 0 ? value : null;
}

export function hasValidMarketPrice(priceOrRow) {
  return getValidMarketPriceUsd(priceOrRow) != null;
}

export function getAchievementRarityCategory(card, set = {}) {
  return card?.rarityCategory || card?.pullCategory || getRarityCategory(card, set);
}

export function isRegularRare(card, set = {}) {
  return !isActualEnergyCard(card) && getAchievementRarityCategory(card, set) === "rare";
}

export function isRarePlus(card, set = {}) {
  return !isActualEnergyCard(card) && REAL_HIT_CATEGORIES.has(getAchievementRarityCategory(card, set));
}

export function isMajorHit(card, set = {}) {
  return !isActualEnergyCard(card) && MAJOR_HIT_CATEGORIES.has(getAchievementRarityCategory(card, set));
}

export function getAchievementSpecialTags(card, set = {}, overrides = {}) {
  const category = getAchievementRarityCategory(card, set);
  const rarityText = normalizeText(`${card?.rarity || ""} ${category || ""} ${card?.name || ""}`);
  const tags = new Set();

  if (rarityText.includes("gold")) tags.add("gold");
  if (category === "rainbowRare" || rarityText.includes("rainbow")) tags.add("rainbow");
  if (category === "fullArt" || rarityText.includes("full art")) tags.add("fullArt");
  if (["secretRare", "hyperRare", "rainbowRare", "megaHyperRare"].includes(category) || rarityText.includes("secret")) tags.add("secret");
  if (["illustrationRare", "specialIllustrationRare"].includes(category) || rarityText.includes("illustration rare")) tags.add("illustrationRare");
  if (category === "specialIllustrationRare") tags.add("specialIllustrationRare");

  const mergedOverrides = mergeAchievementOverrides(overrides);
  const overrideTags = mergedOverrides.specialTagsByCardKey[getAchievementCardKey(card, set)] || [];

  overrideTags.forEach((tag) => tags.add(String(tag)));
  return [...tags];
}

function getPriceForCard(card, set, priceMapOrRows) {
  if (!priceMapOrRows) return null;

  const candidateKeys = [
    card?.id,
    card?.card_id,
    card?.tcgplayerId,
    card?.pokemonTcgId,
    card?.apiId,
    getAchievementCardKey(card, set),
  ]
    .filter(Boolean)
    .map(String);

  if (priceMapOrRows instanceof Map) {
    for (const key of candidateKeys) {
      const row = priceMapOrRows.get(key);
      if (hasValidMarketPrice(row)) return row;
    }
    return null;
  }

  if (Array.isArray(priceMapOrRows)) {
    return priceMapOrRows.find((row) => {
      if (!hasValidMarketPrice(row)) return false;
      const rowKeys = [row.card_id, row.cardId, getAchievementCardKey(row, row.set_id || row.setId || set)].filter(Boolean).map(String);
      return rowKeys.some((key) => candidateKeys.includes(key));
    }) || null;
  }

  return null;
}

export function getDefaultChaseCard(set, priceMapOrRows, overrides = {}) {
  if (!set?.id || !Array.isArray(set.cards)) return null;

  const mergedOverrides = mergeAchievementOverrides(overrides);
  const overrideCardId = mergedOverrides.chaseCardsBySetId[set.id];

  if (overrideCardId) {
    return set.cards.find((card) => String(card.id || card.number || "") === String(overrideCardId)) || null;
  }

  return set.cards.reduce((best, card) => {
    const priceRow = getPriceForCard(card, set, priceMapOrRows);
    const marketPriceUsd = getValidMarketPriceUsd(priceRow);

    if (marketPriceUsd == null) return best;
    if (!best || marketPriceUsd > best.marketPriceUsd) return { card, priceRow, marketPriceUsd };

    return best;
  }, null);
}

export function getBinderPages(binder, pageSize = 9) {
  const cards = Array.isArray(binder?.cards) ? [...binder.cards].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  const pages = [];

  for (let index = 0; index < cards.length; index += pageSize) {
    pages.push(cards.slice(index, index + pageSize));
  }

  return pages;
}

export function isCleanBinderPage(pageCards = []) {
  const uniqueIds = new Set(pageCards.map((item) => item?.cardId || item?.card_id || item?.key).filter(Boolean));

  return pageCards.length === 9 && uniqueIds.size === 9;
}

export function isHitBinderPage(pageCards = [], cardsByKey = new Map(), setsById = new Map()) {
  if (!isCleanBinderPage(pageCards)) return false;

  return pageCards.every((item) => {
    const card = item.card || cardsByKey.get(item.key) || cardsByKey.get(item.cardId);
    const set = item.set || setsById.get(item.setId);

    return card && isRarePlus(card, set);
  });
}

export function isSameCardAgainEligible(card, set = {}) {
  return isRegularRare(card, set) || isRarePlus(card, set);
}

export function hasSameCardAgainCount(collectionEntry, count = 5) {
  return Number(collectionEntry?.count || 0) >= count;
}