import { supabase } from "./supabaseClient.js";
import { getCachedSupabaseUser } from "./sessionUserCache.js";

const WELCOME_REWARD_TABLE = "user_welcome_rewards";
const rewardStatusByUserId = new Map();
const rewardStatusPromisesByUserId = new Map();

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
  try {
    return await getCachedSupabaseUser(supabase);
  } catch (error) {
    console.warn("Unable to read current user for welcome reward", error);
    return null;
  }
}

export function cacheWelcomeRewardStatus(userId, status) {
  if (!userId || !status) return status;
  rewardStatusByUserId.set(String(userId), status);
  return status;
}

export function invalidateWelcomeRewardStatus(userId) {
  if (!userId) return;
  rewardStatusByUserId.delete(String(userId));
  rewardStatusPromisesByUserId.delete(String(userId));
}

export async function loadWelcomeRewardStatus(userOverride, { force = false } = {}) {
  if (!supabase) return { isEligible: false, isClaimed: true, setId: "", claimedAt: "" };

  const user = userOverride || (await getCurrentUser());

  if (!user) return { isEligible: false, isClaimed: true, setId: "", claimedAt: "" };

  const userId = String(user.id);
  if (!force && rewardStatusByUserId.has(userId)) return rewardStatusByUserId.get(userId);
  if (rewardStatusPromisesByUserId.has(userId)) return rewardStatusPromisesByUserId.get(userId);

  const promise = (async () => {
    const { data, error } = await supabase
      .from(WELCOME_REWARD_TABLE)
      .select("user_id,welcome_god_pack_claimed,welcome_god_pack_set,welcome_reward_claimed_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      logWelcomeRewardDebug("select", { error, user, rowMissing: undefined, isEligible: isEligibleUser(user) });
      throw error;
    }

    const status = normalizeRewardRow(data, user);

    if (status.rowMissing) {
      logWelcomeRewardDebug("missing-row", { user, rowMissing: true, isEligible: status.isEligible });
    }

    return cacheWelcomeRewardStatus(userId, status);
  })().finally(() => rewardStatusPromisesByUserId.delete(userId));

  rewardStatusPromisesByUserId.set(userId, promise);
  return promise;
}

export async function claimWelcomeReward(setId, userOverride) {
  throw new Error("Welcome rewards must be claimed through the secure backend function.");
}
