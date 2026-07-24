import { supabase } from "./supabaseClient.js";
import { countDevRequest } from "../../mobile-app/src/utils/requestDiagnostics.js";
import { getCachedSupabaseUser } from "./sessionUserCache.js";

const USER_ACHIEVEMENTS_TABLE = "user_achievements";
const ACHIEVEMENT_SELECT_COLUMNS =
  "id,user_id,achievement_id,scope_type,scope_key,award_key,metadata,source,awarded_at,created_at,updated_at";
const PACK_OPEN_PROGRESS_TARGETS = [
  { achievementId: "first_pack_opened", progressTarget: 1 },
  { achievementId: "packs_opened_10", progressTarget: 10 },
  { achievementId: "packs_opened_25", progressTarget: 25 },
  { achievementId: "packs_opened_50", progressTarget: 50 },
  { achievementId: "packs_opened_100", progressTarget: 100 },
  { achievementId: "packs_opened_250", progressTarget: 250 },
  { achievementId: "packs_opened_500", progressTarget: 500 },
  { achievementId: "packs_opened_1000", progressTarget: 1000 },
];
const UNIQUE_COLLECTION_PROGRESS_TARGETS = [
  { achievementId: "binder_page_9", progressTarget: 9 },
  { achievementId: "collector_100", progressTarget: 100 },
  { achievementId: "unique_cards_250", progressTarget: 250 },
  { achievementId: "collector_500", progressTarget: 500 },
];
const TOTAL_CARD_PROGRESS_TARGETS = [
  { achievementId: "card_stack_100", progressTarget: 100 },
  { achievementId: "total_cards_250", progressTarget: 250 },
  { achievementId: "total_cards_500", progressTarget: 500 },
  { achievementId: "card_stack_1000", progressTarget: 1000 },
];
const SET_MASTERY_PROGRESS_TARGETS = [
  { achievementId: "first_set_complete", progressTarget: 1 },
  { achievementId: "sets_complete_5", progressTarget: 5 },
];

export const SERVER_ACHIEVEMENT_AWARDING_REQUIRED =
  "Achievement awards must be created by a secure Supabase Edge Function or trusted service-role server path.";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseTimestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function makeProgressRows(targets, progressCurrent, category, sourceTable) {
  const safeCurrent = Math.max(0, Number(progressCurrent || 0));

  return targets.map(({ achievementId, progressTarget }) => ({
    achievementId,
    category,
    progressCurrent: safeCurrent,
    progressTarget,
    progressPercent: progressTarget > 0
      ? Math.min(100, Math.max(0, Math.floor((safeCurrent / progressTarget) * 100)))
      : 0,
    sourceTable,
  }));
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
  if (!supabase) return [];

  const user = expectedUserId ? { id: String(expectedUserId) } : await getCurrentAchievementUser();

  if (!user?.id) return [];
  if (expectedUserId && String(expectedUserId) !== String(user.id)) return [];

  const { data: stats, error } = await supabase
    .from("user_profile_stats")
    .select("packs_opened,total_cards_pulled,unique_cards,sets_completed")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;

  return [
    ...makeProgressRows(PACK_OPEN_PROGRESS_TARGETS, stats?.packs_opened, "packs", "user_profile_stats"),
    ...makeProgressRows(UNIQUE_COLLECTION_PROGRESS_TARGETS, stats?.unique_cards, "collection", "user_profile_stats"),
    ...makeProgressRows(TOTAL_CARD_PROGRESS_TARGETS, stats?.total_cards_pulled, "collection", "user_profile_stats"),
    ...makeProgressRows(SET_MASTERY_PROGRESS_TARGETS, stats?.sets_completed, "set_mastery", "user_profile_stats"),
  ];
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

export async function requestServerAchievementAward(expectedUserId = "") {
  // This intentionally does not accept achievement ids, award keys, card data, or
  // metadata from the browser. The Edge Function decides what can be awarded from
  // trusted persisted account data and writes with the service role server-side.
  if (!supabase) {
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

  const { data, error } = await supabase.functions.invoke("check-achievements", {
    body: { scope: "pack_and_collection" },
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
    alreadyEarned: [],
    skipped: [],
  };
}
