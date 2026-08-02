import { getCardImageUrl } from "../../../src/utils/assetUrls.js";
import { getCardCollectionKey } from "../../../src/utils/collectionStorage.js";
import {
  generateForcedGodPack,
  getDisplayCardName,
  getDisplayRarity,
} from "../../../src/utils/packGenerator.js";
import oneFiftyOneCards from "../../../src/data/151.json" with { type: "json" };
import ascendedHeroesCards from "../../../src/data/ascended-heroes.json" with { type: "json" };
import blackBoltCards from "../../../src/data/black-bolt.json" with { type: "json" };
import prismaticEvolutionsCards from "../../../src/data/prismatic-evolutions.json" with { type: "json" };
import whiteFlareCards from "../../../src/data/white-flare.json" with { type: "json" };

type PackDexCard = Record<string, unknown>;
type WelcomeRewardSet = {
  id: string;
  name: string;
  setFolder: string;
  pullRateProfile: string;
  cards: PackDexCard[];
};

const WELCOME_REWARD_SETS: Record<string, WelcomeRewardSet> = {
  "prismatic-evolutions": {
    id: "prismatic-evolutions",
    name: "Prismatic Evolutions",
    setFolder: "prismatic-evolutions",
    pullRateProfile: "scarletVioletSpecial",
    cards: prismaticEvolutionsCards,
  },
  "black-bolt": {
    id: "black-bolt",
    name: "Black Bolt",
    setFolder: "black-bolt",
    pullRateProfile: "blackBoltWhiteFlare2025",
    cards: blackBoltCards,
  },
  "white-flare": {
    id: "white-flare",
    name: "White Flare",
    setFolder: "white-flare",
    pullRateProfile: "blackBoltWhiteFlare2025",
    cards: whiteFlareCards,
  },
  "ascended-heroes": {
    id: "ascended-heroes",
    name: "Ascended Heroes",
    setFolder: "ascended-heroes",
    pullRateProfile: "megaEvolutionStandard",
    cards: ascendedHeroesCards,
  },
  "151": {
    id: "151",
    name: "151",
    setFolder: "151",
    pullRateProfile: "scarletVioletSpecial",
    cards: oneFiftyOneCards,
  },
};

export function findWelcomeRewardSet(setId: string) {
  return WELCOME_REWARD_SETS[setId] || null;
}

export function generateWelcomeRewardGodPack(set: WelcomeRewardSet, forcedFormat?: string) {
  return generateForcedGodPack(set, set, forcedFormat);
}

export function compactWelcomeRewardCard(card: PackDexCard, set: WelcomeRewardSet, slotIndex: number) {
  return {
    id: card.id ? String(card.id) : getCardCollectionKey(card, set.id),
    setId: set.id,
    setFolder: String(card.setFolder || set.setFolder),
    name: getDisplayCardName(card, set),
    number: String(card.number || ""),
    rarity: getDisplayRarity(card, set),
    rarityCategory: card.rarityCategory,
    pullCategory: card.pullCategory || card.rarityCategory,
    subset: card.subset || "",
    subsetType: card.subsetType || "",
    imagePath: card.imagePath || card.image || "",
    fileName: card.fileName || card.imageFileName || card.filename || "",
    image_url: getCardImageUrl(card),
    slot: slotIndex + 1,
  };
}
