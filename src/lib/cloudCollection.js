import { supabase } from "./supabaseClient.js";
import { getCardImageUrl } from "../utils/assetUrls.js";
import { getCardCollectionKey } from "../utils/collectionStorage.js";
import { getDisplayCardName, getDisplayRarity } from "../utils/packGenerator.js";

const USER_COLLECTION_TABLE = "user_collection";

export async function getCurrentUser() {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.warn("Unable to read Supabase user", error);
    return null;
  }

  return data.user || null;
}

export async function loadCloudCollection() {
  const user = await getCurrentUser();

  if (!user) return {};

  const { data, error } = await supabase
    .from(USER_COLLECTION_TABLE)
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    console.warn("Unable to load cloud collection", error);
    throw error;
  }

  return cloudRowsToCollection(data || []);
}

function compactCardRow(card, set, quantity = 1) {
  const setId = String(set?.id || card?.setId || "");

  return {
    card_id: getCardCollectionKey(card, setId),
    set_id: setId,
    quantity,
    card_name: getDisplayCardName(card, set),
    card_number: String(card?.number || ""),
    rarity: getDisplayRarity(card, set),
    image_url: getCardImageUrl(card),
    card_data: null,
  };
}

export async function savePulledCardsToCloud(cards, set) {
  const user = await getCurrentUser();

  if (!user || !Array.isArray(cards) || cards.length === 0 || !set?.id) {
    return [];
  }

  const grouped = new Map();

  for (const card of cards) {
    const row = compactCardRow(card, set, 1);
    const existing = grouped.get(row.card_id);

    grouped.set(row.card_id, {
      ...row,
      quantity: (existing?.quantity || 0) + 1,
    });
  }

  const rows = [...grouped.values()];
  const cardIds = rows.map((row) => row.card_id);
  const { data: existingRows, error: existingError } = await supabase
    .from(USER_COLLECTION_TABLE)
    .select("card_id, quantity")
    .eq("user_id", user.id)
    .eq("set_id", String(set.id))
    .in("card_id", cardIds);

  if (existingError) {
    console.warn("Unable to load existing cloud cards before save", existingError);
    throw existingError;
  }

  const existingQuantities = new Map((existingRows || []).map((row) => [row.card_id, Number(row.quantity || 0)]));
  const existingCardIds = new Set((existingRows || []).map((row) => row.card_id));
  const rowsToUpdate = rows.filter((row) => existingCardIds.has(row.card_id));
  const rowsToInsert = rows.filter((row) => !existingCardIds.has(row.card_id));

  for (const row of rowsToUpdate) {
    const { error } = await supabase
      .from(USER_COLLECTION_TABLE)
      .update({
        quantity: (existingQuantities.get(row.card_id) || 0) + row.quantity,
        card_name: row.card_name,
        card_number: row.card_number,
        rarity: row.rarity,
        image_url: row.image_url,
        card_data: null,
      })
      .eq("user_id", user.id)
      .eq("set_id", row.set_id)
      .eq("card_id", row.card_id);

    if (error) {
      console.warn("Unable to update cloud card", error);
      throw error;
    }
  }

  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from(USER_COLLECTION_TABLE).insert(
      rowsToInsert.map((row) => ({
        ...row,
        user_id: user.id,
      }))
    );

    if (error) {
      console.warn("Unable to insert cloud cards", error);
      throw error;
    }
  }

  return rows;
}

export function cloudRowsToCollection(rows) {
  return rows.reduce((collection, row) => {
    const setId = String(row.set_id || "");
    const cardId = String(row.card_id || "");

    if (!setId || !cardId) return collection;

    const setCollection = collection[setId] || {};
    const createdAt = row.created_at ? Date.parse(row.created_at) : Date.now();
    const updatedAt = row.updated_at ? Date.parse(row.updated_at) : createdAt;

    return {
      ...collection,
      [setId]: {
        ...setCollection,
        [cardId]: {
          count: Number(row.quantity || 0),
          firstCollectedAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
          lastCollectedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
        },
      },
    };
  }, {});
}
