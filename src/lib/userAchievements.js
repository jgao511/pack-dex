import { supabase } from "./supabaseClient.js";
import { countDevRequest } from "../../mobile-app/src/utils/requestDiagnostics.js";
import { getCachedSupabaseUser } from "./sessionUserCache.js";
import {
  clearAchievementCheckScheduler,
  scheduleAchievementCheck,
  subscribeAchievementCheckResults,
} from "./achievementCheckScheduler.js";

export {
  clearAchievementCheckScheduler,
  subscribeAchievementCheckResults,
} from "./achievementCheckScheduler.js";

const USER_ACHIEVEMENTS_TABLE = "user_achievements";
const ACHIEVEMENT_SELECT_COLUMNS =
  "id,user_id,achievement_id,scope_type,scope_key,award_key,metadata,source,awarded_at,created_at,updated_at";
export const SERVER_ACHIEVEMENT_AWARDING_REQUIRED =
  "Achievement awards must be created by a secure Supabase Edge Function or trusted service-role server path.";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseTimestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

async function getCurrentAchievementUser() {
  if (!supabase) return null;
  try {
    return await getCachedSupabaseUser(supabase);
  } catch (error) {
    console.warn("Unable to read PackDex achievement user", error);
    return null;
  }
}

export function emptyUserAchievements() {
  return [];
}

export function normalizeUserAchievementRow(row = {}) {
  const awardedAt = row.awardedAt || row.awarded_at || null;
  const createdAt = row.createdAt || row.created_at || null;
  const updatedAt = row.updatedAt || row.updated_at || null;

  return {
    id: String(row.id || ""),
    userId: String(row.userId || row.user_id || ""),
    achievementId: String(row.achievementId || row.achievement_id || ""),
    scopeType: String(row.scopeType || row.scope_type || "global"),
    scopeKey: String(row.scopeKey || row.scope_key || "global"),
    awardKey: String(row.awardKey || row.award_key || ""),
    metadata: isPlainObject(row.metadata) ? row.metadata : {},
    source: String(row.source || ""),
    awardedAt,
    awardedAtMs: row.awardedAtMs ?? parseTimestamp(awardedAt),
    createdAt,
    createdAtMs: row.createdAtMs ?? parseTimestamp(createdAt),
    updatedAt,
    updatedAtMs: row.updatedAtMs ?? parseTimestamp(updatedAt),
  };
}

export async function loadCurrentUserAchievements(expectedUserId = "") {
  countDevRequest("loadCurrentUserAchievements");
  if (!supabase) return emptyUserAchievements();

  const user = expectedUserId ? { id: String(expectedUserId) } : await getCurrentAchievementUser();

  if (!user?.id) return emptyUserAchievements();
  if (expectedUserId && String(expectedUserId) !== String(user.id)) return emptyUserAchievements();

  const { data, error } = await supabase
    .from(USER_ACHIEVEMENTS_TABLE)
    .select(ACHIEVEMENT_SELECT_COLUMNS)
    .eq("user_id", user.id)
    .order("awarded_at", { ascending: false });

  if (error) {
    console.warn("Unable to load PackDex achievements", {
      userId: user.id,
      error,
    });
    return emptyUserAchievements();
  }

  return (data || [])
    .map(normalizeUserAchievementRow)
    .filter((achievement) => achievement.userId === user.id && achievement.achievementId);
}

export async function loadCurrentUserAchievementProgress(expectedUserId = "") {
  const result = await reconcileCurrentUserAchievements(expectedUserId);
  return result.progress;
}

function normalizeAchievementProgressRow(row = {}) {
  return {
    achievementId: String(row.achievementId || row.achievement_id || ""),
    category: String(row.category || ""),
    progressCurrent: Math.max(0, Number(row.progressCurrent ?? row.progress_current ?? 0)),
    progressTarget: Math.max(0, Number(row.progressTarget ?? row.progress_target ?? 0)),
    progressPercent: Math.max(0, Math.min(100, Number(row.progressPercent ?? row.progress_percent ?? 0))),
    sourceTable: String(row.sourceTable || row.source_table || ""),
  };
}

export async function reconcileCurrentUserAchievements(expectedUserId = "", options = {}) {
  const result = await scheduleServerAchievementCheck(expectedUserId, {
    ...options,
    scope: "profile_reconcile",
    reason: options.reason || "explicit_achievement_progress_open",
  });
  return {
    ...result,
    progress: Array.isArray(result?.progress)
      ? result.progress.map(normalizeAchievementProgressRow).filter((row) => row.achievementId)
      : [],
  };
}

function normalizeAchievementList(rows = []) {
  return Array.isArray(rows) ? rows.map(normalizeUserAchievementRow).filter((achievement) => achievement.achievementId) : [];
}

export function mergeUserAchievementRows(existingRows = [], awardedRows = []) {
  const mergedByKey = new Map();

  [...normalizeAchievementList(existingRows), ...normalizeAchievementList(awardedRows)].forEach((achievement) => {
    const key = achievement.awardKey || achievement.id || achievement.achievementId;
    if (key) mergedByKey.set(key, achievement);
  });

  return [...mergedByKey.values()].sort((left, right) =>
    Number(right.awardedAtMs || right.createdAtMs || 0) - Number(left.awardedAtMs || left.createdAtMs || 0)
  );
}

export async function scheduleServerAchievementCheck(expectedUserId = "", {
  progression = {},
  scope = "pack_and_collection",
  reason = "durable_progression_mutation",
  client = supabase,
  ...schedulerOptions
} = {}) {
  // This intentionally does not accept achievement ids, award keys, card data, or
  // metadata from the browser. The Edge Function decides what can be awarded from
  // trusted persisted account data and writes with the service role server-side.
  if (!client) {
    return {
      awarded: [],
      alreadyEarned: [],
      skipped: [{ reason: "missing_supabase_client" }],
    };
  }

  const user = expectedUserId ? { id: String(expectedUserId) } : await getCurrentAchievementUser();

  if (!user?.id) {
    return {
      awarded: [],
      alreadyEarned: [],
      skipped: [{ reason: "missing_authenticated_user" }],
    };
  }

  if (expectedUserId && String(expectedUserId) !== String(user.id)) {
    return {
      awarded: [],
      alreadyEarned: [],
      skipped: [{ reason: "stale_authenticated_user" }],
    };
  }

  const data = await scheduleAchievementCheck({
    userId: user.id,
    progression,
    scope,
    reason,
    client,
    ...schedulerOptions,
  });

  return {
    ...data,
    awarded: normalizeAchievementList(data?.awarded),
    progress: Array.isArray(data?.progress)
      ? data.progress.map(normalizeAchievementProgressRow).filter((row) => row.achievementId)
      : [],
    alreadyEarned: [],
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
  };
}

export function requestServerAchievementAward(expectedUserId = "", options = {}) {
  return scheduleServerAchievementCheck(expectedUserId, options);
}
