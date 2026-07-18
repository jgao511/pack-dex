import { getRarityCategory } from "./packGenerator.js";

const RARITY_RANKS = {
  classic: 1,
  futuristicRare: 2,
  blackWhiteRare: 3,
  megaHyperRare: 5,
  specialIllustrationRare: 10,
  alternateArt: 12,
  hyperRare: 15,
  rainbowRare: 16,
  secretRare: 18,
  fullArt: 24,
  ultraRare: 25,
  shinyUltraRare: 26,
  illustrationRare: 30,
  breakRare: 34,
  shinyRare: 35,
  trainerGallery: 36,
  galarianGallery: 36,
  classicCollection: 36,
  radiantRare: 36,
  aceSpecRare: 36,
  megaDoubleRare: 40,
  vmaxOrVstar: 45,
  pokemonV: 46,
  gx: 46,
  doubleRare: 50,
  pikachu: 55,
  holoRare: 58,
  rare: 60,
  uncommon: 80,
  common: 90,
  other: 100,
};

export function getRarityRank(card, set = {}) {
  const printedRarity = `${card?.rarity || ""} ${card?.name || ""}`.toLowerCase();
  if (printedRarity.includes("mega hyper rare")) return RARITY_RANKS.megaHyperRare;
  return RARITY_RANKS[getRarityCategory(card, set)] ?? RARITY_RANKS.other;
}

export function compareCardsByRarity(a, b, setA = {}, setB = setA) {
  return (
    getRarityRank(a, setA) - getRarityRank(b, setB) ||
    String(a?.name || "").localeCompare(String(b?.name || "")) ||
    String(a?.number || "").localeCompare(String(b?.number || ""))
  );
}

export function selectFeaturedPull(cards = [], set = {}) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  return cards.reduce((best, card, index) => {
    const rank = getRarityRank(card, set);
    if (!best || rank < best.rank || (rank === best.rank && index > best.index)) return { card, index, rank };
    return best;
  }, null);
}
