import { supabase } from "./supabaseClient.js";

const USER_PROFILE_STATS_TABLE = "user_profile_stats";
const USER_COLLECTION_TABLE = "user_collection";
const USER_PACK_OPEN_EVENTS_TABLE = "user_pack_open_events";
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

function sumCollectionQuantities(rows = []) {
  return rows.reduce((total, row) => {
    const quantity = Number(row?.quantity || 0);

    return Number.isFinite(quantity) && quantity > 0 ? total + quantity : total;
  }, 0);
}

export async function loadCloudProfileStats(userId) {
  if (!supabase || !userId) return emptyProfileStats();

  const [{ data: profileRow, error: profileError }, { data: collectionRows, error: collectionError }, { count: packOpenCount, error: packOpenError }] =
    await Promise.all([
      supabase
        .from(USER_PROFILE_STATS_TABLE)
        .select("packs_opened,total_cards_pulled")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from(USER_COLLECTION_TABLE)
        .select("quantity")
        .eq("user_id", userId),
      supabase
        .from(USER_PACK_OPEN_EVENTS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

  if (collectionError || packOpenError) {
    console.warn("Unable to load mobile trusted profile stats", {
      userId,
      collectionError,
      packOpenError,
    });
    throw collectionError || packOpenError;
  }

  if (profileError) {
    console.warn("Unable to load mobile stored profile stats; using trusted derived stats", { userId, error: profileError });
  }

  const storedStats = fromCloudStats(profileRow);
  const storedPacksOpened = Number(storedStats.packsOpened || 0);
  const eventPacksOpened = Number(packOpenCount || 0);

  return {
    packsOpened: Math.max(
      Number.isFinite(storedPacksOpened) ? storedPacksOpened : 0,
      Number.isFinite(eventPacksOpened) ? eventPacksOpened : 0
    ),
    totalCardsPulled: sumCollectionQuantities(collectionRows || []),
  };
}

export async function loadStoredCloudProfileStats(userId) {
  if (!supabase || !userId) return emptyProfileStats();

  const { data, error } = await supabase
    .from(USER_PROFILE_STATS_TABLE)
    .select("packs_opened,total_cards_pulled")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Unable to load mobile stored cloud profile stats", { userId, error });
    throw error;
  }

  return fromCloudStats(data);
}

export async function incrementCloudProfileStats(userId, { packsOpened = 0, totalCardsPulled = 0 } = {}) {
  console.warn("Browser profile stat increments are disabled; use recordPackOpenEvent instead.", {
    userId,
    packsOpened,
    totalCardsPulled,
  });

  return loadCloudProfileStats(userId);
}