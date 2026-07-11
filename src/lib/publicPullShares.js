import { supabase } from "./supabaseClient.js";

export async function createPublicPullShare({ setId, cardIds, packNumber = null } = {}) {
  if (!supabase) throw new Error("Sharing is unavailable right now.");

  const { data, error } = await supabase.functions.invoke("create-pull-share", {
    body: { set_id: setId, card_ids: cardIds, pack_number: packNumber },
  });
  if (error) throw error;
  if (!data?.url || !data?.share_code) throw new Error("Unable to create pull share.");
  return data;
}

export async function getPublicPullShare(shareCode) {
  if (!supabase) throw new Error("Sharing is unavailable right now.");

  const { data, error } = await supabase.functions.invoke("get-pull-share", {
    body: { share_code: shareCode },
  });
  if (error) throw error;
  return data?.share || null;
}
