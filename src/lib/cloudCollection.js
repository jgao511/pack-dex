import { sets } from "../data/sets.js";
import { getCardImageUrl } from "../utils/assetUrls.js";
import { getCardCollectionKey } from "../utils/collectionStorage.js";
import { getDisplayCardName, getDisplayRarity } from "../utils/packGenerator.js";
import { supabase } from "./supabaseClient.js";

const USER_COLLECTION_TABLE = "user_collection";

function nowIso() {
  return new Date().toISOString();
}

function findSet(setId) {
  return sets.find((set) => set.id === setId);
}

function findCard(setId, cardId) {
  const set = findSet(setId);

  return set?.cards?.find((card) => getCardCollectionKey(card, setId) === cardId) || null;
}

function getCloudCardPayload(card, setId, userId, quantity = 1) {
  const set = findSet(setId);
  const cardId = getCardCollectionKey(card, setId);
  const timestamp = nowIso();

  return {
    user_id: userId,
    card_id: cardId,
    set_id: setId,
    quantity,
    card_name: getDisplayCardName(card, set),
    card_number: String(card?.number || ""),
    rarity: getDisplayRarity(card, set),
    image_url: getCardImageUrl(card),
    card_data: null,
    updated_at: timestamp,
  };
}

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

export async function incrementCloudCardQuantity(card, setId, amount = 1) {
  const user = await getCurrentUser();

  if (!user) return null;

  const cardId = getCardCollectionKey(card, setId);
  const { data: existing, error: selectError } = await supabase
    .from(USER_COLLECTION_TABLE)
    .select("id, quantity")
    .eq("user_id", user.id)
    .eq("set_id", setId)
    .eq("card_id", cardId)
    .limit(1)
    .maybeSingle();

  if (selectError) {
    console.warn("Unable to check cloud collection card", selectError);
    throw selectError;
  }

  if (existing) {
    const quantity = Number(existing.quantity || 0) + amount;
    const { error: updateError } = await supabase
      .from(USER_COLLECTION_TABLE)
      .update({
        quantity,
        updated_at: nowIso(),
      })
      .eq("id", existing.id)
      .eq("user_id", user.id);

    if (updateError) {
      console.warn("Unable to update cloud collection card", updateError);
      throw updateError;
    }

    return { cardId, quantity };
  }

  const payload = {
    ...getCloudCardPayload(card, setId, user.id, amount),
    created_at: nowIso(),
  };
  const { error: insertError } = await supabase.from(USER_COLLECTION_TABLE).insert(payload);

  if (insertError) {
    console.warn("Unable to insert cloud collection card", insertError);
    throw insertError;
  }

  return { cardId, quantity: amount };
}

export async function savePulledCardToCloud(card, setId) {
  return incrementCloudCardQuantity(card, setId, 1);
}

export async function savePulledCardsToCloud(cards, setId) {
  const groupedCards = new Map();

  cards.forEach((card) => {
    const cardId = getCardCollectionKey(card, setId);
    const existing = groupedCards.get(cardId);

    groupedCards.set(cardId, {
      card,
      quantity: (existing?.quantity || 0) + 1,
    });
  });

  return Promise.all(
    [...groupedCards.values()].map(({ card, quantity }) => incrementCloudCardQuantity(card, setId, quantity))
  );
}

export async function syncLocalCollectionToCloud(localCollection) {
  const user = await getCurrentUser();

  if (!user) return {};

  const tasks = [];

  Object.entries(localCollection || {}).forEach(([setId, setCollection]) => {
    Object.entries(setCollection || {}).forEach(([cardId, entry]) => {
      const card = findCard(setId, cardId);
      const quantity = Number(entry?.count || 0);

      if (!card || quantity <= 0) return;

      tasks.push(incrementCloudCardQuantity(card, setId, quantity));
    });
  });

  await Promise.all(tasks);

  return loadCloudCollection();
}

export async function deleteCloudCard(cardId, setId) {
  const user = await getCurrentUser();

  if (!user) return;

  const { error } = await supabase
    .from(USER_COLLECTION_TABLE)
    .delete()
    .eq("user_id", user.id)
    .eq("set_id", setId)
    .eq("card_id", cardId);

  if (error) {
    console.warn("Unable to delete cloud collection card", error);
    throw error;
  }
}

export async function clearCloudCollection() {
  const user = await getCurrentUser();

  if (!user) return;

  const { error } = await supabase.from(USER_COLLECTION_TABLE).delete().eq("user_id", user.id);

  if (error) {
    console.warn("Unable to clear cloud collection", error);
    throw error;
  }
}
