import { supabase } from "./supabaseClient.js";

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

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.warn("Unable to read PackDex achievement user", error);
    return null;
  }

  return data.user || null;
}

export function emptyUserAchievements() {
  return [];
}

export function normalizeUserAchievementRow(row = {}) {
  const awardedAt = row.awarded_at || null;
  const createdAt = row.created_at || null;
  const updatedAt = row.updated_at || null;

  return {
    id: String(row.id || ""),
    userId: String(row.user_id || ""),
    achievementId: String(row.achievement_id || ""),
    scopeType: String(row.scope_type || "global"),
    scopeKey: String(row.scope_key || "global"),
    awardKey: String(row.award_key || ""),
    metadata: isPlainObject(row.metadata) ? row.metadata : {},
    source: String(row.source || ""),
    awardedAt,
    awardedAtMs: parseTimestamp(awardedAt),
    createdAt,
    createdAtMs: parseTimestamp(createdAt),
    updatedAt,
    updatedAtMs: parseTimestamp(updatedAt),
  };
}

export async function loadCurrentUserAchievements(expectedUserId = "") {
  if (!supabase) return emptyUserAchievements();

  const user = await getCurrentAchievementUser();

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

function normalizeAchievementList(rows = []) {
  return Array.isArray(rows) ? rows.map(normalizeUserAchievementRow).filter((achievement) => achievement.achievementId) : [];
}

export async function checkServerAchievements(expectedUserId = "") {
  if (!supabase) {
    return {
      awarded: [],
      alreadyEarned: [],
      skipped: [{ reason: "missing_supabase_client" }],
    };
  }

  const user = await getCurrentAchievementUser();

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

  const { data, error } = await supabase.functions.invoke("check-achievements", {
    body: {},
  });

  if (error) {
    console.warn("Unable to check PackDex achievements", {
      userId: user.id,
      error,
    });

    return {
      awarded: [],
      alreadyEarned: [],
      skipped: [{ reason: "edge_function_error" }],
      error,
    };
  }

  return {
    awarded: normalizeAchievementList(data?.awarded),
    alreadyEarned: normalizeAchievementList(data?.alreadyEarned),
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
  };
}

export async function requestServerAchievementAward(expectedUserId = "") {
  // This intentionally does not accept achievement ids, award keys, card data, or
  // metadata from the browser. The Edge Function decides what can be awarded from
  // trusted persisted account data and writes with the service role server-side.
  return checkServerAchievements(expectedUserId);
}
