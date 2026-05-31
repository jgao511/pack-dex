import { getRarityCategory, normalizeRarity } from "./packGenerator.js";

const PREMIUM_TEXT_PATTERNS = [
  /\bhyper rare\b/u,
  /\bex hyper\b/u,
  /\bgx hyper\b/u,
  /\bv hyper\b/u,
  /\bsecret rare\b/u,
  /\bultra rare\b/u,
  /\bdouble rare\b/u,
  /\bspecial illustration rare\b/u,
  /\billustration rare\b/u,
  /\bspecial art rare\b/u,
  /\bart rare\b/u,
  /\bfull art\b/u,
  /\brainbow rare\b/u,
  /\bgold rare\b/u,
  /\balt art\b/u,
  /\balternate art\b/u,
  /\btrainer gallery\b/u,
  /\bgalarian gallery\b/u,
  /\bclassic collection\b/u,
  /\bshiny vault\b/u,
  /\bshiny rare\b/u,
  /\bshiny ultra rare\b/u,
  /\brace spec\b/u,
  /\bbreak\b/u,
  /\bvmax\b/u,
  /\bvstar\b/u,
  /\brare holo ex\b/u,
  /\bholo rare ex\b/u,
  /\brare holo gx\b/u,
  /\bholo rare gx\b/u,
  /\brare holo v\b/u,
  /\bholo rare v\b/u,
];

const PREMIUM_CATEGORIES = new Set([
  "hyperRare",
  "secretRare",
  "ultraRare",
  "doubleRare",
  "fullArt",
  "illustrationRare",
  "specialIllustrationRare",
  "rainbowRare",
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
  "breakRare",
  "gx",
  "pokemonV",
  "vmaxOrVstar",
]);

const STANDARD_HIT_CATEGORIES = new Set(["holoRare", "doubleRare", "gx", "pokemonV", "vmaxOrVstar"]);
const NO_SOUND_CATEGORIES = new Set(["common", "uncommon", "rare", "holoRare"]);

export function normalizeText(value) {
  return normalizeRarity(value);
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).join(" ") : normalizeText(value);
}

function hasPremiumText(text) {
  return PREMIUM_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

function subtypeText(card) {
  if (Array.isArray(card?.subtypes)) {
    return card.subtypes.map((subtype) => normalizeText(subtype)).join(" ");
  }

  return normalizeText(card?.subtypes || "");
}

export function getCardSearchText(card = {}) {
  return [
    card.name,
    card.rarity,
    card.supertype,
    card.subtypes,
    card.variant,
    card.collection,
    card.subset,
    card.number,
    card.id,
    card.image,
  ]
    .flat()
    .filter(Boolean)
    .map((value) => normalizeText(value))
    .join(" ");
}

export function isRegularNonHit(card) {
  if (!card) return true;

  const rarity = normalizeText(card.rarity);
  const variant = normalizeText(card.variant);
  const text = getCardSearchText(card);

  if (card.isReverseHolo || variant === "reverseholo" || variant === "reverse holo") {
    return true;
  }

  if (hasPremiumText(text) || /\bex\b/u.test(text) || /\bgx\b/u.test(text) || /\bv\b/u.test(text)) {
    return false;
  }

  return ["common", "uncommon", "rare", "rare non holo", "rare non-holo", "normal rare"].includes(rarity);
}

export function isPremiumHit(card, set = {}) {
  if (isRegularNonHit(card)) return false;

  const text = getCardSearchText(card);
  const category = getRarityCategory(card, set);

  return PREMIUM_CATEGORIES.has(category) || hasPremiumText(text);
}

export function isAnyHit(card, set = {}) {
  if (isRegularNonHit(card)) return false;

  const rarity = normalizeText(card.rarity);
  const text = getCardSearchText(card);
  const category = getRarityCategory(card, set);

  return (
    category === "holoRare" ||
    PREMIUM_CATEGORIES.has(category) ||
    rarity.includes("holo") ||
    rarity.includes("rare") ||
    /\bex\b/u.test(text) ||
    /\bgx\b/u.test(text) ||
    /\bv\b/u.test(text) ||
    /\bvmax\b/u.test(text) ||
    /\bvstar\b/u.test(text) ||
    isPremiumHit(card, set)
  );
}

export function getFoilProfile(card, set = {}) {
  if (!card || isRegularNonHit(card)) return "none";

  const rarity = normalizeText(card.rarity);
  const text = getCardSearchText(card);
  const subset = [normalizeText(card.subset), normalizeText(card.collection), normalizeText(card.set)].join(" ");
  const supertype = normalizeText(card.supertype);
  const subtypes = subtypeText(card);
  const category = getRarityCategory(card, set);

  if (category === "victiniRare" || category === "blackWhiteRare" || category === "megaHyperRare") {
    return "specialIllustrationRare";
  }

  if (category === "rainbowRare" || text.includes("rainbow rare") || /\brainbow\b/u.test(text)) {
    return "rainbowRare";
  }

  if (
    category === "hyperRare" ||
    text.includes("hyper rare") ||
    /\bex hyper\b/u.test(text) ||
    /\bgx hyper\b/u.test(text) ||
    /\bv hyper\b/u.test(text) ||
    text.includes("gold rare") ||
    /\bgold\b/u.test(text)
  ) {
    return "goldRare";
  }

  if (category === "secretRare" && (text.includes("secret rare gold") || /\bgold\b/u.test(text))) {
    return "goldRare";
  }

  if (category === "secretRare" && (text.includes("secret rare rainbow") || /\brainbow\b/u.test(text))) {
    return "rainbowRare";
  }

  if (
    category === "specialIllustrationRare" ||
    category === "alternateArt" ||
    text.includes("special illustration rare") ||
    text.includes("special art rare") ||
    text.includes("alt art") ||
    text.includes("alternate art")
  ) {
    return "specialIllustrationRare";
  }

  if (
    category === "illustrationRare" ||
    text.includes("illustration rare") ||
    text.includes("art rare") ||
    text.includes("character rare")
  ) {
    return "illustrationRare";
  }

  if (
    category === "trainerGallery" ||
    category === "galarianGallery" ||
    category === "classicCollection" ||
    text.includes("trainer gallery") ||
    text.includes("galarian gallery") ||
    text.includes("classic collection") ||
    subset.includes("trainer gallery") ||
    subset.includes("galarian gallery") ||
    subset.includes("gallery") ||
    subset.includes("classic collection")
  ) {
    return "galleryRare";
  }

  if (
    category === "shinyRare" ||
    category === "shinyUltraRare" ||
    text.includes("shiny vault") ||
    text.includes("shiny rare") ||
    text.includes("shiny ultra rare") ||
    text.includes("rare shiny") ||
    subset.includes("shiny vault") ||
    rarity.includes("shiny rare")
  ) {
    return "shinyVault";
  }

  if (category === "fullArt" || category === "secretRare" || text.includes("full art") || text.includes("secret rare")) {
    return "fullArt";
  }

  if (
    ["doubleRare", "ultraRare", "gx", "pokemonV", "vmaxOrVstar", "megaDoubleRare", "radiantRare", "aceSpecRare"].includes(
      category
    ) ||
    text.includes("double rare") ||
    text.includes("ultra rare") ||
    text.includes("rare holo ex") ||
    text.includes("holo rare ex") ||
    text.includes("rare holo gx") ||
    text.includes("holo rare gx") ||
    text.includes("holo rare v") ||
    text.includes("rare holo v") ||
    /\bex\b/u.test(subtypes) ||
    /\bgx\b/u.test(subtypes) ||
    /\bv\b/u.test(subtypes) ||
    subtypes.includes("vmax") ||
    subtypes.includes("vstar") ||
    supertype.includes("ex") ||
    supertype.includes("gx")
  ) {
    return "ultraRare";
  }

  if (category === "holoRare" || rarity.includes("holo") || rarity.includes("holofoil")) {
    return "holoRare";
  }

  if (isPremiumHit(card, set)) return "fullArt";
  if (isAnyHit(card, set)) return STANDARD_HIT_CATEGORIES.has(category) ? "ultraRare" : "fullArt";

  return "none";
}

export function getHitSoundType(card, set = {}) {
  if (!card) return "none";

  const rarity = normalizeText(card.rarity);
  const variant = normalizeText(card.variant);
  const text = getCardSearchText(card);
  const category = getRarityCategory(card, set);

  if (card.isReverseHolo || variant === "reverseholo" || variant === "reverse holo") {
    return "none";
  }

  if (
    [
      "fullArt",
      "secretRare",
      "hyperRare",
      "rainbowRare",
      "illustrationRare",
      "specialIllustrationRare",
      "trainerGallery",
      "galarianGallery",
      "classicCollection",
      "shinyRare",
      "shinyUltraRare",
      "blackWhiteRare",
      "victiniRare",
      "megaHyperRare",
      "breakRare",
      "alternateArt",
      "goldRare",
    ].includes(category)
  ) {
    return "bigHit";
  }

  if (
    ["doubleRare", "gx", "pokemonV", "vmaxOrVstar", "megaDoubleRare", "ultraRare", "radiantRare", "aceSpecRare"].includes(
      category
    )
  ) {
    return "hit";
  }

  if (NO_SOUND_CATEGORIES.has(category)) {
    return "none";
  }

  if (
    rarity === "common" ||
    rarity === "uncommon" ||
    rarity === "rare" ||
    rarity === "rare holo" ||
    rarity === "holo rare" ||
    rarity === "rare holofoil" ||
    (rarity.includes("rare holo") &&
      !rarity.includes("ex") &&
      !rarity.includes("gx") &&
      !rarity.includes(" v") &&
      !rarity.includes("vmax") &&
      !rarity.includes("vstar"))
  ) {
    return "none";
  }

  if (
    [
      "fullArt",
      "secretRare",
      "hyperRare",
      "rainbowRare",
      "illustrationRare",
      "specialIllustrationRare",
      "trainerGallery",
      "galarianGallery",
      "classicCollection",
      "shinyRare",
      "shinyUltraRare",
      "blackWhiteRare",
      "victiniRare",
      "megaHyperRare",
      "breakRare",
      "alternateArt",
      "goldRare",
    ].includes(category) ||
    text.includes("secret rare") ||
    text.includes("rare secret") ||
    text.includes("hyper rare") ||
    text.includes("gold rare") ||
    text.includes("rainbow rare") ||
    text.includes("full art") ||
    text.includes("rare ultra") ||
    text.includes("illustration rare") ||
    text.includes("special illustration rare") ||
    text.includes("trainer gallery") ||
    text.includes("galarian gallery") ||
    text.includes("shiny vault") ||
    /\bbreak\b/u.test(text)
  ) {
    return "bigHit";
  }

  if (
    ["doubleRare", "gx", "pokemonV", "vmaxOrVstar", "megaDoubleRare", "ultraRare", "radiantRare", "aceSpecRare"].includes(
      category
    ) ||
    /\bex\b/u.test(text) ||
    /\bgx\b/u.test(text) ||
    /\bv\b/u.test(text) ||
    text.includes("vmax") ||
    text.includes("vstar") ||
    text.includes("ultra rare") ||
    text.includes("double rare")
  ) {
    return "hit";
  }

  return "none";
}
