const WOTC_STANDARD_SET_IDS = [
  "jungle",
  "fossil",
  "team-rocket",
  "neo-discovery",
  "neo-revelation",
  "neo-destiny",
];

const ECARD_SET_IDS = ["expedition-base-set", "aquapolis", "skyridge"];

const EX_SET_IDS = [
  "ex-ruby-sapphire",
  "ex-sandstorm",
  "ex-dragon",
  "ex-team-magma-vs-team-aqua",
  "ex-hidden-legends",
  "ex-firered-leafgreen",
  "ex-team-rocket-returns",
  "ex-deoxys",
  "ex-emerald",
  "ex-unseen-forces",
  "ex-delta-species",
  "ex-legend-maker",
  "ex-holon-phantoms",
  "ex-crystal-guardians",
  "ex-dragon-frontiers",
  "ex-power-keepers",
];

const DP_SET_IDS = [
  "diamond-pearl",
  "diamond-pearl-mysterious-treasures",
  "diamond-pearl-secret-wonders",
  "diamond-pearl-great-encounters",
  "diamond-pearl-majestic-dawn",
  "diamond-pearl-legends-awakened",
  "diamond-pearl-stormfront",
];

const PLATINUM_SET_IDS = ["platinum", "platinum-rising-rivals", "platinum-supreme-victors", "platinum-arceus"];

const HGSS_SET_IDS = ["heartgold-soulsilver", "hs-unleashed", "hs-undaunted", "hs-triumphant", "call-of-legends"];

const BLACK_WHITE_SET_IDS = [
  "black-white",
  "black-white-emerging-powers",
  "black-white-noble-victories",
  "black-white-next-destinies",
  "black-white-dark-explorers",
  "black-white-dragons-exalted",
  "black-white-boundaries-crossed",
  "black-white-plasma-storm",
  "black-white-plasma-freeze",
  "black-white-plasma-blast",
];

function defineSetIds(ids, config) {
  return Object.fromEntries(ids.map((id) => [id, { ...config }]));
}

export const VINTAGE_PACK_RULES = {
  "base-set": {
    type: "wotc",
    packSize: 11,
    commonSlots: 5,
    basicEnergySlots: 2,
    uncommonSlots: 3,
    rareSlots: 1,
    holoChance: 1 / 3,
    basicEnergyFileNames: [
      "97_Fighting_Energy_Common.png",
      "98_Fire_Energy_Common.png",
      "99_Grass_Energy_Common.png",
      "100_Lightning_Energy_Common.png",
      "101_Psychic_Energy_Common.png",
      "102_Water_Energy_Common.png",
    ],
  },
  "base-set-2": {
    type: "wotc",
    packSize: 11,
    commonSlots: 5,
    basicEnergySlots: 2,
    uncommonSlots: 3,
    rareSlots: 1,
    holoChance: 1 / 3,
    basicEnergyFileNames: [
      "125_Fighting_Energy_Common.png",
      "126_Fire_Energy_Common.png",
      "127_Grass_Energy_Common.png",
      "128_Lightning_Energy_Common.png",
      "129_Psychic_Energy_Common.png",
      "130_Water_Energy_Common.png",
    ],
  },
  "gym-heroes": {
    type: "wotc",
    packSize: 11,
    commonSlots: 6,
    basicEnergySlots: 1,
    uncommonSlots: 3,
    rareSlots: 1,
    holoChance: 1 / 3,
    basicEnergyFileNames: [
      "127_Fighting_Energy_Common.png",
      "128_Fire_Energy_Common.png",
      "129_Grass_Energy_Common.png",
      "130_Lightning_Energy_Common.png",
      "131_Psychic_Energy_Common.png",
      "132_Water_Energy_Common.png",
    ],
  },
  "gym-challenge": {
    type: "wotc",
    packSize: 11,
    commonSlots: 6,
    basicEnergySlots: 1,
    uncommonSlots: 3,
    rareSlots: 1,
    holoChance: 1 / 3,
    basicEnergyFileNames: [
      "127_Fighting_Energy_Common.png",
      "128_Fire_Energy_Common.png",
      "129_Grass_Energy_Common.png",
      "130_Lightning_Energy_Common.png",
      "131_Psychic_Energy_Common.png",
      "132_Water_Energy_Common.png",
    ],
  },
  "neo-genesis": {
    type: "wotc",
    packSize: 11,
    commonSlots: 6,
    basicEnergySlots: 1,
    uncommonSlots: 3,
    rareSlots: 1,
    holoChance: 1 / 3,
    basicEnergyFileNames: [
      "106_Fighting_Energy_Common.png",
      "107_Fire_Energy_Common.png",
      "108_Grass_Energy_Common.png",
      "109_Lightning_Energy_Common.png",
      "110_Psychic_Energy_Common.png",
      "111_Water_Energy_Common.png",
    ],
  },
  "legendary-collection": {
    type: "wotc",
    packSize: 11,
    commonSlots: 7,
    basicEnergySlots: 0,
    uncommonSlots: 3,
    rareSlots: 1,
    holoChance: 1 / 3,
  },
  ...defineSetIds(WOTC_STANDARD_SET_IDS, {
    type: "wotc",
    packSize: 11,
    commonSlots: 7,
    basicEnergySlots: 0,
    uncommonSlots: 3,
    rareSlots: 1,
    holoChance: 1 / 3,
  }),
  ...defineSetIds(ECARD_SET_IDS, {
    type: "ecard",
    packSize: 9,
    commonSlots: 5,
    uncommonSlots: 2,
    reverseSlots: 1,
    rareSlots: 1,
    holoChance: 1 / 3,
  }),
  ...defineSetIds(EX_SET_IDS, {
    type: "ex",
    packSize: 9,
    commonSlots: 5,
    uncommonSlots: 2,
    reverseSlots: 1,
    rareSlots: 1,
    holoChance: 1 / 3,
  }),
  ...defineSetIds(DP_SET_IDS, {
    type: "diamondPearl",
    packSize: 10,
    commonSlots: 5,
    uncommonSlots: 3,
    reverseSlots: 1,
    rareSlots: 1,
    holoChance: 1 / 3,
  }),
  ...defineSetIds(PLATINUM_SET_IDS, {
    type: "platinum",
    packSize: 10,
    commonSlots: 5,
    uncommonSlots: 3,
    reverseSlots: 1,
    rareSlots: 1,
    holoChance: 1 / 3,
  }),
  ...defineSetIds(HGSS_SET_IDS, {
    type: "heartGoldSoulSilver",
    packSize: 10,
    commonSlots: 5,
    uncommonSlots: 3,
    reverseSlots: 1,
    rareSlots: 1,
    holoChance: 1 / 3,
  }),
  ...defineSetIds(BLACK_WHITE_SET_IDS, {
    type: "blackWhite",
    packSize: 10,
    commonSlots: 5,
    uncommonSlots: 3,
    reverseSlots: 1,
    rareSlots: 1,
    holoChance: 1 / 3,
  }),
  "dragon-vault": {
    type: "dragonVault",
    packSize: 5,
    regularSlots: 4,
    rareSlots: 1,
    allFoil: true,
  },
  "black-white-legendary-treasures": {
    type: "legendaryTreasures",
    packSize: 10,
    commonSlots: 5,
    uncommonSlots: 2,
    reverseSlots: 1,
    radiantCollectionSlots: 1,
    rareSlots: 1,
    holoChance: 1 / 3,
  },
};

export const VINTAGE_SET_IDS = new Set(Object.keys(VINTAGE_PACK_RULES));

export function getVintagePackRule(setOrId = {}) {
  const setId = typeof setOrId === "string" ? setOrId : setOrId?.id;

  return VINTAGE_PACK_RULES[setId] || null;
}

export function isVintageSet(setOrId = {}) {
  return Boolean(getVintagePackRule(setOrId));
}
