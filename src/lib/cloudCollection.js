import { supabase } from "./supabaseClient.js";

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
