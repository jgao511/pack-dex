import { hardcodedPullRates } from "../data/hardcodedPullRates.js";
import { defaultPullRateProfile, pullRateProfiles } from "../data/pullRateProfiles.js";

const PACK_SLOTS = {
  commons: 4,
  uncommons: 3,
  regular: 1,
  regularOrSubset: 1,
  final: 1,
};

const XY_PACK_SLOTS = {
  commons: 5,
  uncommons: 3,
  reverseOrBreak: 1,
  final: 1,
};

const MINI_PACK_SET_IDS = new Set(["detective-pikachu", "celebrations"]);

const MEGA_SET_IDS = new Set([
  "mega-evolution",
  "phantasmal-flames",
  "ascended-heroes",
  "perfect-order",
  "chaos-rising",
]);

const MINI_PACK_SLOTS = {
  regular: 3,
  final: 1,
};

const FINAL_SLOT_CATEGORIES = new Set([
  "rare",
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
]);

const MODERN_SV_PRE_RARE_CATEGORIES = new Set(["illustrationRare", "specialIllustrationRare"]);

const REVERSE_SLOT_CATEGORIES = new Set(["common", "uncommon", "rare"]);

// Simulator constants: exact English God Pack odds are not publicly disclosed.
export const GOD_PACK_CONFIG = {
  151: {
    enabled: true,
    displayName: "Demi-God Pack",
    odds: 1 / 250,
    type: "demiGodPack",
    format: "151_THREE_CARD_EVOLUTION_LINE",
    sourceNote: "English 151 demi-god packs contain a complete IR/SIR evolution line.",
  },
  "prismatic-evolutions": {
    enabled: true,
    displayName: "God Pack",
    odds: 1 / 250,
    type: "mixedGodPack",
    formats: [
      {
        format: "PRISMATIC_FULL_EEVEELUTION_PACK",
        weight: 0.35,
      },
      {
        format: "PRISMATIC_DEMI_GOD_PACK",
        weight: 0.65,
      },
    ],
    sourceNote:
      "Community-reported English Prismatic Evolutions rare packs include full Eeveelution God Packs and Demi-God style packs.",
  },
  "black-bolt": {
    enabled: true,
    displayName: "God Pack",
    odds: 1 / 250,
    type: "fullGodPack",
    format: "BLACK_BOLT_9_IR_1_SIR",
    sourceNote: "English Black Bolt God Packs contain 9 Illustration Rares and 1 Special Illustration Rare.",
  },
  "white-flare": {
    enabled: true,
    displayName: "God Pack",
    odds: 1 / 250,
    type: "fullGodPack",
    format: "WHITE_FLARE_9_IR_1_SIR",
    sourceNote: "English White Flare God Packs contain 9 Illustration Rares and 1 Special Illustration Rare.",
  },
  "ascended-heroes": {
    enabled: true,
    displayName: "God Pack",
    odds: 1 / 250,
    type: "fullGodPack",
    format: "ASCENDED_HEROES_3_MAR_7_SIR",
    sourceNote: "Ascended Heroes God Pack format: 3 Mega Attack Rares and 7 Special Illustration Rares.",
  },
};

const GOD_PACK_GROUPS = {
  151: {
    evolutionLines: [
      {
        name: "Bulbasaur Line",
        cards: [
          { name: "Bulbasaur", rarity: "Illustration Rare" },
          { name: "Ivysaur", rarity: "Illustration Rare" },
          { name: "Venusaur ex", rarity: "Special Illustration Rare" },
        ],
      },
      {
        name: "Charmander Line",
        cards: [
          { name: "Charmander", rarity: "Illustration Rare" },
          { name: "Charmeleon", rarity: "Illustration Rare" },
          { name: "Charizard ex", rarity: "Special Illustration Rare" },
        ],
      },
      {
        name: "Squirtle Line",
        cards: [
          { name: "Squirtle", rarity: "Illustration Rare" },
          { name: "Wartortle", rarity: "Illustration Rare" },
          { name: "Blastoise ex", rarity: "Special Illustration Rare" },
        ],
      },
    ],
  },
};

const PRISMATIC_EEVEELUTION_NAMES = new Set([
  "eevee",
  "vaporeon ex",
  "jolteon ex",
  "flareon ex",
  "espeon ex",
  "umbreon ex",
  "leafeon ex",
  "glaceon ex",
  "sylveon ex",
]);

const PRISMATIC_FULL_GOD_PACK_ORDER = [
  { name: "Eevee", rarity: "Common" },
  { name: "Umbreon ex", rarity: "Special Illustration Rare" },
  { name: "Sylveon ex", rarity: "Special Illustration Rare" },
  { name: "Leafeon ex", rarity: "Special Illustration Rare" },
  { name: "Glaceon ex", rarity: "Special Illustration Rare" },
  { name: "Vaporeon ex", rarity: "Special Illustration Rare" },
  { name: "Jolteon ex", rarity: "Special Illustration Rare" },
  { name: "Flareon ex", rarity: "Special Illustration Rare" },
  { name: "Espeon ex", rarity: "Special Illustration Rare" },
  { name: "Eevee ex", rarity: "Special Illustration Rare" },
];

const CATEGORY_WEIGHT_ALIASES = {
  holoRare: "rare",
  megaDoubleRare: "megaDoubleRare",
};

const PROFILE_CATEGORY_ALIASES = {
  doubleRare: ["gx", "pokemonV", "megaDoubleRare"],
  ultraRare: ["fullArt", "vmaxOrVstar"],
  secretRare: ["rainbowRare", "hyperRare"],
  hyperRare: ["secretRare", "rainbowRare"],
  shinyRare: ["shinyUltraRare"],
  shinyUltraRare: ["shinyRare", "ultraRare"],
  megaDoubleRare: ["doubleRare", "pokemonV", "vmaxOrVstar"],
};

const HIGHER_THAN_RARE_CATEGORIES = new Set(
  [...FINAL_SLOT_CATEGORIES].filter((category) => category !== "rare" && category !== "holoRare")
);

const PREMIUM_SUBSET_CATEGORIES = new Set([
  "gx",
  "pokemonV",
  "vmaxOrVstar",
  "ultraRare",
  "fullArt",
  "specialIllustrationRare",
  "secretRare",
  "hyperRare",
  "rainbowRare",
  "radiantRare",
  "aceSpecRare",
  "shinyUltraRare",
  "blackWhiteRare",
  "victiniRare",
  "megaHyperRare",
]);

const SUBSET_SLOT_RULES = {
  "hidden-fates": {
    type: "shinyVault",
    subsetTypes: ["shinyVault"],
    normalWeight: 70,
    regularWeight: 20,
    premiumWeight: 8,
    chaseWeight: 2,
  },
  "shining-fates": {
    type: "shinyVault",
    subsetTypes: ["shinyVault"],
    normalWeight: 68,
    regularWeight: 22,
    premiumWeight: 8,
    chaseWeight: 2,
  },
  celebrations: {
    type: "simple",
    subsetTypes: ["classicCollection"],
    normalWeight: 70,
    regularWeight: 30,
  },
  "brilliant-stars": {
    type: "simple",
    subsetTypes: ["trainerGallery"],
    normalWeight: 87,
    regularWeight: 13,
  },
  "astral-radiance": {
    type: "simple",
    subsetTypes: ["trainerGallery"],
    normalWeight: 87,
    regularWeight: 13,
  },
  "lost-origin": {
    type: "simple",
    subsetTypes: ["trainerGallery"],
    normalWeight: 87,
    regularWeight: 13,
  },
  "silver-tempest": {
    type: "simple",
    subsetTypes: ["trainerGallery"],
    normalWeight: 87,
    regularWeight: 13,
  },
  "crown-zenith": {
    type: "premium",
    subsetTypes: ["galarianGallery"],
    normalWeight: 75,
    regularWeight: 20,
    premiumWeight: 5,
  },
  "crown-zentih": {
    type: "premium",
    subsetTypes: ["galarianGallery"],
    normalWeight: 75,
    regularWeight: 20,
    premiumWeight: 5,
  },
  "pokemon-go": {
    type: "simple",
    subsetTypes: ["radiant"],
    normalWeight: 94,
    regularWeight: 6,
  },
  "paldean-fates": {
    type: "premium",
    subsetTypes: ["shinyVault", "shiny"],
    normalWeight: 80,
    regularWeight: 15,
    premiumWeight: 5,
  },
  "prismatic-evolutions": {
    type: "premium",
    subsetTypes: ["shiny", "pokeball", "masterball"],
    normalWeight: 80,
    regularWeight: 15,
    premiumWeight: 5,
  },
  "shrouded-fable": {
    type: "premium",
    subsetTypes: ["shiny", "pokeball", "masterball"],
    normalWeight: 80,
    regularWeight: 15,
    premiumWeight: 5,
  },
  151: {
    type: "premium",
    subsetTypes: ["pokeball", "masterball"],
    normalWeight: 80,
    regularWeight: 15,
    premiumWeight: 5,
  },
};

const PROFILE_ALIASES_BY_SET = {
  "crown-zentih": "crown-zenith",
  "champion’s-path": "champions-path",
  "champion's-path": "champions-path",
  "pokemon-go": "pokemon-go",
  "pokémon-go": "pokemon-go",
};

const PROFILE_BY_SET = {
  "sun-moon": "sunMoonStandard",
  "guardians-rising": "sunMoonStandard",
  "burning-shadows": "sunMoonStandard",
  "shining-legends": "sunMoonSpecial",
  "crimson-invasion": "sunMoonStandard",
  "ultra-prism": "sunMoonStandard",
  "forbidden-light": "sunMoonStandard",
  "celestial-storm": "sunMoonStandard",
  "dragon-majesty": "sunMoonSpecial",
  "lost-thunder": "sunMoonStandard",
  "team-up": "sunMoonStandard",
  "detective-pikachu": "detectivePikachu",
  "unbroken-bonds": "sunMoonStandard",
  "unified-minds": "sunMoonStandard",
  "hidden-fates": "sunMoonSpecial",
  "cosmic-eclipse": "sunMoonStandard",
  xy0: "xyKalosStarter",
  xy1: "xyEarly",
  xy2: "xyEarly",
  xy3: "xyEarly",
  xy4: "xyEarly",
  xy5: "xyTransition",
  dc1: "xyDoubleCrisis",
  xy6: "xyTransition",
  xy7: "xyLate",
  xy8: "xyBreak",
  xy9: "xyBreak",
  g1: "xyGenerations",
  xy10: "xyBreak",
  xy11: "xyBreak",
  xy12: "xyEvolutions",
  xy: "xyEarly",
  "xy-base": "xyEarly",
  "flashfire": "xyEarly",
  "furious-fists": "xyEarly",
  "phantom-forces": "xyEarly",
  "primal-clash": "xyTransition",
  "roaring-skies": "xyTransition",
  "ancient-origins": "xyLate",
  "breakthrough": "xyBreak",
  "breakpoint": "xyBreak",
  "fates-collide": "xyBreak",
  "steam-siege": "xyBreak",
  "xy-evolutions": "xyEvolutions",
  evolutions: "xyEvolutions",
  "sword-shield": "swordShieldStandard",
  "rebel-clash": "swordShieldStandard",
  "darkness-ablaze": "swordShieldStandard",
  "champions-path": "swordShieldSpecial",
  "vivid-voltage": "swordShieldStandard",
  "shining-fates": "swordShieldSpecial",
  "battle-styles": "swordShieldStandard",
  "chilling-reign": "swordShieldStandard",
  "evolving-skies": "swordShieldStandard",
  celebrations: "swordShieldSpecial",
  "fusion-strike": "swordShieldStandard",
  "brilliant-stars": "swordShieldTrainerGallery",
  "astral-radiance": "swordShieldTrainerGallery",
  "pokemon-go": "swordShieldSpecial",
  "lost-origin": "swordShieldStandard",
  "silver-tempest": "swordShieldStandard",
  "crown-zenith": "swordShieldSpecial",
  "scarlet-violet": "scarletVioletStandard",
  "paldea-evolved": "scarletVioletStandard",
  "obsidian-flames": "scarletVioletStandard",
  151: "scarletVioletSpecial",
  "paradox-rift": "scarletVioletStandard",
  "paldean-fates": "scarletVioletSpecial",
  "temporal-forces": "scarletVioletStandard",
  "twilight-masquerade": "scarletVioletStandard",
  "shrouded-fable": "scarletVioletSpecial",
  "stellar-crown": "scarletVioletStandard",
  "surging-sparks": "scarletVioletStandard",
  "prismatic-evolutions": "scarletVioletSpecial",
  "journey-together": "scarletVioletStandard",
  "destined-rivals": "scarletVioletStandard",
  "black-bolt": "blackBoltWhiteFlare2025",
  "white-flare": "blackBoltWhiteFlare2025",
  "mega-evolution": "megaEvolutionStandard",
  "phantasmal-flames": "megaEvolutionStandard",
  "ascended-heroes": "megaEvolutionStandard",
  "perfect-order": "megaEvolutionStandard",
  "chaos-rising": "megaEvolutionStandard",
};

export const subsetSlotRules = SUBSET_SLOT_RULES;

export function isMegaSet(set = {}) {
  return MEGA_SET_IDS.has(normalizeSetId(set));
}

export function normalizeRarity(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return normalizeRarity(value);
}

function normalizeSetId(setOrId = "") {
  const rawId = typeof setOrId === "string" ? setOrId : setOrId?.id || "";
  const normalized = normalizeText(rawId)
    .replaceAll("é", "e")
    .replace(/[’']/g, "")
    .replace(/\s+/g, "-");

  return PROFILE_ALIASES_BY_SET[normalized] || normalized;
}

export function getNormalizedSetId(setOrId = "") {
  return normalizeSetId(setOrId);
}

function getConfiguredProfileName(set = {}) {
  const setId = normalizeSetId(set);

  return set.pullRateProfile || PROFILE_BY_SET[setId] || defaultPullRateProfile;
}

export function isModernSVSet(set = {}) {
  const profileName = getConfiguredProfileName(set);

  return (
    profileName === "scarletVioletStandard" ||
    profileName === "scarletVioletSpecial" ||
    profileName === "blackBoltWhiteFlare2025"
  );
}

export function isXYSet(set = {}) {
  const profileName = getConfiguredProfileName(set);

  return [
    "xyKalosStarter",
    "xyEarly",
    "xyTransition",
    "xyLate",
    "xyBreak",
    "xyEvolutions",
    "xyGenerations",
    "xyDoubleCrisis",
  ].includes(profileName);
}

export function isXYBreakSet(set = {}) {
  const profileName = getConfiguredProfileName(set);

  return profileName === "xyBreak" || profileName === "xyEvolutions";
}

function getCardsAndSet(cardsOrSet, maybeSet) {
  if (Array.isArray(cardsOrSet)) {
    return {
      cards: cardsOrSet,
      set: maybeSet || {},
    };
  }

  return {
    cards: cardsOrSet?.cards || [],
    set: cardsOrSet || maybeSet || {},
  };
}

function cardSearchText(card) {
  return [
    card.rarity,
    card.name,
    card.id,
    card.number,
    card.subset,
    card.set,
    card.setName,
    card.collection,
  ]
    .map((value) => normalizeText(value))
    .join(" ");
}

function isCodeCard(card) {
  return normalizeText(card.name).includes("code card");
}

const BASIC_ENERGY_NAMES = new Set([
  "grass energy",
  "fire energy",
  "water energy",
  "lightning energy",
  "psychic energy",
  "fighting energy",
  "darkness energy",
  "metal energy",
  "fairy energy",
  "basic grass energy",
  "basic fire energy",
  "basic water energy",
  "basic lightning energy",
  "basic psychic energy",
  "basic fighting energy",
  "basic darkness energy",
  "basic metal energy",
  "basic fairy energy",
]);

export function isActualEnergyCard(card) {
  const supertype = normalizeText(card.supertype);
  const category = normalizeText(card.category);
  const cardType = normalizeText(card.cardType);
  const type = normalizeText(card.type);
  const types = Array.isArray(card.types) ? card.types.map((value) => normalizeText(value)) : [];
  const name = normalizeText(card.name);
  const rarity = normalizeRarity(card.rarity);

  return (
    supertype === "energy" ||
    category === "energy" ||
    cardType === "energy" ||
    type === "energy" ||
    types.includes("energy") ||
    rarity === "basic energy" ||
    rarity === "energy" ||
    BASIC_ENERGY_NAMES.has(name)
  );
}

function normalizeCategoryForSet(category, set = {}) {
  if (category === "megaHyperRare" && !isMegaSet(set)) return "secretRare";
  if (category === "megaDoubleRare" && !isMegaSet(set)) return "doubleRare";

  return category;
}

export function isIllustrationRare(card) {
  const rarity = normalizeRarity(card?.rarity);

  return rarity === "illustration rare" || rarity === "art rare" || rarity === "ir";
}

export function isSpecialIllustrationRare(card) {
  const rarity = normalizeRarity(card?.rarity);

  return rarity === "special illustration rare" || rarity === "special art rare" || rarity === "sir";
}

export function isMegaAttackRare(card) {
  const rarity = normalizeRarity(card?.rarity);
  const text = [card?.rarity, card?.id, card?.image]
    .map((value) => normalizeText(value))
    .join(" ");

  return rarity === "mega attack rare" || rarity === "mar" || text.includes("mega attack rare");
}

function isPremiumArtHit(card, set = {}) {
  const rarity = normalizeRarity(card?.rarity);
  const category = getRarityCategory(card, set);

  return (
    isIllustrationRare(card) ||
    isSpecialIllustrationRare(card) ||
    [
      "ultraRare",
      "fullArt",
      "hyperRare",
      "secretRare",
      "rainbowRare",
      "alternateArt",
      "trainerGallery",
      "galarianGallery",
      "shinyUltraRare",
      "blackWhiteRare",
      "victiniRare",
      "megaDoubleRare",
      "megaHyperRare",
    ].includes(category) ||
    rarity.includes("ultra rare") ||
    rarity.includes("hyper rare") ||
    rarity.includes("secret rare") ||
    rarity.includes("full art") ||
    rarity.includes("mega attack rare") ||
    rarity.includes("gold") ||
    rarity.includes("rainbow")
  );
}

export function isBreakCard(card) {
  const rarity = normalizeRarity(card?.rarity);
  const name = normalizeText(card?.name);

  return rarity === "break" || rarity === "rare break" || /\bbreak\b/u.test(name);
}

function isXYFullArtOrUltra(card) {
  const rarity = normalizeRarity(card?.rarity);

  return rarity.includes("ultra") || rarity.includes("full art");
}

function isXYEX(card) {
  const rarity = normalizeRarity(card?.rarity);
  const name = normalizeText(card?.name);
  const subtypes = Array.isArray(card?.subtypes)
    ? card.subtypes.map((subtype) => normalizeText(subtype)).join(" ")
    : normalizeText(card?.subtypes);

  return (
    rarity.includes("ex") ||
    rarity.includes("rare holo ex") ||
    /\bex\b/u.test(name) ||
    subtypes.includes("ex") ||
    subtypes.includes("mega")
  );
}

function isRadiantCollectionCard(card) {
  const number = normalizeText(card?.number);
  const subset = normalizeText(card?.subset || card?.collection);

  return number.startsWith("rc") || subset.includes("radiant collection");
}

export function getRarityCategory(card, set = {}) {
  if (card?.rarityCategory) return normalizeCategoryForSet(card.rarityCategory, set);

  const rarity = normalizeRarity(card.rarity);
  const name = normalizeText(card.name);
  const id = normalizeText(card.id);
  const number = normalizeText(card.number);
  const subset = normalizeRarity(card.subset);
  const combined = `${rarity} ${name} ${id} ${number} ${subset}`;

  if (combined.includes("mega hyper rare") || combined.includes(" mhr") || combined.endsWith("mhr")) {
    return normalizeCategoryForSet("megaHyperRare", set);
  }

  if (rarity === "victini rare" || (combined.includes("victini") && combined.includes("rare"))) {
    return "victiniRare";
  }

  if (
    combined.includes("zekrom") &&
    (combined.includes("black white rare") || combined.includes("black white"))
  ) {
    return "blackWhiteRare";
  }

  if (rarity === "black white rare") return "blackWhiteRare";
  if (isSpecialIllustrationRare(card)) return "specialIllustrationRare";
  if (rarity === "classic collection" || subset === "classic collection") return "classicCollection";
  if (rarity === "trainer gallery" || rarity === "tg" || subset === "trainer gallery") return "trainerGallery";
  if (rarity === "galarian gallery" || rarity === "gg" || subset === "galarian gallery") return "galarianGallery";
  if (combined.includes("ace spec")) return "aceSpecRare";
  if (combined.includes("hyper rare")) return "hyperRare";
  if (combined.includes("secret rare") || rarity === "rare secret") return "secretRare";
  if (combined.includes("rainbow rare")) return "rainbowRare";
  if (isIllustrationRare(card)) return "illustrationRare";
  if (isBreakCard(card)) return "breakRare";
  if (isXYFullArtOrUltra(card)) return "ultraRare";
  if (combined.includes("mega") && combined.includes("double rare")) {
    return normalizeCategoryForSet("megaDoubleRare", set);
  }
  if (combined.includes("shiny ultra rare") || combined.includes("rare shiny gx")) {
    return "shinyUltraRare";
  }
  if (subset === "shiny vault") return "shinyRare";
  if (combined.includes("shiny rare") || combined.includes("rare shiny")) {
    return "shinyRare";
  }
  if (combined.includes("shiny vault") || combined.includes("baby shiny") || rarity === "shiny") return "shinyRare";
  if (combined.includes("ultra rare")) return "ultraRare";
  if (combined.includes("double rare")) return "doubleRare";
  if (["pokemon ex", "pokémon ex", "ex"].includes(rarity) || isXYEX(card)) return "doubleRare";
  if (combined.includes("alternate art") || combined.includes("alt art")) return "alternateArt";
  if (combined.includes("radiant rare") || rarity === "radiant" || combined.includes("radiant")) return "radiantRare";
  if (combined.includes("rare holo vmax") || combined.includes("rare holo vstar")) return "vmaxOrVstar";
  if (/\bvmax\b/u.test(combined) || /\bvstar\b/u.test(combined) || rarity === "vmax rare" || rarity === "vstar rare") {
    return "vmaxOrVstar";
  }
  if (combined.includes("rare holo v") || ["pokemon v", "pokémon v", "v"].includes(rarity)) return "pokemonV";
  if (combined.includes("full art")) return "fullArt";
  if (combined.includes("rare holo gx") || ["gx", "pokemon gx", "pokémon gx", "gx rare"].includes(rarity) || /\bgx\b/u.test(name)) {
    return "gx";
  }
  if (rarity === "rare holo" || combined.includes("rare holo")) return "holoRare";
  if (rarity === "rare") return "rare";
  if (rarity === "common") return "common";
  if (rarity === "uncommon") return "uncommon";

  return "other";
}

export function getPullRateProfile(set = {}) {
  const setId = normalizeSetId(set);
  const hardcoded = hardcodedPullRates[setId];

  if (hardcoded) return hardcoded;

  const profileName = set.pullRateProfile || PROFILE_BY_SET[setId] || defaultPullRateProfile;

  return pullRateProfiles[profileName] || pullRateProfiles[defaultPullRateProfile];
}

export function getFinalSlotWeights(profile = pullRateProfiles[defaultPullRateProfile]) {
  return profile.finalSlot || profile.finalRareSlot || profile;
}

function getProfileWeightKey(category) {
  return CATEGORY_WEIGHT_ALIASES[category] || category;
}

function getProfileName(set = {}) {
  const setId = normalizeSetId(set);

  if (hardcodedPullRates[setId]) return setId;

  return getConfiguredProfileName(set);
}

function getPackSize(set = {}) {
  const profile = getPullRateProfile(set);
  const setId = normalizeSetId(set);

  return profile.packSize || (MINI_PACK_SET_IDS.has(setId) ? 4 : 10);
}

export function getProfileWeightForCategory(
  category,
  profile = pullRateProfiles[defaultPullRateProfile],
  set = {},
  availableCategories = new Set()
) {
  const weights = getFinalSlotWeights(profile);
  const profileName = getProfileName(set);
  const key = getProfileWeightKey(category);

  if (weights[key] !== undefined) return weights[key];

  for (const [profileCategory, aliases] of Object.entries(PROFILE_CATEGORY_ALIASES)) {
    if (
      aliases.includes(category) &&
      weights[profileCategory] !== undefined &&
      !availableCategories.has(profileCategory)
    ) {
      return weights[profileCategory];
    }
  }

  for (const [profileCategory, aliases] of Object.entries(PROFILE_CATEGORY_ALIASES)) {
    if (profileCategory === category) {
      const aliasWithWeight = aliases.find(
        (alias) => weights[alias] !== undefined && !availableCategories.has(alias)
      );

      if (aliasWithWeight) return weights[aliasWithWeight];
    }
  }

  if (profileName === "sunMoonStandard" || profileName === "sunMoonSpecial") {
    if (category === "doubleRare") return weights.gx || 0;
    if (category === "ultraRare") return weights.fullArt || weights.gx || 0;
    if (category === "secretRare") return weights.secretRare || 0;
    if (category === "rainbowRare") return weights.rainbowRare || weights.secretRare || 0;
    if (category === "fullArt") return weights.fullArt || weights.ultraRare || 0;
    if (category === "gx") return weights.gx || weights.doubleRare || 0;
  }

  if (
    [
      "xyEarly",
      "xyTransition",
      "xyLate",
      "xyBreak",
      "xyEvolutions",
      "xyGenerations",
      "xyDoubleCrisis",
    ].includes(profileName)
  ) {
    if (category === "doubleRare") return weights.rareHoloEX || weights.doubleRare || 0;
    if (category === "ultraRare" || category === "fullArt") return weights.ultraRareFullArt || weights.ultraRare || 0;
    if (category === "secretRare") return weights.secretRare || 0;
    if (category === "holoRare") return weights.holoRare || 0;
    if (category === "rare") return weights.regularRare || weights.rare || 0;
    if (category === "breakRare") return 0;
  }

  if (
    profileName === "swordShieldStandard" ||
    profileName === "swordShieldSpecial" ||
    profileName === "swordShieldTrainerGallery"
  ) {
    if (category === "doubleRare") return weights.pokemonV || 0;
    if (category === "ultraRare") return weights.fullArt || 0;
    if (category === "secretRare") return weights.secretRare || 0;
    if (category === "rainbowRare") return weights.rainbowRare || 0;
    if (category === "trainerGallery") return weights.trainerGallery || 0;
  }

  if (profileName === "scarletVioletStandard" || profileName === "scarletVioletSpecial") {
    if (category === "secretRare") return weights.hyperRare || weights.secretRare || 0;
    if (category === "shinyRare") return weights.illustrationRare || 0;
  }

  if (profileName === "blackBoltWhiteFlare2025") {
    if (category === "secretRare") return weights.hyperRare || 0;
  }

  if (profileName === "megaEvolutionStandard") {
    if (category === "doubleRare") return weights.megaDoubleRare || 0;
    if (category === "secretRare") return weights.hyperRare || weights.secretRare || 0;
  }

  if (category === "holoRare") return weights.rare || 0;
  if (HIGHER_THAN_RARE_CATEGORIES.has(category)) return weights.higherRare || 0;

  return 0;
}

export function getFinalSlotWeight(card, profile = pullRateProfiles[defaultPullRateProfile], set = {}) {
  return getProfileWeightForCategory(getRarityCategory(card), profile, set);
}

function groupCardsByCategory(cards, usedIds = new Set(), set = {}) {
  return cards.reduce((groups, card) => {
    if (usedIds.has(card.id)) return groups;

    const category = getRarityCategory(card, set);

    groups[category] ||= [];
    groups[category].push(card);

    return groups;
  }, {});
}

function isModernSVPreRareCategory(category) {
  return MODERN_SV_PRE_RARE_CATEGORIES.has(category);
}

function getFinalRareSlotPool(pools, set = {}) {
  if (!isModernSVSet(set)) return pools.finalSlotPool;

  const nonIllustrationPool = pools.finalSlotPool.filter(
    (card) => !isModernSVPreRareCategory(card.rarityCategory || getRarityCategory(card, set))
  );

  return nonIllustrationPool.length > 0 ? nonIllustrationPool : pools.finalSlotPool;
}

function pickModernSVPreRareSlot(pools, set = {}, usedIds = new Set()) {
  const profile = getPullRateProfile(set);
  const finalCardsByCategory = groupCardsByCategory(pools.finalSlotPool, usedIds, set);
  const availableFinalCategories = new Set(Object.keys(finalCardsByCategory));
  const finalWeightedCategories = Object.keys(finalCardsByCategory)
    .map((category) => [category, getProfileWeightForCategory(category, profile, set, availableFinalCategories)])
    .filter(([, weight]) => weight > 0);
  const totalFinalWeight = finalWeightedCategories.reduce((sum, [, weight]) => sum + weight, 0);
  const preRareWeightedCategories = finalWeightedCategories.filter(([category]) =>
    isModernSVPreRareCategory(category)
  );
  const totalPreRareWeight = preRareWeightedCategories.reduce((sum, [, weight]) => sum + weight, 0);

  if (totalFinalWeight > 0 && totalPreRareWeight > 0 && Math.random() * totalFinalWeight < totalPreRareWeight) {
    const chosenCategory = weightedRandomCategory(preRareWeightedCategories);
    const cardsInCategory = chosenCategory ? finalCardsByCategory[chosenCategory] : [];
    const selected = pickRandom(cardsInCategory || [], 1, usedIds)[0];

    if (selected) return selected;
  }

  return pickRegularOrSubsetSlot(pools, set, usedIds);
}

export function buildXYFinalRareBuckets(setCards, set = {}) {
  const pools = Array.isArray(setCards) ? buildPools(setCards, set) : setCards;
  const nonBreakCards = pools.cleanCards.filter((card) => !isBreakCard(card));

  return {
    regularRare: nonBreakCards.filter((card) => card.rarityCategory === "rare"),
    holoRare: nonBreakCards.filter((card) => card.rarityCategory === "holoRare"),
    rareHoloEX: nonBreakCards.filter((card) => card.rarityCategory === "doubleRare"),
    ultraRareFullArt: nonBreakCards.filter((card) => ["ultraRare", "fullArt"].includes(card.rarityCategory)),
    secretRare: nonBreakCards.filter((card) => card.rarityCategory === "secretRare"),
  };
}

function pickFromXYFinalRareBuckets(pools, set = {}, usedIds = new Set()) {
  const profile = getPullRateProfile(set);
  const weights = profile.coreSlots?.finalRareSlot || profile.finalRareSlot || getFinalSlotWeights(profile);
  const buckets = buildXYFinalRareBuckets(pools, set);
  const weightedBuckets = [
    ["regularRare", weights.regularRare ?? weights.rare ?? 0],
    ["holoRare", weights.holoRare ?? 0],
    ["rareHoloEX", weights.rareHoloEX ?? weights.doubleRare ?? 0],
    ["ultraRareFullArt", weights.ultraRareFullArt ?? weights.ultraRare ?? weights.fullArt ?? 0],
    ["secretRare", weights.secretRare ?? 0],
  ].filter(([bucketName, weight]) => weight > 0 && buckets[bucketName]?.some((card) => !usedIds.has(card.id)));
  const chosenBucket = weightedRandomCategory(weightedBuckets);
  const selected = chosenBucket ? pickRandom(buckets[chosenBucket], 1, usedIds)[0] : undefined;

  if (selected) return selected;

  const fallbackPool = Object.values(buckets)
    .flat()
    .filter((card) => !usedIds.has(card.id));

  return pickRandom(fallbackPool.length > 0 ? fallbackPool : Object.values(buckets).flat(), 1, usedIds)[0];
}

export function drawXYReverseSlotCard({ setPool, allowBreak, set = {}, usedIds = new Set() }) {
  const pools = Array.isArray(setPool) ? buildPools(setPool, set) : setPool;
  const profile = getPullRateProfile(set);
  const reverseConfig = profile.preRareSlot || profile.reverseOrBreakSlot || profile.reverseSlot || {};
  const breakPool = pools.cleanCards.filter((card) => isBreakCard(card) && !usedIds.has(card.id));
  const breakRate = allowBreak && breakPool.length > 0 ? reverseConfig.breakCard || 0 : 0;

  if (breakRate > 0 && Math.random() < breakRate) {
    return pickRandom(breakPool, 1, usedIds)[0];
  }

  const reversePool = [
    ...pools.commonPool,
    ...pools.uncommonPool,
    ...buildXYFinalRareBuckets(pools, set).regularRare,
  ].filter((card) => !usedIds.has(card.id) && !isBreakCard(card));

  return pickRandom(reversePool.length > 0 ? reversePool : pools.reverseSlotPool, 1, usedIds)[0];
}

export function getFinalSlotCategoryDiagnostics(finalSlotPool, set = {}) {
  const profile = getPullRateProfile(set);
  const weights = getFinalSlotWeights(profile);
  const cardsByCategory = groupCardsByCategory(finalSlotPool, new Set(), set);
  const availableCategories = new Set(Object.keys(cardsByCategory));
  const poolCounts = Object.fromEntries(
    Object.entries(cardsByCategory).map(([category, cards]) => [category, cards.length])
  );
  const activeWeights = Object.fromEntries(
    Object.keys(cardsByCategory)
      .map((category) => [category, getProfileWeightForCategory(category, profile, set, availableCategories)])
      .filter(([, weight]) => weight > 0)
  );
  const categoriesWithoutWeight = Object.keys(cardsByCategory).filter(
    (category) => getProfileWeightForCategory(category, profile, set, availableCategories) <= 0
  );
  const profileWeightsWithoutCards = Object.keys(weights).filter(
    (category) => (weights[category] || 0) > 0 && !cardsByCategory[category]
  );

  return {
    activeWeights,
    categoriesWithoutWeight,
    cardsByCategory,
    poolCounts,
    configuredWeights: weights,
    profileWeightsWithoutCards,
  };
}

function weightedRandomCategory(weightedCategories) {
  const totalWeight = weightedCategories.reduce((sum, [, weight]) => sum + weight, 0);

  if (totalWeight <= 0) return undefined;

  let roll = Math.random() * totalWeight;

  for (const [category, weight] of weightedCategories) {
    roll -= weight;

    if (roll <= 0) return category;
  }

  return weightedCategories.at(-1)?.[0];
}

export function pickFinalSlotCard(finalSlotPool, set = {}, usedIds = new Set()) {
  const profile = getPullRateProfile(set);
  const cardsByCategory = groupCardsByCategory(finalSlotPool, usedIds, set);
  const availableCategories = new Set(Object.keys(cardsByCategory));
  const weightedCategories = Object.keys(cardsByCategory)
    .map((category) => [category, getProfileWeightForCategory(category, profile, set, availableCategories)])
    .filter(([, weight]) => weight > 0);
  const chosenCategory = weightedRandomCategory(weightedCategories);
  const cardsInCategory = chosenCategory ? cardsByCategory[chosenCategory] : [];
  const selected = pickRandom(cardsInCategory || [], 1, usedIds)[0];

  if (selected) return selected;

  const fallbackPool = finalSlotPool.filter((card) => !usedIds.has(card.id));
  return pickRandom(fallbackPool.length > 0 ? fallbackPool : finalSlotPool, 1, usedIds)[0];
}

export function weightedRandom(cards, profile = pullRateProfiles[defaultPullRateProfile], usedIds = new Set(), set = {}) {
  const cardsByCategory = groupCardsByCategory(cards, usedIds, set);
  const availableCategories = new Set(Object.keys(cardsByCategory));
  const weightedCategories = Object.keys(cardsByCategory)
    .map((category) => [category, getProfileWeightForCategory(category, profile, set, availableCategories)])
    .filter(([, weight]) => weight > 0);
  const chosenCategory = weightedRandomCategory(weightedCategories);
  const cardsInCategory = chosenCategory ? cardsByCategory[chosenCategory] : [];
  const selected = pickRandom(cardsInCategory || [], 1, usedIds)[0];

  if (selected) return selected;

  const fallbackPool = cards.filter((card) => !usedIds.has(card.id));
  return pickRandom(fallbackPool.length > 0 ? fallbackPool : cards, 1, usedIds)[0];
}

export function isSubsetCard(card, set = {}) {
  return getSubsetType(card, set) !== "";
}

export function getSubsetType(card, set = {}) {
  const setId = normalizeSetId(set);
  const text = cardSearchText(card);
  const number = normalizeText(card.number);
  const subset = normalizeText(card.subset);

  if (isRadiantCollectionCard(card)) return "radiantCollection";
  if (subset.includes("shiny vault") || number.startsWith("sv")) return "shinyVault";
  if (subset.includes("classic collection") || text.includes("classic collection")) {
    return "classicCollection";
  }
  if (subset.includes("trainer gallery") || number.startsWith("tg") || text.includes("trainer gallery")) {
    return "trainerGallery";
  }
  if (subset.includes("galarian gallery") || number.startsWith("gg") || text.includes("galarian gallery")) {
    return "galarianGallery";
  }
  if (text.includes("radiant")) return "radiant";
  if (text.includes("ace spec")) return "aceSpec";
  if (text.includes("master ball")) return "masterball";
  if (text.includes("poke ball") || text.includes("pokeball")) return "pokeball";
  if (
    ["paldean-fates", "prismatic-evolutions", "shrouded-fable"].includes(setId) &&
    text.includes("shiny")
  ) {
    return "shiny";
  }

  return "";
}

export function getSubsetSlotConfig(set = {}) {
  const setId = normalizeSetId(set);
  const hardcoded = hardcodedPullRates[setId]?.subsetSlot;

  if (hardcoded) {
    return {
      ...hardcoded,
      rates: hardcoded.rates || {},
      legacy: false,
    };
  }

  const rule = SUBSET_SLOT_RULES[setId];

  if (!rule) return null;

  return {
    type: rule.type,
    subsetTypes: rule.subsetTypes,
    rates: {
      normal: rule.normalWeight || 0,
      regular: rule.regularWeight || 0,
      premium: rule.premiumWeight || 0,
      chase: rule.chaseWeight || 0,
    },
    legacy: true,
  };
}

function isPremiumSubsetCard(card) {
  return PREMIUM_SUBSET_CATEGORIES.has(getRarityCategory(card));
}

function isChaseSubsetCard(card) {
  return ["victiniRare", "blackWhiteRare", "megaHyperRare", "hyperRare", "secretRare"].includes(
    getRarityCategory(card)
  );
}

export function getSubsetSlotWeight(card, set = {}) {
  const config = getSubsetSlotConfig(set);

  if (!config || !isSubsetCard(card, set)) return 0;

  const rateKey = getSubsetRateKey(card, set, config);

  return config.rates[rateKey] || 0;
}

function getSubsetRateKey(card, set = {}, config = getSubsetSlotConfig(set)) {
  const category = getRarityCategory(card, set);
  const subsetType = getSubsetType(card, set);
  const rates = config?.rates || {};

  if (config?.legacy) {
    if (isChaseSubsetCard(card)) return "chase";
    if (isPremiumSubsetCard(card)) return "premium";

    return "regular";
  }

  if (rates[category] !== undefined) return category;
  if (rates[subsetType] !== undefined) return subsetType;
  if (subsetType === "classicCollection" && rates.classicCollection !== undefined) return "classicCollection";
  if (subsetType === "trainerGallery" && rates.trainerGallery !== undefined) return "trainerGallery";
  if (subsetType === "radiant" && rates.radiantRare !== undefined) return "radiantRare";
  if (subsetType === "aceSpec" && rates.aceSpecRare !== undefined) return "aceSpecRare";

  if (subsetType === "galarianGallery") {
    if (isPremiumSubsetCard(card) && rates.premiumGalarianGallery !== undefined) return "premiumGalarianGallery";
    if (rates.galarianGallery !== undefined) return "galarianGallery";
  }

  if (subsetType === "shinyVault" || subsetType === "shiny") {
    if ((category === "shinyUltraRare" || isPremiumSubsetCard(card)) && rates.shinyUltraRare !== undefined) {
      return "shinyUltraRare";
    }
    if (rates.shinyRare !== undefined) return "shinyRare";
  }

  if (rates.regular !== undefined) return "regular";

  return "";
}

function pickRandom(pool, count, usedIds = new Set()) {
  const picks = [];
  const available = [...pool];

  while (picks.length < count && available.length > 0) {
    const unusedCards = available.filter((card) => !usedIds.has(card.id));
    const source = unusedCards.length > 0 ? unusedCards : available;
    const selected = source[Math.floor(Math.random() * source.length)];
    const availableIndex = available.findIndex((card) => card.id === selected.id);

    if (availableIndex >= 0) available.splice(availableIndex, 1);

    usedIds.add(selected.id);
    picks.push({ ...selected });
  }

  return picks;
}

function pickWeightedSubset(pool, set, usedIds = new Set()) {
  const available = pool.filter((card) => !usedIds.has(card.id));
  const source = available.length > 0 ? available : pool;
  const weightedCards = source
    .map((card) => ({ card, weight: getSubsetSlotWeight(card, set) }))
    .filter(({ weight }) => weight > 0);
  const totalWeight = weightedCards.reduce((sum, { weight }) => sum + weight, 0);

  if (totalWeight <= 0) return undefined;

  let roll = Math.random() * totalWeight;

  for (const { card, weight } of weightedCards) {
    roll -= weight;

    if (roll <= 0) {
      usedIds.add(card.id);
      return { ...card };
    }
  }

  const fallback = weightedCards.at(-1)?.card;

  if (fallback) {
    usedIds.add(fallback.id);
    return { ...fallback };
  }

  return undefined;
}

function getSubsetBucket(card) {
  if (isChaseSubsetCard(card)) return "chase";
  if (isPremiumSubsetCard(card)) return "premium";

  return "regular";
}

function pickSubsetFromBucket(pool, bucket, set, usedIds = new Set()) {
  const bucketPool = pool.filter((card) => getSubsetBucket(card) === bucket);
  const fallbackPool = pool.filter((card) => getSubsetSlotWeight(card, set) > 0);
  const source = bucketPool.length > 0 ? bucketPool : fallbackPool;

  return pickRandom(source, 1, usedIds)[0];
}

function buildPools(cards, set = {}) {
  const cleanCards = cards
    .filter((card) => !isCodeCard(card))
    .filter((card) => !isActualEnergyCard(card))
    .map((card) => ({
      ...card,
      rarityCategory: getRarityCategory(card, set),
      subsetType: getSubsetType(card, set),
    }));
  const mainCards = cleanCards.filter((card) => !isSubsetCard(card, set));
  const commonPool = mainCards.filter((card) => card.rarityCategory === "common");
  const uncommonPool = mainCards.filter((card) => card.rarityCategory === "uncommon");
  const reverseSlotPool = mainCards.filter((card) => REVERSE_SLOT_CATEGORIES.has(card.rarityCategory));
  const finalSlotPool = mainCards.filter((card) => FINAL_SLOT_CATEGORIES.has(card.rarityCategory));
  const subsetPool = cleanCards.filter((card) => getSubsetSlotWeight(card, set) > 0);

  return {
    cleanCards,
    mainCards,
    commonPool,
    uncommonPool,
    reverseSlotPool,
    finalSlotPool,
    subsetPool,
  };
}

export function getPackPools(cardsOrSet, maybeSet) {
  const { cards, set } = getCardsAndSet(cardsOrSet, maybeSet);
  const pools = buildPools(cards, set);

  return {
    commonPool: pools.commonPool,
    uncommonPool: pools.uncommonPool,
    reverseSlotPool: pools.reverseSlotPool,
    finalSlotPool: pools.finalSlotPool,
    subsetPool: pools.subsetPool,
    mainCards: pools.mainCards,
    cleanCards: pools.cleanCards,
  };
}

export function pickRegularOrSubsetSlot(cardsOrPools, set = {}, usedIds = new Set()) {
  const pools = Array.isArray(cardsOrPools) ? buildPools(cardsOrPools, set) : cardsOrPools;
  const config = getSubsetSlotConfig(set);
  const rates = config?.rates || {};
  const subsetRateEntries = Object.entries(rates)
    .filter(([key, weight]) => key !== "normal" && weight > 0)
    .map(([key, weight]) => {
      const cards = pools.subsetPool.filter((card) => getSubsetRateKey(card, set, config) === key);

      return [key, weight, cards];
    })
    .filter(([, , cards]) => cards.length > 0);
  const normalWeight = config && subsetRateEntries.length > 0 ? rates.normal || 0 : 100;
  const totalWeight = normalWeight + subsetRateEntries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * totalWeight;

  roll -= normalWeight;

  if (roll > 0) {
    for (const [, weight, cards] of subsetRateEntries) {
      roll -= weight;

      if (roll <= 0) {
        const subsetCard = pickRandom(cards, 1, usedIds)[0];

        if (subsetCard) return subsetCard;
      }
    }
  }

  return pickRandom(pools.reverseSlotPool, 1, usedIds)[0];
}

function warnMissingPools(set, details) {
  const missing = Object.entries(details)
    .filter(([, isReady]) => !isReady)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.warn(
      `Could not generate a complete pack for ${set?.name || set?.id || "this set"}. Missing: ${missing.join(", ")}.`
    );
  }
}

function drawReplacementNonEnergyCard(card, pools, set, blockedIds) {
  const category = card?.rarityCategory || getRarityCategory(card, set);
  const sameRarityPool = pools.cleanCards.filter(
    (candidate) => candidate.rarityCategory === category && !blockedIds.has(candidate.id)
  );
  const fallbackPool = pools.cleanCards.filter((candidate) => !blockedIds.has(candidate.id));
  const source = sameRarityPool.length > 0 ? sameRarityPool : fallbackPool;

  if (source.length === 0) return undefined;

  return { ...source[Math.floor(Math.random() * source.length)] };
}

function removeEnergyFromPack(pack, pools, set) {
  const blockedIds = new Set(pack.filter((card) => !isActualEnergyCard(card)).map((card) => card.id));

  return pack.map((card) => {
    if (!isActualEnergyCard(card)) return card;

    const replacement = drawReplacementNonEnergyCard(card, pools, set, blockedIds);

    if (!replacement) return card;

    blockedIds.add(replacement.id);
    return replacement;
  });
}

function hasXYFinalRareCard(pools, set = {}) {
  return Object.values(buildXYFinalRareBuckets(pools, set)).some((bucket) => bucket.length > 0);
}

export function canGeneratePack(cardsOrSet, maybeSet) {
  const { cards, set } = getCardsAndSet(cardsOrSet, maybeSet);
  const pools = buildPools(cards, set);
  const finalRareSlotPool = getFinalRareSlotPool(pools, set);

  if (isXYSet(set)) {
    const profile = getPullRateProfile(set);
    const profileName = getConfiguredProfileName(set);

    if (profileName === "xyKalosStarter") return pools.commonPool.length >= profile.packSize;

    if (profileName === "xyGenerations") {
      const radiantPool = pools.cleanCards.filter(isRadiantCollectionCard);

      return (
        pools.commonPool.length >= profile.coreSlots.commonSlots &&
        pools.uncommonPool.length >= profile.coreSlots.uncommonSlots &&
        pools.reverseSlotPool.length >= 1 &&
        hasXYFinalRareCard(pools, set) &&
        radiantPool.length >= profile.radiantCollectionCards
      );
    }

    return (
      pools.commonPool.length >= (profile.commonSlots || XY_PACK_SLOTS.commons) &&
      pools.uncommonPool.length >= (profile.uncommonSlots || XY_PACK_SLOTS.uncommons) &&
      pools.reverseSlotPool.length >= XY_PACK_SLOTS.reverseOrBreak &&
      hasXYFinalRareCard(pools, set)
    );
  }

  if (getPackSize(set) === 4) {
    return pools.mainCards.length >= MINI_PACK_SLOTS.regular && finalRareSlotPool.length >= MINI_PACK_SLOTS.final;
  }

  return (
    pools.commonPool.length >= PACK_SLOTS.commons &&
    pools.uncommonPool.length >= PACK_SLOTS.uncommons &&
    pools.reverseSlotPool.length >= PACK_SLOTS.regular + PACK_SLOTS.regularOrSubset &&
    finalRareSlotPool.length >= PACK_SLOTS.final
  );
}

function generateMiniPack(set, pools, profile, usedIds) {
  const setId = normalizeSetId(set);
  const regularPool = pools.reverseSlotPool.length > 0 ? pools.reverseSlotPool : pools.mainCards;
  const firstRegularCards = pickRandom(regularPool, MINI_PACK_SLOTS.regular - 1, usedIds);
  const possibleSubsetCard =
    setId === "celebrations" ? pickRegularOrSubsetSlot({ ...pools, reverseSlotPool: pools.mainCards }, set, usedIds) : undefined;
  const lastRegularCards = possibleSubsetCard
    ? [possibleSubsetCard]
    : pickRandom(regularPool, 1, usedIds);
  const finalCard = pickFinalSlotCard(pools.finalSlotPool, set, usedIds);
  const pack = [
    ...firstRegularCards,
    ...lastRegularCards,
    ...(finalCard ? [finalCard] : []),
  ];

  if (pack.length !== 4) {
    warnMissingPools(set, {
      regularCards: firstRegularCards.length + lastRegularCards.length === MINI_PACK_SLOTS.regular,
      finalSlot: Boolean(finalCard),
    });
  }

  return removeEnergyFromPack(pack.slice(0, 4), pools, set);
}

function pickXYUncommons(pools, set = {}, usedIds = new Set()) {
  const profile = getPullRateProfile(set);
  const uncommons = pickRandom(pools.uncommonPool, profile.uncommonSlots || XY_PACK_SLOTS.uncommons, usedIds);
  const secretPool = buildXYFinalRareBuckets(pools, set).secretRare.filter((card) => !usedIds.has(card.id));
  const secretRate = getConfiguredProfileName(set) === "xyEvolutions" ? profile.uncommonSecretRate || 0 : 0;

  if (secretRate > 0 && secretPool.length > 0 && uncommons.length > 0 && Math.random() < secretRate) {
    const secretCard = pickRandom(secretPool, 1, usedIds)[0];

    if (secretCard) {
      const replaced = uncommons.pop();

      if (replaced) usedIds.delete(replaced.id);

      uncommons.push(secretCard);
    }
  }

  return uncommons;
}

function pickRadiantCollectionCard(radiantPool, weights, usedIds = new Set()) {
  const available = radiantPool.filter((card) => !usedIds.has(card.id));
  const groups = {
    radiantCommonUncommon: available.filter((card) => ["common", "uncommon"].includes(card.rarityCategory)),
    radiantRareOrBetter: available.filter((card) => !["common", "uncommon"].includes(card.rarityCategory)),
    radiantRare: available.filter((card) => card.rarityCategory === "rare" || card.rarityCategory === "holoRare"),
    radiantEX: available.filter((card) => card.rarityCategory === "doubleRare"),
    radiantFullArt: available.filter((card) => card.rarityCategory === "ultraRare" || card.rarityCategory === "fullArt"),
  };
  const weightedGroups = Object.entries(weights)
    .filter(([key, weight]) => key !== "slot" && weight > 0 && groups[key]?.length > 0)
    .map(([key, weight]) => [key, weight]);
  const chosenGroup = weightedRandomCategory(weightedGroups);

  if (chosenGroup) return pickRandom(groups[chosenGroup], 1, usedIds)[0];

  return pickRandom(available.length > 0 ? available : radiantPool, 1, usedIds)[0];
}

function generateXYKalosStarterPack(set, pools, usedIds) {
  const profile = getPullRateProfile(set);
  const pack = pickRandom(pools.commonPool, profile.packSize || 10, usedIds);

  if (pack.length !== (profile.packSize || 10)) {
    warnMissingPools(set, {
      commonCards: pack.length === (profile.packSize || 10),
    });
  }

  return removeEnergyFromPack(pack.slice(0, profile.packSize || 10), pools, set);
}

function generateXYGenerationsPack(set, pools, usedIds) {
  const profile = getPullRateProfile(set);
  const coreSlots = profile.coreSlots;
  const radiantPool = pools.cleanCards.filter(isRadiantCollectionCard);
  const commons = pickRandom(pools.commonPool, coreSlots.commonSlots, usedIds);
  const uncommons = pickRandom(pools.uncommonPool, coreSlots.uncommonSlots, usedIds);
  const reverseCard = drawXYReverseSlotCard({
    setPool: pools,
    allowBreak: false,
    set,
    usedIds,
  });
  const finalCard = pickFromXYFinalRareBuckets({ ...pools, cleanCards: pools.mainCards }, set, usedIds);
  const radiantCards = profile.radiantCollectionSlots
    .map((slotWeights) => pickRadiantCollectionCard(radiantPool, slotWeights, usedIds))
    .filter(Boolean);
  const pack = [
    ...commons,
    ...uncommons,
    ...(reverseCard ? [reverseCard] : []),
    ...(finalCard ? [finalCard] : []),
    ...radiantCards,
  ];

  if (pack.length !== profile.packSize) {
    warnMissingPools(set, {
      commons: commons.length === coreSlots.commonSlots,
      uncommons: uncommons.length === coreSlots.uncommonSlots,
      reverseSlot: Boolean(reverseCard),
      finalSlot: Boolean(finalCard),
      radiantCollection: radiantCards.length === profile.radiantCollectionCards,
    });
  }

  return removeEnergyFromPack(pack.slice(0, profile.packSize), pools, set);
}

function generateXYPack(set, pools, usedIds) {
  const profile = getPullRateProfile(set);
  const profileName = getConfiguredProfileName(set);

  if (profileName === "xyKalosStarter") return generateXYKalosStarterPack(set, pools, usedIds);
  if (profileName === "xyGenerations") return generateXYGenerationsPack(set, pools, usedIds);

  const commons = pickRandom(pools.commonPool, profile.commonSlots || XY_PACK_SLOTS.commons, usedIds);
  const uncommons = pickXYUncommons(pools, set, usedIds);
  const reverseOrBreakCard = drawXYReverseSlotCard({
    setPool: pools,
    allowBreak: isXYBreakSet(set),
    set,
    usedIds,
  });
  const finalCard = pickFromXYFinalRareBuckets(pools, set, usedIds);
  const pack = [
    ...commons,
    ...uncommons,
    ...(reverseOrBreakCard ? [reverseOrBreakCard] : []),
    ...(finalCard ? [finalCard] : []),
  ];

  if (pack.length !== profile.packSize) {
    warnMissingPools(set, {
      commons: commons.length === (profile.commonSlots || XY_PACK_SLOTS.commons),
      uncommons: uncommons.length === (profile.uncommonSlots || XY_PACK_SLOTS.uncommons),
      reverseOrBreakSlot: Boolean(reverseOrBreakCard),
      finalSlot: Boolean(finalCard),
    });
  }

  return removeEnergyFromPack(pack.slice(0, profile.packSize), pools, set);
}

function withPackMetadata(cards, metadata = {}) {
  Object.assign(cards, {
    isGodPack: false,
    ...metadata,
  });

  return cards;
}

function pickWeightedGodPackFormat(config) {
  if (!config?.formats?.length) return config?.format;

  const totalWeight = config.formats.reduce((sum, format) => sum + (format.weight || 0), 0);

  if (totalWeight <= 0) return config.formats[0].format;

  let roll = Math.random() * totalWeight;

  for (const format of config.formats) {
    roll -= format.weight || 0;

    if (roll <= 0) return format.format;
  }

  return config.formats.at(-1)?.format;
}

function getGodPackConfig(set = {}) {
  return GOD_PACK_CONFIG[normalizeSetId(set)];
}

function normalizeCardName(cardOrName) {
  return normalizeText(typeof cardOrName === "string" ? cardOrName : cardOrName?.name);
}

function findCardByNameAndRarity(cards, target) {
  const targetName = normalizeCardName(target.name);
  const targetRarity = normalizeRarity(target.rarity);

  return cards.find((card) => normalizeCardName(card) === targetName && normalizeRarity(card.rarity) === targetRarity);
}

function fillUniqueFromPool(pack, pool, count, usedIds) {
  const needed = count - pack.length;

  if (needed <= 0) return pack;

  pack.push(...pickRandom(pool, needed, usedIds));
  return pack;
}

function orderGodPackFinalCardLast(cards, set = {}) {
  if (cards.length <= 1) return cards;

  const ranked = [...cards].sort((a, b) => {
    const score = (card) => {
      if (isSpecialIllustrationRare(card)) return 7;
      if (getRarityCategory(card, set) === "megaHyperRare") return 6;
      if (["hyperRare", "secretRare", "rainbowRare"].includes(getRarityCategory(card, set))) return 5;
      if (["ultraRare", "fullArt", "alternateArt", "megaDoubleRare"].includes(getRarityCategory(card, set))) return 4;
      if (isIllustrationRare(card)) return 3;
      if (getRarityCategory(card, set) === "doubleRare") return 2;
      return 1;
    };

    return score(a) - score(b);
  });

  return ranked;
}

function replacePackTail(normalPack, replacementCards, metadata) {
  const count = replacementCards.length;
  const safePack = normalPack.slice(0, Math.max(0, normalPack.length - count));

  return withPackMetadata([...safePack, ...replacementCards].slice(0, normalPack.length), metadata);
}

function generate151DemiGodPack(set, pools, profile, config, selectedFormat) {
  const normalPack = generateNormalPack(set, pools, profile, new Set());
  const groups = GOD_PACK_GROUPS[151].evolutionLines
    .map((line) => ({
      ...line,
      cards: line.cards.map((target) => findCardByNameAndRarity(pools.cleanCards, target)).filter(Boolean),
    }))
    .filter((line) => line.cards.length === 3);
  const selectedLine = groups[Math.floor(Math.random() * groups.length)];

  if (!selectedLine) {
    return withPackMetadata(normalPack, { isGodPack: false });
  }

  return replacePackTail(normalPack, selectedLine.cards.map((card) => ({ ...card })), {
    isGodPack: true,
    godPackType: config.type,
    godPackFormat: selectedFormat,
    godPackDisplayName: config.displayName,
    godPackGroupName: selectedLine.name,
  });
}

function isPrismaticEeveelutionPremium(card, set = {}) {
  const name = normalizeCardName(card);

  return PRISMATIC_EEVEELUTION_NAMES.has(name) && isPremiumArtHit(card, set);
}

function generatePrismaticFullGodPack(set, pools, config, selectedFormat) {
  const packSize = getPackSize(set);
  const usedIds = new Set();
  const orderedCards = PRISMATIC_FULL_GOD_PACK_ORDER.map((target) =>
    findCardByNameAndRarity(pools.cleanCards, target)
  ).filter(Boolean);
  const premiumFallback = pools.cleanCards.filter((card) => isPremiumArtHit(card, set));

  if (orderedCards.length < packSize) {
    console.warn("Prismatic Evolutions full God Pack pool is incomplete", {
      expectedCount: packSize,
      foundCount: orderedCards.length,
    });
  }

  orderedCards.forEach((card) => usedIds.add(card.id));
  fillUniqueFromPool(orderedCards, premiumFallback, packSize, usedIds);
  fillUniqueFromPool(orderedCards, pools.finalSlotPool, packSize, usedIds);

  return withPackMetadata(orderedCards.slice(0, packSize).map((card) => ({ ...card })), {
    isGodPack: true,
    godPackType: config.type,
    godPackFormat: selectedFormat,
    godPackDisplayName: config.displayName,
  });
}

function generatePrismaticDemiGodPack(set, pools, profile, config, selectedFormat) {
  const normalPack = generateNormalPack(set, pools, profile, new Set());
  const usedIds = new Set();
  const eeveelutionHits = pools.cleanCards.filter((card) => isPrismaticEeveelutionPremium(card, set));
  const replacementCards = pickRandom(eeveelutionHits, 3, usedIds);

  if (replacementCards.length < 3) {
    fillUniqueFromPool(replacementCards, pools.cleanCards.filter((card) => isPremiumArtHit(card, set)), 3, usedIds);
  }

  if (replacementCards.length < 3) {
    return withPackMetadata(normalPack, { isGodPack: false });
  }

  return replacePackTail(normalPack, orderGodPackFinalCardLast(replacementCards, set), {
    isGodPack: true,
    godPackType: "demiGodPack",
    godPackFormat: selectedFormat,
    godPackDisplayName: "Demi-God Pack",
  });
}

function generateNineIRsOneSIRPack(set, pools, config, selectedFormat) {
  const packSize = getPackSize(set);
  const usedIds = new Set();
  const irCards = pickRandom(pools.cleanCards.filter(isIllustrationRare), Math.max(0, packSize - 1), usedIds);
  const sirCard = pickRandom(pools.cleanCards.filter(isSpecialIllustrationRare), 1, usedIds);
  const fallbackPool = pools.cleanCards.filter((card) => isPremiumArtHit(card, set));
  const cards = [...irCards];

  fillUniqueFromPool(cards, fallbackPool, Math.max(0, packSize - 1), usedIds);

  const finalCards = [
    ...cards.slice(0, Math.max(0, packSize - 1)),
    ...(sirCard.length > 0 ? sirCard : pickRandom(fallbackPool, 1, usedIds)),
  ].filter(Boolean);

  fillUniqueFromPool(finalCards, fallbackPool, packSize, usedIds);

  return withPackMetadata(finalCards.slice(0, packSize), {
    isGodPack: true,
    godPackType: config.type,
    godPackFormat: selectedFormat,
    godPackDisplayName: config.displayName,
  });
}

function generateAscendedHeroesGodPack(set, pools, config, selectedFormat) {
  const packSize = getPackSize(set);
  const usedIds = new Set();
  const megaAttackRarePool = pools.cleanCards.filter((card) => isMegaAttackRare(card) && !isActualEnergyCard(card));
  const sirPool = pools.cleanCards.filter((card) => isSpecialIllustrationRare(card) && !isActualEnergyCard(card));
  const megaAttackRares = pickRandom(megaAttackRarePool, 3, usedIds);
  const sirs = pickRandom(sirPool, 7, usedIds);

  if (megaAttackRares.length < 3 || sirs.length < 7) {
    console.warn("Ascended Heroes God Pack pool is incomplete", {
      megaAttackRareCount: megaAttackRarePool.length,
      sirCount: sirPool.length,
    });
  }

  const cards = [...megaAttackRares, ...sirs];

  return withPackMetadata(cards.slice(0, packSize), {
    isGodPack: true,
    godPackType: config.type,
    godPackFormat: selectedFormat,
    godPackDisplayName: config.displayName,
  });
}

function generateGodPack(set, pools, profile, config, forcedFormat) {
  const setId = normalizeSetId(set);
  const selectedFormat = forcedFormat || pickWeightedGodPackFormat(config);

  if (setId === "151") return generate151DemiGodPack(set, pools, profile, config, selectedFormat);
  if (selectedFormat === "PRISMATIC_FULL_EEVEELUTION_PACK") {
    return generatePrismaticFullGodPack(set, pools, config, selectedFormat);
  }
  if (selectedFormat === "PRISMATIC_DEMI_GOD_PACK") {
    return generatePrismaticDemiGodPack(set, pools, profile, config, selectedFormat);
  }
  if (selectedFormat === "BLACK_BOLT_9_IR_1_SIR" || selectedFormat === "WHITE_FLARE_9_IR_1_SIR") {
    return generateNineIRsOneSIRPack(set, pools, config, selectedFormat);
  }
  if (selectedFormat === "ASCENDED_HEROES_3_MAR_7_SIR") {
    return generateAscendedHeroesGodPack(set, pools, config, selectedFormat);
  }

  return withPackMetadata(generateNormalPack(set, pools, profile, new Set()), { isGodPack: false });
}

function generateNormalPack(set, pools, profile, usedIds) {
  if (getPackSize(set) === 4) {
    return generateMiniPack(set, pools, profile, usedIds);
  }

  if (isXYSet(set)) {
    return generateXYPack(set, pools, usedIds);
  }

  const commons = pickRandom(pools.commonPool, PACK_SLOTS.commons, usedIds);
  const uncommons = pickRandom(pools.uncommonPool, PACK_SLOTS.uncommons, usedIds);
  const regularSlot = pickRandom(pools.reverseSlotPool, PACK_SLOTS.regular, usedIds);
  const regularOrSubsetCard = isModernSVSet(set)
    ? pickModernSVPreRareSlot(pools, set, usedIds)
    : pickRegularOrSubsetSlot(pools, set, usedIds);
  const finalCard = pickFinalSlotCard(getFinalRareSlotPool(pools, set), set, usedIds);
  const pack = [
    ...commons,
    ...uncommons,
    ...regularSlot,
    ...(regularOrSubsetCard ? [regularOrSubsetCard] : []),
    ...(finalCard ? [finalCard] : []),
  ];

  if (pack.length !== 10) {
    warnMissingPools(set, {
      commons: commons.length === PACK_SLOTS.commons,
      uncommons: uncommons.length === PACK_SLOTS.uncommons,
      regularSlots: regularSlot.length === PACK_SLOTS.regular && Boolean(regularOrSubsetCard),
      finalSlot: Boolean(finalCard),
    });
  }

  return removeEnergyFromPack(pack.slice(0, 10), pools, set);
}

export function generatePack(cardsOrSet, maybeSet) {
  const { cards, set } = getCardsAndSet(cardsOrSet, maybeSet);
  const pools = buildPools(cards, set);
  const profile = getPullRateProfile(set);
  const godPackConfig = getGodPackConfig(set);

  if (godPackConfig?.enabled && Math.random() < godPackConfig.odds) {
    return generateGodPack(set, pools, profile, godPackConfig);
  }

  return withPackMetadata(generateNormalPack(set, pools, profile, new Set()), { isGodPack: false });
}

export function generateForcedGodPack(cardsOrSet, maybeSet, forcedFormat) {
  const { cards, set } = getCardsAndSet(cardsOrSet, maybeSet);
  const pools = buildPools(cards, set);
  const profile = getPullRateProfile(set);
  const godPackConfig = getGodPackConfig(set);

  if (!godPackConfig?.enabled) {
    return withPackMetadata(generateNormalPack(set, pools, profile, new Set()), { isGodPack: false });
  }

  return generateGodPack(set, pools, profile, godPackConfig, forcedFormat);
}

export function isChaseRare(card) {
  return ["victiniRare", "blackWhiteRare", "megaHyperRare"].includes(getRarityCategory(card));
}

export function isHigherThanRare(card) {
  return HIGHER_THAN_RARE_CATEGORIES.has(getRarityCategory(card));
}

export function isRareOrHigher(card) {
  return FINAL_SLOT_CATEGORIES.has(getRarityCategory(card));
}

export function getFoilClass(card) {
  const category = getRarityCategory(card);

  if (["victiniRare", "blackWhiteRare", "megaHyperRare"].includes(category)) {
    return "card-foil card-foil--chase";
  }

  if (
    [
      "illustrationRare",
      "specialIllustrationRare",
      "secretRare",
      "hyperRare",
      "rainbowRare",
      "classicCollection",
      "galarianGallery",
      "trainerGallery",
      "shinyRare",
      "shinyUltraRare",
      "radiantRare",
      "aceSpecRare",
    ].includes(category)
  ) {
    return "card-foil card-foil--higher";
  }

  if (["doubleRare", "gx", "pokemonV", "vmaxOrVstar", "ultraRare", "fullArt", "megaDoubleRare"].includes(category)) {
    return "card-foil card-foil--higher";
  }

  if (["rare", "holoRare"].includes(category)) {
    return "card-foil card-foil--rare";
  }

  return "";
}

