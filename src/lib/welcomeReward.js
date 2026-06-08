import { supabase } from "./supabaseClient.js";

const WELCOME_REWARD_TABLE = "user_welcome_rewards";
const WELCOME_REWARD_FEATURE_CUTOFF = "2026-06-07T00:00:00.000Z";

function nowIso() {
  return new Date().toISOString();
}

function isEligibleNewUser(user) {
  const createdAt = Date.parse(user?.created_at || "");
  const cutoff = Date.parse(WELCOME_REWARD_FEATURE_CUTOFF);

  return Number.isFinite(createdAt) && createdAt >= cutoff;
}

function normalizeRewardRow(row, user) {
  if (!row) {
    return {
      isEligible: isEligibleNewUser(user),
      isClaimed: !isEligibleNewUser(user),
      setId: "",
      claimedAt: "",
      rowMissing: true,
    };
  }

  return {
    isEligible: true,
    isClaimed: Boolean(row.welcome_god_pack_claimed),
    setId: row.welcome_god_pack_set || "",
    claimedAt: row.welcome_reward_claimed_at || "",
    rowMissing: false,
  };
}

async function getCurrentUser() {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.warn("Unable to read current user for welcome reward", error);
    return null;
  }

  return data.user || null;
}

export async function loadWelcomeRewardStatus(userOverride) {
  if (!supabase) return { isEligible: false, isClaimed: true, setId: "", claimedAt: "" };

  const user = userOverride || (await getCurrentUser());

  if (!user) return { isEligible: false, isClaimed: true, setId: "", claimedAt: "" };

  const { data, error } = await supabase
    .from(WELCOME_REWARD_TABLE)
    .select("user_id, welcome_god_pack_claimed, welcome_god_pack_set, welcome_reward_claimed_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("Unable to load welcome reward status", error);
    throw error;
  }

  const status = normalizeRewardRow(data, user);

  if (!status.rowMissing || !status.isEligible) return status;

  const { data: inserted, error: insertError } = await supabase
    .from(WELCOME_REWARD_TABLE)
    .insert({
      user_id: user.id,
      welcome_god_pack_claimed: false,
    })
    .select("user_id, welcome_god_pack_claimed, welcome_god_pack_set, welcome_reward_claimed_at")
    .single();

  if (insertError) {
    console.warn("Unable to create welcome reward row", insertError);
    throw insertError;
  }

  return normalizeRewardRow(inserted, user);
}

export async function claimWelcomeReward(setId, userOverride) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const user = userOverride || (await getCurrentUser());

  if (!user) throw new Error("Log in to claim your welcome reward.");

  const status = await loadWelcomeRewardStatus(user);

  if (!status.isEligible) throw new Error("This welcome reward is only available for new accounts.");
  if (status.isClaimed) throw new Error("This welcome reward has already been claimed.");

  const timestamp = nowIso();
  const { data, error } = await supabase
    .from(WELCOME_REWARD_TABLE)
    .update({
      welcome_god_pack_claimed: true,
      welcome_god_pack_set: setId,
      welcome_reward_claimed_at: timestamp,
    })
    .eq("user_id", user.id)
    .eq("welcome_god_pack_claimed", false)
    .select("user_id, welcome_god_pack_claimed, welcome_god_pack_set, welcome_reward_claimed_at")
    .maybeSingle();

  if (error) {
    console.warn("Unable to claim welcome reward", error);
    throw error;
  }

  if (!data) {
    throw new Error("This welcome reward was already claimed.");
  }

  return normalizeRewardRow(data, user);
}

