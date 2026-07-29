import { getRarityRank } from "../../../src/utils/rarityRank.js";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function cardNumberValue(card) {
  const match = String(card?.number || "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

export const BINDER_ERA_FILTERS = [
  "All",
  "Mega Evolution",
  "Scarlet & Violet",
  "Sword & Shield",
  "Sun & Moon",
  "XY",
  "Older",
];

export function sortSetsByRelease(setList, order = "newest") {
  const direction = order === "oldest" ? 1 : -1;

  return [...(setList || [])].sort((left, right) => {
    const dateComparison = String(left?.releaseDate || "").localeCompare(String(right?.releaseDate || ""));
    if (dateComparison !== 0) return dateComparison * direction;
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
}

export function matchesBinderEra(set, era) {
  if (!era || era === "All") return true;
  if (era === "Older") {
    return !["Mega Evolution", "Scarlet & Violet", "Sword & Shield", "Sun & Moon", "XY"].includes(set?.era);
  }
  return set?.era === era;
}

export function filterBinderSets(setList, { query = "", era = "All", order = "newest" } = {}) {
  const search = normalize(query);

  return sortSetsByRelease(setList, order).filter((set) => {
    if (!matchesBinderEra(set, era)) return false;
    if (!search) return true;

    const searchText = normalize([
      set?.name,
      set?.id,
      set?.code,
      set?.pokemonTcgApiSetId,
      set?.era,
      set?.series,
    ].join(" "));

    return searchText.includes(search);
  });
}

export function getOwnedBinderCards(setList, collection, getCards, getCount, getBinderKey) {
  return (setList || []).flatMap((set) =>
    (getCards(set) || [])
      .map((card) => {
        const quantity = getCount(collection, card, set.id);
        const entry = collection?.[set.id]?.[String(card?.id || card?.number || "")];

        return quantity > 0
          ? {
              key: getBinderKey
                ? getBinderKey(card, set.id)
                : `${set.id}::${String(card?.id || card?.number || card?.name || "")}`,
              set,
              card,
              quantity,
              lastCollectedAt: Number(entry?.lastCollectedAt || entry?.firstCollectedAt || 0),
            }
          : null;
      })
      .filter(Boolean)
  );
}

export function sortBinderRarities(ownedCards) {
  const rarityRanks = new Map();

  (ownedCards || []).forEach((item) => {
    const rarity = String(item.card?.rarity || "").trim();
    if (!rarity) return;
    const rank = getRarityRank(item.card, item.set);
    rarityRanks.set(rarity, Math.min(rank, rarityRanks.get(rarity) ?? Number.MAX_SAFE_INTEGER));
  });

  return [...rarityRanks.keys()].sort((left, right) =>
    rarityRanks.get(left) - rarityRanks.get(right) || left.localeCompare(right)
  );
}

export function filterOwnedBinderCards(
  ownedCards,
  { query = "", era = "All", setId = "All", rarity = "All", sort = "set-order" } = {}
) {
  const search = normalize(query);
  const filtered = (ownedCards || []).filter((item) => {
    if (!matchesBinderEra(item.set, era)) return false;
    if (setId !== "All" && item.set?.id !== setId) return false;
    if (rarity !== "All" && item.card?.rarity !== rarity) return false;
    if (!search) return true;
    return normalize(`${item.card?.name} ${item.card?.number} ${item.set?.name} ${item.set?.id}`).includes(search);
  });

  return [...filtered].sort((left, right) => {
    if (sort === "name") {
      return String(left.card?.name || "").localeCompare(String(right.card?.name || "")) ||
        cardNumberValue(left.card) - cardNumberValue(right.card);
    }
    if (sort === "rarity") {
      return getRarityRank(left.card, left.set) - getRarityRank(right.card, right.set) ||
        String(left.card?.name || "").localeCompare(String(right.card?.name || ""));
    }
    if (sort === "recent") {
      return right.lastCollectedAt - left.lastCollectedAt ||
        String(left.card?.name || "").localeCompare(String(right.card?.name || ""));
    }

    const dateComparison = String(right.set?.releaseDate || "").localeCompare(String(left.set?.releaseDate || ""));
    return dateComparison ||
      String(left.set?.name || "").localeCompare(String(right.set?.name || "")) ||
      cardNumberValue(left.card) - cardNumberValue(right.card) ||
      String(left.card?.number || "").localeCompare(String(right.card?.number || ""));
  });
}
