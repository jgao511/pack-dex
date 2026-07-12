import { sets } from "../../../src/data/sets.js";

export function getWishlistKey(setId, cardId) {
  return `${String(setId)}:${String(cardId)}`;
}

export function resolveCatalogWishlistItem(setId, cardId) {
  const set = sets.find((candidate) => candidate.id === setId);
  const card = set?.cards?.find((candidate) => String(candidate.id) === String(cardId));
  return set && card ? { set, card } : null;
}

export async function loadWishlist(supabase, userId) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase.from("user_wishlist").select("set_id,card_id,created_at").eq("user_id", userId);
  if (error) throw error;
  return (data || []).map((row) => ({ setId: row.set_id, cardId: row.card_id, createdAt: row.created_at }));
}

export async function addWishlistCard(supabase, userId, setId, cardId) {
  if (!resolveCatalogWishlistItem(setId, cardId)) throw new Error("This card is not available in the PackDex catalog.");
  const { error } = await supabase.from("user_wishlist").upsert(
    { user_id: userId, set_id: setId, card_id: String(cardId) },
    { onConflict: "user_id,set_id,card_id", ignoreDuplicates: true }
  );
  if (error) throw error;
}

export async function removeWishlistCard(supabase, userId, setId, cardId) {
  const { error } = await supabase.from("user_wishlist").delete().eq("user_id", userId).eq("set_id", setId).eq("card_id", String(cardId));
  if (error) throw error;
}
