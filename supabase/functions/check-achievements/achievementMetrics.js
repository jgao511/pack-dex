export const VALUE_MILESTONES = [
  ["value_10", 10],
  ["value_100", 100],
  ["value_500", 500],
];

export const SET_MASTERY_MILESTONES = [
  ["first_set_complete", 1],
  ["sets_complete_5", 5],
];

function safeNonnegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function createAchievementCandidate(userId, achievementId, category, current, target) {
  const iconKey = category === "packs"
    ? "pack"
    : category === "value"
      ? "dollar"
      : category === "set_mastery"
        ? "trophy"
        : category === "special"
          ? "chase"
          : "binder";

  return {
    achievement_id: achievementId,
    scope_type: "global",
    scope_key: "global",
    award_key: ["account", userId, achievementId, "global"].join("::"),
    metadata: {
      category,
      icon_key: iconKey,
      progress_current: current,
      progress_target: target,
      progress_percent: Math.min(100, Math.floor((current / target) * 100)),
    },
    source: "edge:check-achievements-incremental",
  };
}

export function getReachedMilestoneIds(milestones, current) {
  const safeCurrent = safeNonnegativeNumber(current);
  return milestones
    .filter(([, target]) => safeCurrent >= target)
    .map(([achievementId]) => achievementId);
}

export function makeProgressRows(milestones, current, category, sourceTable) {
  const safeCurrent = safeNonnegativeNumber(current);
  return milestones.map(([achievementId, progressTarget]) => ({
    achievementId,
    category,
    progressCurrent: safeCurrent,
    progressTarget,
    progressPercent: progressTarget > 0
      ? Math.min(100, Math.max(0, Math.floor((safeCurrent / progressTarget) * 100)))
      : 0,
    sourceTable,
  }));
}

export function calculateEstimatedCollectionValue(collectionRows = [], priceRows = []) {
  const prices = new Map();

  priceRows.forEach((row) => {
    const marketPrice = safeNonnegativeNumber(row?.market_price_usd);
    if (!marketPrice || !row?.card_id) return;
    prices.set(String(row.card_id), marketPrice);
  });

  return collectionRows.reduce((total, row) => {
    const quantity = safeNonnegativeNumber(row?.quantity);
    if (!quantity || !row?.card_id) return total;
    const marketPrice = prices.get(String(row.card_id)) || 0;
    return total + marketPrice * quantity;
  }, 0);
}

export function calculateCompletedSetCount(collectionRows = [], setCatalog = []) {
  const ownedBySet = new Map();

  collectionRows.forEach((row) => {
    if (safeNonnegativeNumber(row?.quantity) <= 0 || !row?.set_id || !row?.card_id) return;
    const setId = String(row.set_id);
    if (!ownedBySet.has(setId)) ownedBySet.set(setId, new Set());
    ownedBySet.get(setId).add(String(row.card_id));
  });

  return setCatalog.reduce((completed, set) => {
    const requiredCardIds = Array.isArray(set?.requiredCardIds) ? set.requiredCardIds : [];
    const ownedCardIds = ownedBySet.get(String(set?.setId || ""));
    if (!ownedCardIds || requiredCardIds.length === 0) return completed;
    return requiredCardIds.every((cardId) => ownedCardIds.has(String(cardId))) ? completed + 1 : completed;
  }, 0);
}
