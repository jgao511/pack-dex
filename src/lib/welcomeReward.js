import { supabase } from "./supabaseClient.js";

const WELCOME_REWARD_TABLE = "user_welcome_rewards";

function isEligibleUser(user) {
  return Boolean(user?.id);
}

function logWelcomeRewardDebug(stage, { error, user, rowMissing, isEligible } = {}) {
  console.warn("Welcome reward debug", {
    stage,
    userId: user?.id || "",
    rowMissing,
    isEligible,
    userCreatedAt: user?.created_at || "",
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
  });
}

function normalizeRewardRow(row, user) {
  if (!row) {
    return {
      isEligible: isEligibleUser(user),
      isClaimed: !isEligibleUser(user),
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
    logWelcomeRewardDebug("select", {
      error,
      user,
      rowMissing: undefined,
      isEligible: isEligibleUser(user),
    });
    throw error;
  }

  const status = normalizeRewardRow(data, user);

  if (status.rowMissing) {
    logWelcomeRewardDebug("missing-row", {
      user,
      rowMissing: true,
      isEligible: status.isEligible,
    });
  }

  return status;
}

export async function claimWelcomeReward(setId, userOverride) {
  throw new Error("Welcome rewards must be claimed through the secure backend function.");
}
