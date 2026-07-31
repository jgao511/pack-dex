import { getRarityCategory } from "./packGenerator.js";

const INSPECTION_GLOW_STRENGTHS = {
  standard: new Set([
    "doubleRare",
    "gx",
    "pokemonV",
    "vmaxOrVstar",
    "megaDoubleRare",
    "breakRare",
  ]),
  high: new Set([
    "fullArt",
    "ultraRare",
    "illustrationRare",
    "shinyRare",
    "shinyUltraRare",
    "trainerGallery",
    "galarianGallery",
    "classicCollection",
    "radiantRare",
    "aceSpecRare",
  ]),
  chase: new Set([
    "specialIllustrationRare",
    "alternateArt",
    "hyperRare",
    "secretRare",
    "rainbowRare",
    "blackWhiteRare",
    "victiniRare",
    "megaHyperRare",
    "futuristicRare",
    "classic",
  ]),
};

export function getInspectionGlowStrength(card, set = {}) {
  const category = getRarityCategory(card, set);

  if (INSPECTION_GLOW_STRENGTHS.chase.has(category)) return "chase";
  if (INSPECTION_GLOW_STRENGTHS.high.has(category)) return "high";
  if (INSPECTION_GLOW_STRENGTHS.standard.has(category)) return "standard";
  return "none";
}

export function shouldUseInspectionGlow(card, set = {}) {
  return getInspectionGlowStrength(card, set) !== "none";
}
