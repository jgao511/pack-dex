import { supabase } from "./supabaseClient.js";

function assertSupabaseConfigured() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
}

function normalizeFunctionCards(data) {
  if (Array.isArray(data?.cards)) return data.cards;
  if (Array.isArray(data?.pack?.cards)) return data.pack.cards;
  if (Array.isArray(data?.pack)) return data.pack;

  return [];
}

export async function openPackAndSaveResult(setId) {
  assertSupabaseConfigured();

  const { data, error } = await supabase.functions.invoke("open-pack", {
    body: { set_id: setId },
  });

  if (error) {
    throw error;
  }

  const cards = normalizeFunctionCards(data);

  if (!cards.length) {
    throw new Error("The secure pack service did not return cards.");
  }

  Object.assign(cards, {
    isGodPack: Boolean(data?.isGodPack || data?.pack?.isGodPack),
    godPackFormat: data?.godPackFormat || data?.pack?.godPackFormat || "",
    godPackDisplayName: data?.godPackDisplayName || data?.pack?.godPackDisplayName || "",
  });

  return {
    cards,
    collection: data?.collection || null,
  };
}

export async function claimWelcomeGodPack(setId) {
  assertSupabaseConfigured();

  const { data, error } = await supabase.functions.invoke("claim-welcome-god-pack", {
    body: { set_id: setId },
  });

  if (error) {
    throw error;
  }

  const cards = normalizeFunctionCards(data);

  if (!cards.length) {
    throw new Error(data?.message || "The welcome reward service did not return cards.");
  }

  Object.assign(cards, {
    isGodPack: true,
    godPackDisplayName: "Welcome God Pack",
    godPackFormat: data?.godPackFormat || "",
    welcomeReward: true,
  });

  return {
    cards,
    status: data?.rewardStatus || data?.status || null,
    collection: data?.collection || null,
  };
}
