import setGuides from "../data/explore/setGuides.json" with { type: "json" };
import { getDisplayRarity, getPackSize, getRarityCategory } from "../utils/packGenerator.js";
import { getPullableCollectionCards } from "../utils/collectionStorage.js";

const CATEGORY_ORDER = [
  "common",
  "uncommon",
  "rare",
  "holoRare",
  "doubleRare",
  "ultraRare",
  "illustrationRare",
  "specialIllustrationRare",
  "hyperRare",
  "secretRare",
];

function sentenceCase(value) {
  const text = String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

export function getSetGuide(setOrId) {
  const setId = typeof setOrId === "string" ? setOrId : setOrId?.id;
  return setGuides[setId] || null;
}

// Kept as a catalog utility for checklist/filtering contexts. Public set pages do
// not render this as a standalone editorial breakdown.
export function getSetRaritySummary(set) {
  const cards = getPullableCollectionCards(set);
  const byCategory = new Map();

  cards.forEach((card) => {
    const category = getRarityCategory(card, set) || "other";
    if (!byCategory.has(category)) {
      byCategory.set(category, {
        category,
        label: getDisplayRarity(card, set) || sentenceCase(category),
        count: 0,
      });
    }
    byCategory.get(category).count += 1;
  });

  return [...byCategory.values()].sort((left, right) => {
    const leftIndex = CATEGORY_ORDER.indexOf(left.category);
    const rightIndex = CATEGORY_ORDER.indexOf(right.category);
    if (leftIndex === -1 && rightIndex === -1) return left.label.localeCompare(right.label);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

export function getSimulationDescriptor(set) {
  const packSize = getPackSize(set);
  return {
    packSize,
    profileKey: set?.pullRateProfile || null,
    notes: [
      `A PackDex opening for ${set?.name || "this set"} contains ${packSize} virtual cards. Results do not state official pull rates and should not be used to predict a physical Pokémon TCG pack.`,
    ],
  };
}

export function getSetPublicContent(set) {
  const guide = getSetGuide(set);
  const cards = getPullableCollectionCards(set);

  return {
    guide,
    simulation: getSimulationDescriptor(set),
    supportedCardCount: cards.length,
    printedTotal: set?.printedTotal || null,
    releaseDate: set?.releaseDate || null,
    summary:
      guide?.summary ||
      `Explore ${set?.name || "this set"} in PackDex, open virtual packs, and track a collection across ${cards.length} supported cards from the ${set?.era || "Pokémon TCG"} era.`,
  };
}
