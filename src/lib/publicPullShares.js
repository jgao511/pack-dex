import { supabase } from "./supabaseClient.js";

const pullShareResults = new Map();
const pullSharePromises = new Map();

export async function createPublicPullShare({ setId, cardIds, packNumber = null } = {}) {
  if (!supabase) throw new Error("Sharing is unavailable right now.");

  const { data, error } = await supabase.functions.invoke("create-pull-share", {
    body: { set_id: setId, card_ids: cardIds, pack_number: packNumber },
  });
  if (error) throw error;
  if (!data?.share_code) throw new Error("Unable to create pull share.");
  return data;
}

async function fetchPublicPullShare(shareCode) {
  if (!supabase) throw new Error("Sharing is unavailable right now.");

  const { data, error } = await supabase.functions.invoke("get-pull-share", {
    body: { share_code: shareCode },
  });
  if (error) throw error;
  return data?.share || null;
}

export function getPublicPullShare(shareCode) {
  const key = String(shareCode || "");
  if (!key) return Promise.resolve(null);
  if (pullShareResults.has(key)) return Promise.resolve(pullShareResults.get(key));
  if (pullSharePromises.has(key)) return pullSharePromises.get(key);

  const promise = fetchPublicPullShare(key)
    .then((share) => {
      pullShareResults.set(key, share);
      return share;
    })
    .finally(() => pullSharePromises.delete(key));
  pullSharePromises.set(key, promise);
  return promise;
}
