import { getRarityCategory } from "../../../src/utils/packGenerator.js";

const LEVEL_BY_CATEGORY = new Map([
  ["rare", "rare"], ["holoRare", "rare"],
  ["doubleRare", "double"], ["ultraRare", "double"], ["fullArt", "double"],
  ["gx", "double"], ["pokemonV", "double"], ["vmaxOrVstar", "double"], ["megaDoubleRare", "double"],
  ["illustrationRare", "illustration"], ["artRare", "illustration"],
  ["specialIllustrationRare", "major"], ["alternateArt", "major"], ["trainerGallery", "major"],
  ["galarianGallery", "major"], ["shinyUltraRare", "major"], ["megaAttackRare", "major"],
  ["hyperRare", "top"], ["secretRare", "top"], ["rainbowRare", "top"],
  ["megaHyperRare", "top"], ["victiniRare", "top"], ["blackWhiteRare", "top"],
  ["futuristicRare", "top"], ["classic", "top"], ["classicCollection", "top"],
]);

export function getRarityVisualLevel(card, set = {}) {
  return LEVEL_BY_CATEGORY.get(getRarityCategory(card, set)) || "none";
}

export function getRarityVisualClass(card, set = {}) {
  return `rarity-visual-${getRarityVisualLevel(card, set)}`;
}

export function isRarePlusVisual(card, set = {}) {
  return getRarityVisualLevel(card, set) !== "none";
}
