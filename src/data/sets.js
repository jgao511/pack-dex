import sunMoonCards from "./sun-moon.json";
import guardiansRisingCards from "./guardians-rising.json";
import burningShadowsCards from "./burning-shadows.json";
import shiningLegendsCards from "./shining-legends.json";
import crimsonInvasionCards from "./crimson-invasion.json";
import ultraPrismCards from "./ultra-prism.json";
import forbiddenLightCards from "./forbidden-light.json";
import celestialStormCards from "./celestial-storm.json";
import dragonMajestyCards from "./dragon-majesty.json";
import lostThunderCards from "./lost-thunder.json";
import teamUpCards from "./team-up.json";
import detectivePikachuCards from "./detective-pikachu.json";
import unbrokenBondsCards from "./unbroken-bonds.json";
import unifiedMindsCards from "./unified-minds.json";
import hiddenFatesCards from "./hidden-fates.json";
import cosmicEclipseCards from "./cosmic-eclipse.json";
import swordShieldCards from "./sword-shield.json";
import rebelClashCards from "./rebel-clash.json";
import darknessAblazeCards from "./darkness-ablaze.json";
import championsPathCards from "./champions-path.json";
import vividVoltageCards from "./vivid-voltage.json";
import shiningFatesCards from "./shining-fates.json";
import battleStylesCards from "./battle-styles.json";
import chillingReignCards from "./chilling-reign.json";
import evolvingSkiesCards from "./evolving-skies.json";
import celebrationsCards from "./celebrations.json";
import fusionStrikeCards from "./fusion-strike.json";
import brilliantStarsCards from "./brilliant-stars.json";
import astralRadianceCards from "./astral-radiance.json";
import pokemonGoCards from "./pokemon-go.json";
import lostOriginCards from "./lost-origin.json";
import silverTempestCards from "./silver-tempest.json";
import crownZenithCards from "./crown-zenith.json";
import scarletVioletCards from "./scarlet-violet.json";
import paldeaEvolvedCards from "./paldea-evolved.json";
import obsidianFlamesCards from "./obsidian-flames.json";
import oneFiftyOneCards from "./151.json";
import paradoxRiftCards from "./paradox-rift.json";
import paldeanFatesCards from "./paldean-fates.json";
import temporalForcesCards from "./temporal-forces.json";
import twilightMasqueradeCards from "./twilight-masquerade.json";
import shroudedFableCards from "./shrouded-fable.json";
import stellarCrownCards from "./stellar-crown.json";
import surgingSparksCards from "./surging-sparks.json";
import prismaticEvolutionsCards from "./prismatic-evolutions.json";
import journeyTogetherCards from "./journey-together.json";
import destinedRivalsCards from "./destined-rivals.json";
import blackBoltCards from "./black-bolt.json";
import whiteFlareCards from "./white-flare.json";
import megaEvolutionCards from "./mega-evolution.json";
import phantasmalFlamesCards from "./phantasmal-flames.json";
import ascendedHeroesCards from "./ascended-heroes.json";
import perfectOrderCards from "./perfect-order.json";
import chaosRisingCards from "./chaos-rising.json";
import xy0Cards from "./xy0.json";
import xy1Cards from "./xy1.json";
import xy2Cards from "./xy2.json";
import xy3Cards from "./xy3.json";
import xy4Cards from "./xy4.json";
import xy5Cards from "./xy5.json";
import doubleCrisisCards from "./dc1.json";
import xy6Cards from "./xy6.json";
import xy7Cards from "./xy7.json";
import xy8Cards from "./xy8.json";
import xy9Cards from "./xy9.json";
import generationsCards from "./g1.json";
import xy10Cards from "./xy10.json";
import xy11Cards from "./xy11.json";
import xy12Cards from "./xy12.json";
import xySetConfig from "./xySetConfig.json";

const pullRateProfilesBySet = {
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

const releaseDatesBySet = {
  "sun-moon": "2017-02-03",
  "guardians-rising": "2017-05-05",
  "burning-shadows": "2017-08-04",
  "shining-legends": "2017-10-06",
  "crimson-invasion": "2017-11-03",
  "ultra-prism": "2018-02-02",
  "forbidden-light": "2018-05-04",
  "celestial-storm": "2018-08-03",
  "dragon-majesty": "2018-09-07",
  "lost-thunder": "2018-11-02",
  "team-up": "2019-02-01",
  "detective-pikachu": "2019-04-05",
  "unbroken-bonds": "2019-05-03",
  "unified-minds": "2019-08-02",
  "hidden-fates": "2019-08-23",
  "cosmic-eclipse": "2019-11-01",
  "sword-shield": "2020-02-07",
  "rebel-clash": "2020-05-01",
  "darkness-ablaze": "2020-08-14",
  "champions-path": "2020-09-25",
  "vivid-voltage": "2020-11-13",
  "shining-fates": "2021-02-19",
  "battle-styles": "2021-03-19",
  "chilling-reign": "2021-06-18",
  "evolving-skies": "2021-08-27",
  celebrations: "2021-10-08",
  "fusion-strike": "2021-11-12",
  "brilliant-stars": "2022-02-25",
  "astral-radiance": "2022-05-27",
  "pokemon-go": "2022-07-01",
  "lost-origin": "2022-09-09",
  "silver-tempest": "2022-11-11",
  "crown-zenith": "2023-01-20",
  "scarlet-violet": "2023-03-31",
  "paldea-evolved": "2023-06-09",
  "obsidian-flames": "2023-08-11",
  151: "2023-09-22",
  "paradox-rift": "2023-11-03",
  "paldean-fates": "2024-01-26",
  "temporal-forces": "2024-03-22",
  "twilight-masquerade": "2024-05-24",
  "shrouded-fable": "2024-08-02",
  "stellar-crown": "2024-09-13",
  "surging-sparks": "2024-11-08",
  "prismatic-evolutions": "2025-01-17",
  "journey-together": "2025-03-28",
  "destined-rivals": "2025-05-30",
  "black-bolt": "2025-07-18",
  "white-flare": "2025-07-18",
  "mega-evolution": "2025-09-26",
  "phantasmal-flames": "2025-11-14",
  "ascended-heroes": "2026-01-30",
  "perfect-order": "2026-03-13",
  "chaos-rising": "2026-05-15",
};

function getEraForSet(id, metadata = {}) {
  if (metadata.era) return metadata.era;
  if (id.startsWith("mega-") || ["phantasmal-flames", "ascended-heroes", "perfect-order", "chaos-rising"].includes(id)) {
    return "Mega Evolution";
  }
  if (
    [
      "scarlet-violet",
      "paldea-evolved",
      "obsidian-flames",
      "151",
      "paradox-rift",
      "paldean-fates",
      "temporal-forces",
      "twilight-masquerade",
      "shrouded-fable",
      "stellar-crown",
      "surging-sparks",
      "prismatic-evolutions",
      "journey-together",
      "destined-rivals",
      "black-bolt",
      "white-flare",
    ].includes(id)
  ) {
    return "Scarlet & Violet";
  }
  if (
    [
      "sword-shield",
      "rebel-clash",
      "darkness-ablaze",
      "champions-path",
      "vivid-voltage",
      "shining-fates",
      "battle-styles",
      "chilling-reign",
      "evolving-skies",
      "celebrations",
      "fusion-strike",
      "brilliant-stars",
      "astral-radiance",
      "pokemon-go",
      "lost-origin",
      "silver-tempest",
      "crown-zenith",
    ].includes(id)
  ) {
    return "Sword & Shield";
  }

  return "Sun & Moon";
}

function createSet(id, name, cards, metadata = {}) {
  const setFolder = metadata.setFolder || id;

  return {
    id,
    name,
    ...metadata,
    setFolder,
    era: getEraForSet(id, metadata),
    releaseDate: metadata.releaseDate || releaseDatesBySet[id],
    isNew: metadata.isNew || ["perfect-order", "chaos-rising"].includes(id),
    pullRateProfile: pullRateProfilesBySet[id],
    logoPath: metadata.logoPath || `${setFolder}/logo.png`,
    packArtPath: metadata.packArtPath || `${setFolder}/pack.png`,
    cards,
  };
}

export const sets = [
  // XY
  createSet("xy0", xySetConfig.xy0.name, xy0Cards, xySetConfig.xy0),
  createSet("xy1", xySetConfig.xy1.name, xy1Cards, xySetConfig.xy1),
  createSet("xy2", xySetConfig.xy2.name, xy2Cards, xySetConfig.xy2),
  createSet("xy3", xySetConfig.xy3.name, xy3Cards, xySetConfig.xy3),
  createSet("xy4", xySetConfig.xy4.name, xy4Cards, xySetConfig.xy4),
  createSet("xy5", xySetConfig.xy5.name, xy5Cards, xySetConfig.xy5),
  createSet("dc1", xySetConfig.dc1.name, doubleCrisisCards, xySetConfig.dc1),
  createSet("xy6", xySetConfig.xy6.name, xy6Cards, xySetConfig.xy6),
  createSet("xy7", xySetConfig.xy7.name, xy7Cards, xySetConfig.xy7),
  createSet("xy8", xySetConfig.xy8.name, xy8Cards, xySetConfig.xy8),
  createSet("xy9", xySetConfig.xy9.name, xy9Cards, xySetConfig.xy9),
  createSet("g1", xySetConfig.g1.name, generationsCards, xySetConfig.g1),
  createSet("xy10", xySetConfig.xy10.name, xy10Cards, xySetConfig.xy10),
  createSet("xy11", xySetConfig.xy11.name, xy11Cards, xySetConfig.xy11),
  createSet("xy12", xySetConfig.xy12.name, xy12Cards, xySetConfig.xy12),

  // Sun & Moon
  createSet("sun-moon", "Sun & Moon", sunMoonCards),
  createSet("guardians-rising", "Guardians Rising", guardiansRisingCards),
  createSet("burning-shadows", "Burning Shadows", burningShadowsCards),
  createSet("shining-legends", "Shining Legends", shiningLegendsCards),
  createSet("crimson-invasion", "Crimson Invasion", crimsonInvasionCards),
  createSet("ultra-prism", "Ultra Prism", ultraPrismCards),
  createSet("forbidden-light", "Forbidden Light", forbiddenLightCards),
  createSet("celestial-storm", "Celestial Storm", celestialStormCards),
  createSet("dragon-majesty", "Dragon Majesty", dragonMajestyCards),
  createSet("lost-thunder", "Lost Thunder", lostThunderCards),
  createSet("team-up", "Team Up", teamUpCards),
  createSet("detective-pikachu", "Detective Pikachu", detectivePikachuCards),
  createSet("unbroken-bonds", "Unbroken Bonds", unbrokenBondsCards),
  createSet("unified-minds", "Unified Minds", unifiedMindsCards),
  createSet("hidden-fates", "Hidden Fates", hiddenFatesCards),
  createSet("cosmic-eclipse", "Cosmic Eclipse", cosmicEclipseCards),

  // Sword & Shield
  createSet("sword-shield", "Sword & Shield", swordShieldCards),
  createSet("rebel-clash", "Rebel Clash", rebelClashCards),
  createSet("darkness-ablaze", "Darkness Ablaze", darknessAblazeCards),
  createSet("champions-path", "Champion's Path", championsPathCards),
  createSet("vivid-voltage", "Vivid Voltage", vividVoltageCards),
  createSet("shining-fates", "Shining Fates", shiningFatesCards),
  createSet("battle-styles", "Battle Styles", battleStylesCards),
  createSet("chilling-reign", "Chilling Reign", chillingReignCards),
  createSet("evolving-skies", "Evolving Skies", evolvingSkiesCards),
  createSet("celebrations", "Celebrations", celebrationsCards),
  createSet("fusion-strike", "Fusion Strike", fusionStrikeCards),
  createSet("brilliant-stars", "Brilliant Stars", brilliantStarsCards),
  createSet("astral-radiance", "Astral Radiance", astralRadianceCards),
  createSet("pokemon-go", "Pokemon GO", pokemonGoCards),
  createSet("lost-origin", "Lost Origin", lostOriginCards),
  createSet("silver-tempest", "Silver Tempest", silverTempestCards),
  createSet("crown-zenith", "Crown Zenith", crownZenithCards),

  // Scarlet & Violet
  createSet("scarlet-violet", "Scarlet & Violet", scarletVioletCards),
  createSet("paldea-evolved", "Paldea Evolved", paldeaEvolvedCards),
  createSet("obsidian-flames", "Obsidian Flames", obsidianFlamesCards),
  createSet("151", "151", oneFiftyOneCards),
  createSet("paradox-rift", "Paradox Rift", paradoxRiftCards),
  createSet("paldean-fates", "Paldean Fates", paldeanFatesCards),
  createSet("temporal-forces", "Temporal Forces", temporalForcesCards),
  createSet("twilight-masquerade", "Twilight Masquerade", twilightMasqueradeCards),
  createSet("shrouded-fable", "Shrouded Fable", shroudedFableCards),
  createSet("stellar-crown", "Stellar Crown", stellarCrownCards),
  createSet("surging-sparks", "Surging Sparks", surgingSparksCards),
  createSet("prismatic-evolutions", "Prismatic Evolutions", prismaticEvolutionsCards),
  createSet("journey-together", "Journey Together", journeyTogetherCards),
  createSet("destined-rivals", "Destined Rivals", destinedRivalsCards),
  createSet("black-bolt", "Black Bolt", blackBoltCards),
  createSet("white-flare", "White Flare", whiteFlareCards),

  // Mega Evolution Series
  createSet("mega-evolution", "Mega Evolution", megaEvolutionCards),
  createSet("phantasmal-flames", "Phantasmal Flames", phantasmalFlamesCards),
  createSet("ascended-heroes", "Ascended Heroes", ascendedHeroesCards),
  createSet("perfect-order", "Perfect Order", perfectOrderCards),
  createSet("chaos-rising", "Chaos Rising", chaosRisingCards),
];
