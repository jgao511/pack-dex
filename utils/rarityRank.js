import { getRarityCategory } from "./packGenerator.js";

const RARITY_RANKS = {
  specialIllustrationRare: 10,
  megaHyperRare: 12,
  hyperRare: 14,
  rainbowRare: 16,
  secretRare: 18,
  blackWhiteRare: 20,
  illustrationRare: 24,
  breakRare: 26,
  fullArt: 28,
  ultraRare: 30,
  shinyUltraRare: 32,
  shinyRare: 34,
  trainerGallery: 36,
  galarianGallery: 38,
  classicCollection: 40,
  radiantRare: 42,
  aceSpecRare: 44,
  alternateArt: 46,
  vmaxOrVstar: 48,
  pokemonV: 50,
  gx: 52,
  megaDoubleRare: 54,
  doubleRare: 56,
  holoRare: 60,
  rare: 70,
  uncommon: 80,
  common: 90,
  other: 100,
};

export function getRarityRank(card, set = {}) {
  return RARITY_RANKS[getRarityCategory(card, set)] ?? RARITY_RANKS.other;
}

export function compareCardsByRarity(a, b, setA = {}, setB = setA) {
  return (
    getRarityRank(a, setA) - getRarityRank(b, setB) ||
    String(a?.name || "").localeCompare(String(b?.name || "")) ||
    String(a?.number || "").localeCompare(String(b?.number || ""))
  );
}
