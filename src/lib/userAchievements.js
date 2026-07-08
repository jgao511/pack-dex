import { sets } from "../data/sets.js";
import { loadCardPricesForCollection } from "./cardPrices.js";
import { supabase } from "./supabaseClient.js";

const USER_ACHIEVEMENTS_TABLE = "user_achievements";
const PACK_OPEN_EVENTS_TABLE = "user_pack_open_events";
const USER_COLLECTION_TABLE = "user_collection";
const CARD_PRICES_TABLE = "card_prices";
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
const VALUE_PROGRESS_TARGETS = [
  { achievementId: "value_10", progressTarget: 10 },
  { achievementId: "value_100", progressTarget: 100 },
  { achievementId: "value_500", progressTarget: 500 },
];
const SET_MASTERY_PROGRESS_TARGETS = [
  { achievementId: "first_set_complete", progressTarget: 1 },
  { achievementId: "sets_complete_5", progressTarget: 5 },
];
const PULL_HIT_PROGRESS_TARGETS = [
  { achievementId: "first_big_hit", progressTarget: 1 },
  { achievementId: "big_hits_10", progressTarget: 10 },
  { achievementId: "rare_hits_25", progressTarget: 25 },
  { achievementId: "rare_hits_50", progressTarget: 50 },
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

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function getCardCollectionKey(card, setId) {
  if (card?.id) return String(card.id);

  return `${setId}-${card?.number || "unknown"}-${card?.name || "card"}`;
}

function isCollectionCard(card = {}) {
  const name = normalizeText(card.name);
  const supertype = normalizeText(card.supertype);
  const types = Array.isArray(card.types) ? card.types.map(normalizeText) : [];

  return !name.includes("code card") && supertype !== "energy" && !types.includes("energy");
}

function isRarePlusRarity(value) {
  const rarity = normalizeText(value);

  if (!rarity || rarity === "rare" || rarity === "rare holo" || rarity === "rare holofoil" || rarity === "rare reverse holo") {
    return false;
  }

  return /\b(ex|gx|v|vmax|vstar)\b/.test(rarity)
    || rarity.includes("ace spec")
    || rarity.includes("amazing rare")
    || rarity.includes("illustration rare")
    || rarity.includes("special illustration")
    || rarity.includes("ultra rare")
    || rarity.includes("secret rare")
    || rarity.includes("hyper rare")
    || rarity.includes("rainbow rare")
    || rarity.includes("shiny rare")
    || rarity.includes("rare rainbow")
    || rarity.includes("rare secret")
    || rarity.includes("rare ultra");
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

function getCompletedSetCount(collectionRows = []) {
  const collectionBySet = new Map();

  collectionRows.forEach((row) => {
    const setId = String(row.set_id || "");
    const cardId = String(row.card_id || "");

    if (!setId || !cardId) return;
    if (!collectionBySet.has(setId)) collectionBySet.set(setId, new Set());
    collectionBySet.get(setId).add(cardId);
  });

  return sets.reduce((count, set) => {
    const setId = String(set.id || "");
    const ownedCardIds = collectionBySet.get(setId);
    const collectionCards = (set.cards || []).filter(isCollectionCard);

    if (!ownedCardIds || collectionCards.length === 0) return count;

    return collectionCards.every((card) => ownedCardIds.has(getCardCollectionKey(card, setId))) ? count + 1 : count;
  }, 0);
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

export async function loadCurrentUserAchievementProgress(expectedUserId = "") {
  if (!supabase) return [];

  const user = await getCurrentAchievementUser();

  if (!user?.id) return [];
  if (expectedUserId && String(expectedUserId) !== String(user.id)) return [];

  const progressRows = [];
  const { count, error: packOpenError } = await supabase
    .from(PACK_OPEN_EVENTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (packOpenError) {
    console.warn("Unable to load PackDex achievement progress", {
      userId: user.id,
      error: packOpenError,
    });
  } else {
    progressRows.push(...makeProgressRows(PACK_OPEN_PROGRESS_TARGETS, Number(count || 0), "packs", PACK_OPEN_EVENTS_TABLE));
  }

  const { data: collectionRows, error: collectionError } = await supabase
    .from(USER_COLLECTION_TABLE)
    .select("set_id,card_id,quantity,rarity")
    .eq("user_id", user.id)
    .gt("quantity", 0);

  if (collectionError) {
    console.warn("Unable to load PackDex collection achievement progress", {
      userId: user.id,
      error: collectionError,
    });
    return progressRows;
  }

  const safeCollectionRows = collectionRows || [];
  const uniqueOwnedCount = new Set(safeCollectionRows.map((row) => `${row.set_id}:${row.card_id}`)).size;
  const totalOwnedCount = safeCollectionRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0);
  const rarePlusPullCount = safeCollectionRows.reduce((sum, row) => {
    if (!isRarePlusRarity(row.rarity)) return sum;

    return sum + Math.max(0, Number(row.quantity || 0));
  }, 0);

  progressRows.push(
    ...makeProgressRows(UNIQUE_COLLECTION_PROGRESS_TARGETS, uniqueOwnedCount, "collection", USER_COLLECTION_TABLE),
    ...makeProgressRows(TOTAL_CARD_PROGRESS_TARGETS, totalOwnedCount, "collection", USER_COLLECTION_TABLE),
    ...makeProgressRows(SET_MASTERY_PROGRESS_TARGETS, getCompletedSetCount(safeCollectionRows), "set_mastery", USER_COLLECTION_TABLE),
    ...makeProgressRows(PULL_HIT_PROGRESS_TARGETS, rarePlusPullCount, "pulls", USER_COLLECTION_TABLE),
  );

  if (safeCollectionRows.length === 0) {
    progressRows.push(...makeProgressRows(VALUE_PROGRESS_TARGETS, 0, "value", `${USER_COLLECTION_TABLE},${CARD_PRICES_TABLE}`));
    return progressRows;
  }

  try {
    const pricedCollection = safeCollectionRows.map((row) => ({
      setId: row.set_id,
      card: {
        id: row.card_id,
        card_id: row.card_id,
      },
      count: Math.max(0, Number(row.quantity || 0)),
    }));
    const { totalValue } = await loadCardPricesForCollection(supabase, pricedCollection);

    progressRows.push(...makeProgressRows(
      VALUE_PROGRESS_TARGETS,
      totalValue,
      "value",
      `${USER_COLLECTION_TABLE},${CARD_PRICES_TABLE}`,
    ));
  } catch (priceError) {
    console.warn("Unable to load PackDex value achievement progress", {
      userId: user.id,
      error: priceError,
    });
    progressRows.push(...makeProgressRows(VALUE_PROGRESS_TARGETS, 0, "value", `${USER_COLLECTION_TABLE},${CARD_PRICES_TABLE}`));
  }

  return progressRows;
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
