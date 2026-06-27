import { supabase } from "./supabaseClient.js";

const USER_PROFILE_STATS_TABLE = "user_profile_stats";
const EMPTY_PROFILE_STATS = {
  packsOpened: 0,
  totalCardsPulled: 0,
};

export function emptyProfileStats() {
  return { ...EMPTY_PROFILE_STATS };
}

function fromCloudStats(row) {
  if (!row) return emptyProfileStats();

  return {
    packsOpened: Number(row.packs_opened || 0),
    totalCardsPulled: Number(row.total_cards_pulled || 0),
  };
}

export async function loadCloudProfileStats(userId) {
  if (!supabase || !userId) return emptyProfileStats();

  const { data, error } = await supabase
    .from(USER_PROFILE_STATS_TABLE)
    .select("packs_opened,total_cards_pulled")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Unable to load mobile cloud profile stats", { userId, error });
    throw error;
  }

  return fromCloudStats(data);
}

export async function incrementCloudProfileStats(userId, { packsOpened = 0, totalCardsPulled = 0 } = {}) {
  if (!supabase || !userId) return emptyProfileStats();

  const currentStats = await loadCloudProfileStats(userId);
  const nextStats = {
    packsOpened: currentStats.packsOpened + Number(packsOpened || 0),
    totalCardsPulled: currentStats.totalCardsPulled + Number(totalCardsPulled || 0),
  };

  const { data, error } = await supabase
    .from(USER_PROFILE_STATS_TABLE)
    .upsert(
      {
        user_id: userId,
        packs_opened: nextStats.packsOpened,
        total_cards_pulled: nextStats.totalCardsPulled,
      },
      { onConflict: "user_id" }
    )
    .select("packs_opened,total_cards_pulled")
    .single();

  if (error) {
    console.warn("Unable to increment mobile cloud profile stats", {
      userId,
      packsOpened,
      totalCardsPulled,
      error,
    });
    throw error;
  }

  return fromCloudStats(data);
}
