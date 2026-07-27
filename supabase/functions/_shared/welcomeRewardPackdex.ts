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

function compactCollectionCard(card: PackDexCard, set: WelcomeRewardSet, quantity = 1) {
  return {
    card_id: getCardCollectionKey(card, set.id),
    set_id: set.id,
    quantity,
    card_name: getDisplayCardName(card, set),
    card_number: String(card.number || ""),
    rarity: getDisplayRarity(card, set),
    image_url: getCardImageUrl(card),
    card_data: null,
  };
}

export async function upsertWelcomeRewardCards(
  admin: any,
  userId: string,
  cards: PackDexCard[],
  set: WelcomeRewardSet,
) {
  const grouped = new Map<string, ReturnType<typeof compactCollectionCard>>();

  for (const card of cards) {
    const payload = compactCollectionCard(card, set);
    const existing = grouped.get(payload.card_id);
    grouped.set(payload.card_id, {
      ...payload,
      quantity: (existing?.quantity || 0) + 1,
    });
  }

  const groupedRows = [...grouped.values()];
  const cardIds = groupedRows.map((row) => row.card_id);
  const { data: existingRows, error: existingError } = await admin
    .from("user_collection")
    .select("card_id, quantity")
    .eq("user_id", userId)
    .eq("set_id", set.id)
    .in("card_id", cardIds);
  if (existingError) throw existingError;

  const existingQuantities = new Map(
    (existingRows || []).map((row: Record<string, unknown>) => [
      String(row.card_id),
      Number(row.quantity || 0),
    ]),
  );
  const existingCardIds = new Set(existingQuantities.keys());
  const timestamp = new Date().toISOString();
  const rows = groupedRows.map((row) => ({
    ...row,
    user_id: userId,
    quantity: (existingQuantities.get(row.card_id) || 0) + row.quantity,
    updated_at: timestamp,
  }));

  for (const row of rows.filter((candidate) => existingCardIds.has(candidate.card_id))) {
    const { error } = await admin
      .from("user_collection")
      .update({
        quantity: row.quantity,
        card_name: row.card_name,
        card_number: row.card_number,
        rarity: row.rarity,
        image_url: row.image_url,
        card_data: null,
        updated_at: timestamp,
      })
      .eq("user_id", userId)
      .eq("set_id", row.set_id)
      .eq("card_id", row.card_id);
    if (error) throw error;
  }

  const rowsToInsert = rows.filter((candidate) => !existingCardIds.has(candidate.card_id));
  if (rowsToInsert.length > 0) {
    const { error } = await admin.from("user_collection").insert(rowsToInsert);
    if (error) throw error;
  }
}

export async function incrementWelcomeRewardStats(
  admin: any,
  userId: string,
  { packsOpened = 0, totalCardsPulled = 0 },
) {
  const { data: existingStats, error: loadError } = await admin
    .from("user_profile_stats")
    .select("packs_opened,total_cards_pulled")
    .eq("user_id", userId)
    .maybeSingle();
  if (loadError) throw loadError;

  const { data, error } = await admin
    .from("user_profile_stats")
    .upsert({
      user_id: userId,
      packs_opened: Number(existingStats?.packs_opened || 0) + Number(packsOpened || 0),
      total_cards_pulled: Number(existingStats?.total_cards_pulled || 0) + Number(totalCardsPulled || 0),
    }, { onConflict: "user_id" })
    .select("packs_opened,total_cards_pulled")
    .single();
  if (error) throw error;

  return {
    packsOpened: Number(data?.packs_opened || 0),
    totalCardsPulled: Number(data?.total_cards_pulled || 0),
  };
}
