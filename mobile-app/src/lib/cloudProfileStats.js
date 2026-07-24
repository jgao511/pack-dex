import { supabase } from "./supabaseClient.js";
import { countDevRequest } from "../utils/requestDiagnostics.js";

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

export async function loadCloudProfileStats(userId, { totalCardsPulled = null } = {}) {
  countDevRequest("loadCloudProfileStats");
  if (!supabase || !userId) return emptyProfileStats();

  const { data: profileRow, error: profileError } = await supabase
    .from(USER_PROFILE_STATS_TABLE)
    .select("packs_opened,total_cards_pulled")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    console.warn("Unable to load mobile stored profile stats; using trusted derived stats", { userId, error: profileError });
  }

  const storedStats = fromCloudStats(profileRow);
  return {
    packsOpened: Number(storedStats.packsOpened || 0),
    totalCardsPulled: Number.isFinite(Number(totalCardsPulled))
      ? Number(totalCardsPulled)
      : Number(storedStats.totalCardsPulled || 0),
  };
}
