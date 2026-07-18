import { getCardCollectionKey, getCardCount, getPullableCollectionCards } from "../../../src/utils/collectionStorage.js";

export function isSetOpenable(set) {
  return Boolean(
    set
      && getPullableCollectionCards(set).length > 0
      && set.pullRateProfile
      && set.isAvailable !== false
      && set.isLocked !== true
      && set.access !== "locked"
  );
}

function compareNewest(a, b) {
  return String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""))
    || Number(Boolean(b.isNew)) - Number(Boolean(a.isNew))
    || String(a.name).localeCompare(String(b.name));
}

function getSignals(set, collection, wishlistKeys) {
  const cards = getPullableCollectionCards(set);
  let owned = 0;
  let quantity = 0;
  let wishlistCount = 0;
  let lastOpenedAt = 0;
  for (const card of cards) {
    const count = getCardCount(collection, card, set.id);
    if (count > 0) owned += 1;
    quantity += count;
    wishlistCount += Number(wishlistKeys.has(`${set.id}:${card.id}`));
    const entry = collection?.[set.id]?.[getCardCollectionKey(card, set.id)];
    lastOpenedAt = Math.max(lastOpenedAt, Number(entry?.lastCollectedAt || 0));
  }
  const total = cards.length;
  const completion = total ? owned / total : 0;
  return { owned, total, missing: Math.max(0, total - owned), quantity, wishlistCount, completion, openedBefore: owned > 0, lastOpenedAt };
}

function recommendation(category, set, title, reason, score, signals) {
  return { category, setId: set.id, title, reason, score, signals };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildOpenRecommendations({ sets = [], collection = {}, wishlistEntries = [], viewedSetIds = [] } = {}) {
  const openable = sets.filter(isSetOpenable).sort(compareNewest);
  if (!openable.length) return { primary: null, recommendations: [], surprise: null };
  const wishlistKeys = new Set(wishlistEntries.map((entry) => `${entry.setId}:${entry.cardId}`));
  const rows = openable.map((set) => ({ set, signals: getSignals(set, collection, wishlistKeys) }));
  const used = new Set();
  const results = [];
  const add = (candidate) => {
    if (!candidate || used.has(candidate.setId)) return false;
    used.add(candidate.setId);
    results.push(candidate);
    return true;
  };
  const newest = rows[0];
  const hasCollectionSignals = rows.some((row) => row.signals.openedBefore);
  const wishlist = [...rows]
    .filter((row) => row.signals.wishlistCount > 0)
    .sort((a, b) => b.signals.wishlistCount - a.signals.wishlistCount || compareNewest(a.set, b.set))[0];
  const closest = [...rows]
    .filter((row) => row.signals.completion > 0 && row.signals.completion < 1)
    .sort((a, b) => b.signals.completion - a.signals.completion || a.signals.missing - b.signals.missing || compareNewest(a.set, b.set))[0];
  const continueRow = [...rows]
    .filter((row) => row.signals.lastOpenedAt > 0)
    .sort((a, b) => b.signals.lastOpenedAt - a.signals.lastOpenedAt || compareNewest(a.set, b.set))[0];
  const openedEras = new Set(rows.filter((row) => row.signals.openedBefore).map((row) => row.set.era));
  const viewed = new Set(viewedSetIds);
  const newEraCandidates = rows.filter((row) => !openedEras.has(row.set.era) && !viewed.has(row.set.id));
  const discovery = [...rows]
    .filter((row) => row.signals.completion < 0.5)
    .sort((a, b) => a.signals.completion - b.signals.completion || compareNewest(a.set, b.set))[0];

  if (wishlist) add(recommendation("wishlist", wishlist.set, "Most wishlist matches", `This set contains ${wishlist.signals.wishlistCount} card${wishlist.signals.wishlistCount === 1 ? "" : "s"} on your wishlist.`, 0.96, wishlist.signals));
  if (closest) add(recommendation("completion", closest.set, "Closest to completion", `You are ${closest.signals.missing} card${closest.signals.missing === 1 ? "" : "s"} away from completing this set.`, 0.92, closest.signals));
  if (continueRow) add(recommendation("continue", continueRow.set, "Continue your current collection", `You have discovered ${Math.round(continueRow.signals.completion * 100)}% of this set.`, 0.88, continueRow.signals));
  if (!hasCollectionSignals) add(recommendation("latest", newest.set, "Latest set available", `${newest.set.name} is the newest supported set you can open.`, 0.9, newest.signals));
  for (const newEra of newEraCandidates) {
    if (add(recommendation("new-era", newEra.set, "Explore a new era", `You have not opened a ${newEra.set.era} pack yet.`, 0.78, newEra.signals))) break;
  }
  if (discovery) add(recommendation("discovery", discovery.set, "Best for discovering new cards", `You have discovered ${Math.round(discovery.signals.completion * 100)}% of this set's cards.`, 0.74, discovery.signals));
  if (!used.has(newest.set.id)) add(recommendation("latest", newest.set, "Latest set available", `${newest.set.name} is the newest supported set you can open.`, 0.7, newest.signals));

  for (const row of rows) {
    if (results.length >= 4) break;
    add(recommendation("discovery", row.set, "Discover another set", `${row.signals.missing} supported cards are still undiscovered.`, 0.5, row.signals));
  }

  const surpriseSeed = rows.map((row) => `${row.set.id}:${row.signals.owned}:${row.signals.wishlistCount}`).join("|");
  const surpriseRow = rows[stableHash(surpriseSeed) % rows.length];
  return {
    primary: results[0] || null,
    recommendations: results,
    surprise: recommendation("surprise", surpriseRow.set, "Surprise Me", "A deterministic pick from the sets currently available to open.", 0.4, surpriseRow.signals),
  };
}
