import {
  corsHeaders,
  formatErrorForResponse,
  jsonResponse,
} from "../_shared/http.ts";
import {
  getAuthenticatedUser,
} from "../_shared/auth.ts";

// Keep this function deploy-light: only use tiny Edge Function helpers and
// local milestone metadata. Supabase bundles every reachable import.

type AchievementCandidate = {
  achievement_id: string;
  scope_type: string;
  scope_key: string;
  award_key: string;
  metadata: Record<string, unknown>;
  source: string;
};

const PACK_OPEN_COUNT_ACHIEVEMENTS = [
  { achievementId: "packs_opened_10", threshold: 10, iconKey: "pack" },
  { achievementId: "packs_opened_25", threshold: 25, iconKey: "pack" },
  { achievementId: "packs_opened_50", threshold: 50, iconKey: "pack" },
  { achievementId: "packs_opened_100", threshold: 100, iconKey: "pack" },
  { achievementId: "packs_opened_250", threshold: 250, iconKey: "pack" },
  { achievementId: "packs_opened_500", threshold: 500, iconKey: "pack" },
  { achievementId: "packs_opened_1000", threshold: 1000, iconKey: "pack" },
];
const UNIQUE_COLLECTION_ACHIEVEMENTS = [
  { achievementId: "binder_page_9", threshold: 9 },
  { achievementId: "collector_100", threshold: 100 },
  { achievementId: "unique_cards_250", threshold: 250 },
  { achievementId: "collector_500", threshold: 500 },
];
const TOTAL_CARD_ACHIEVEMENTS = [
  { achievementId: "card_stack_100", threshold: 100 },
  { achievementId: "total_cards_250", threshold: 250 },
  { achievementId: "total_cards_500", threshold: 500 },
  { achievementId: "card_stack_1000", threshold: 1000 },
];
const VALUE_ACHIEVEMENTS = [
  { achievementId: "value_10", threshold: 10 },
  { achievementId: "value_100", threshold: 100 },
  { achievementId: "value_500", threshold: 500 },
];
const SET_MASTERY_ACHIEVEMENTS = [
  { achievementId: "first_set_complete", threshold: 1 },
  { achievementId: "sets_complete_5", threshold: 5 },
];
const PULL_HIT_ACHIEVEMENTS = [
  { achievementId: "first_big_hit", threshold: 1 },
  { achievementId: "big_hits_10", threshold: 10 },
  { achievementId: "rare_hits_25", threshold: 25 },
  { achievementId: "rare_hits_50", threshold: 50 },
];

function makeAwardKey(userId: string, achievementId: string, scopeKey = "global") {
  return ["account", userId, achievementId, scopeKey].join("::");
}

function getProgressPercent(current: number, target: number) {
  if (!Number.isFinite(target) || target <= 0) return null;

  return Math.min(100, Math.max(0, Math.floor((current / target) * 100)));
}

function makeProgressMetadata({
  category,
  iconKey,
  current,
  target,
}: {
  category: string;
  iconKey: string;
  current: number;
  target: number;
}) {
  return {
    category,
    icon_key: iconKey,
    progress_current: current,
    progress_target: target,
    progress_percent: getProgressPercent(current, target),
  };
}

function makeAchievement(userId: string, achievementId: string, metadata: Record<string, unknown> = {}): AchievementCandidate {
  return {
    achievement_id: achievementId,
    scope_type: "global",
    scope_key: "global",
    award_key: makeAwardKey(userId, achievementId),
    metadata,
    source: "edge:check-achievements",
  };
}

function normalizeText(value: unknown) {
  return String(value || "").toLowerCase().trim();
}

function isRarePlusRarity(value: unknown) {
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

function getValidMarketPriceUsd(value: unknown) {
  const price = Number(value);

  return Number.isFinite(price) && price > 0 ? price : null;
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function pushThresholdAchievements({
  candidates,
  skipped,
  userId,
  milestones,
  current,
  category,
  iconKey,
  metricKey,
  sourceTable,
}: {
  candidates: AchievementCandidate[];
  skipped: { achievementId: string; reason: string }[];
  userId: string;
  milestones: { achievementId: string; threshold: number; iconKey?: string }[];
  current: number;
  category: string;
  iconKey: string;
  metricKey: string;
  sourceTable: string;
}) {
  for (const milestone of milestones) {
    if (current >= milestone.threshold) {
      candidates.push(makeAchievement(userId, milestone.achievementId, {
        ...makeProgressMetadata({
          category,
          iconKey: milestone.iconKey || iconKey,
          current,
          target: milestone.threshold,
        }),
        [metricKey]: current,
        threshold: milestone.threshold,
        sourceTable,
      }));
    } else {
      skipped.push({
        achievementId: milestone.achievementId,
        reason: "insufficient_trusted_progress",
      });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let debugStep = "start";

  try {
    debugStep = "authenticate";
    const { admin, user } = await getAuthenticatedUser(req);
    const userId = user.id;
    const candidates: AchievementCandidate[] = [];
    const skipped: { achievementId: string; reason: string }[] = [];

    candidates.push(makeAchievement(userId, "account_created", {
      ...makeProgressMetadata({ category: "special", iconKey: "chase", current: 1, target: 1 }),
      userCreatedAt: user.created_at || null,
    }));

    debugStep = "load_first_pack_open_event";
    const { data: firstPackOpenEvent, error: firstPackOpenError } = await admin
      .from("user_pack_open_events")
      .select("id,set_id,opened_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstPackOpenError) {
      if (firstPackOpenError.code === "42P01") {
        skipped.push({
          achievementId: "first_pack_opened",
          reason: "pack_open_events_not_deployed",
        });
      } else {
        throw firstPackOpenError;
      }
    } else if (firstPackOpenEvent) {
      candidates.push(makeAchievement(userId, "first_pack_opened", {
        ...makeProgressMetadata({ category: "packs", iconKey: "pack", current: 1, target: 1 }),
        packOpenEventId: firstPackOpenEvent.id || null,
        setId: firstPackOpenEvent.set_id || null,
        openedAt: firstPackOpenEvent.opened_at || firstPackOpenEvent.created_at || null,
      }));
    } else {
      skipped.push({
        achievementId: "first_pack_opened",
        reason: "missing_trusted_pack_open_event",
      });
    }

    debugStep = "count_pack_open_events";
    const { count: packOpenCount, error: packOpenCountError } = await admin
      .from("user_pack_open_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (packOpenCountError) {
      if (packOpenCountError.code === "42P01") {
        for (const milestone of PACK_OPEN_COUNT_ACHIEVEMENTS) {
          skipped.push({
            achievementId: milestone.achievementId,
            reason: "pack_open_events_not_deployed",
          });
        }
      } else {
        throw packOpenCountError;
      }
    } else {
      const safePackOpenCount = Number(packOpenCount || 0);

      pushThresholdAchievements({
        candidates,
        skipped,
        userId,
        milestones: PACK_OPEN_COUNT_ACHIEVEMENTS,
        current: safePackOpenCount,
        category: "packs",
        iconKey: "pack",
        metricKey: "packsOpened",
        sourceTable: "user_pack_open_events",
      });
    }

    debugStep = "load_collection_progress";
    const { data: collectionRows, error: collectionError } = await admin
      .from("user_collection")
      .select("set_id,card_id,quantity,rarity")
      .eq("user_id", userId)
      .gt("quantity", 0);

    if (collectionError) {
      if (collectionError.code === "42P01") {
        [
          ...UNIQUE_COLLECTION_ACHIEVEMENTS,
          ...TOTAL_CARD_ACHIEVEMENTS,
          ...VALUE_ACHIEVEMENTS,
          ...SET_MASTERY_ACHIEVEMENTS,
          ...PULL_HIT_ACHIEVEMENTS,
        ].forEach((milestone) => skipped.push({
          achievementId: milestone.achievementId,
          reason: "user_collection_not_deployed",
        }));
      } else {
        throw collectionError;
      }
    } else {
      const safeCollectionRows = collectionRows || [];
      const uniqueOwnedCount = new Set(safeCollectionRows.map((row) => `${row.set_id}:${row.card_id}`)).size;
      const totalOwnedCount = safeCollectionRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0);
      const rarePlusPullCount = safeCollectionRows.reduce((sum, row) => {
        if (!isRarePlusRarity(row.rarity)) return sum;

        return sum + Math.max(0, Number(row.quantity || 0));
      }, 0);

      pushThresholdAchievements({
        candidates,
        skipped,
        userId,
        milestones: UNIQUE_COLLECTION_ACHIEVEMENTS,
        current: uniqueOwnedCount,
        category: "collection",
        iconKey: "binder",
        metricKey: "uniqueCardsOwned",
        sourceTable: "user_collection",
      });
      pushThresholdAchievements({
        candidates,
        skipped,
        userId,
        milestones: TOTAL_CARD_ACHIEVEMENTS,
        current: totalOwnedCount,
        category: "collection",
        iconKey: "binder",
        metricKey: "totalCardsOwned",
        sourceTable: "user_collection",
      });
      pushThresholdAchievements({
        candidates,
        skipped,
        userId,
        milestones: PULL_HIT_ACHIEVEMENTS,
        current: rarePlusPullCount,
        category: "pulls",
        iconKey: "sparkle",
        metricKey: "rarePlusPulls",
        sourceTable: "user_collection",
      });

      SET_MASTERY_ACHIEVEMENTS.forEach((milestone) => skipped.push({
        achievementId: milestone.achievementId,
        reason: "set_mastery_requires_lightweight_server_totals",
      }));

      debugStep = "load_collection_price_progress";
      const ownedCardIds = [...new Set(safeCollectionRows.map((row) => String(row.card_id || "")).filter(Boolean))];
      const priceRows: Record<string, unknown>[] = [];
      let canCalculateValue = true;

      for (const cardIdChunk of chunkValues(ownedCardIds, 100)) {
        const { data: chunkRows, error: priceError } = await admin
          .from("card_prices")
          .select("set_id,card_id,market_price_usd")
          .in("card_id", cardIdChunk);

        if (priceError) {
          if (priceError.code === "42P01") {
            VALUE_ACHIEVEMENTS.forEach((milestone) => skipped.push({
              achievementId: milestone.achievementId,
              reason: "card_prices_not_deployed",
            }));
            canCalculateValue = false;
            break;
          }

          throw priceError;
        }

        priceRows.push(...(chunkRows || []));
      }

      if (canCalculateValue) {
        const priceBySetAndCard = new Map(
          priceRows.map((row) => [`${row.set_id}:${row.card_id}`, row]),
        );
        const estimatedCollectionValue = safeCollectionRows.reduce((sum, row) => {
          const priceRow = priceBySetAndCard.get(`${row.set_id}:${row.card_id}`);
          const marketPrice = getValidMarketPriceUsd(priceRow?.market_price_usd);

          if (marketPrice == null) return sum;

          return sum + marketPrice * Math.max(0, Number(row.quantity || 0));
        }, 0);

        pushThresholdAchievements({
          candidates,
          skipped,
          userId,
          milestones: VALUE_ACHIEVEMENTS,
          current: estimatedCollectionValue,
          category: "value",
          iconKey: "dollar",
          metricKey: "estimatedCollectionValueUsd",
          sourceTable: "user_collection,card_prices",
        });
      }
    }

    debugStep = "load_existing_achievements";
    const awardKeys = candidates.map((candidate) => candidate.award_key);
    const { data: existingRows, error: existingError } = await admin
      .from("user_achievements")
      .select("id,user_id,achievement_id,scope_type,scope_key,award_key,metadata,source,awarded_at,created_at,updated_at")
      .eq("user_id", userId)
      .in("award_key", awardKeys);

    if (existingError) throw existingError;

    const existingAwardKeys = new Set((existingRows || []).map((row) => String(row.award_key || "")));
    const alreadyEarned = existingRows || [];
    const rowsToInsert = candidates
      .filter((candidate) => !existingAwardKeys.has(candidate.award_key))
      .map((candidate) => ({
        user_id: userId,
        ...candidate,
      }));
    const awarded: Record<string, unknown>[] = [];

    debugStep = "insert_achievements";
    for (const row of rowsToInsert) {
      const { data, error } = await admin
        .from("user_achievements")
        .upsert(row, { onConflict: "user_id,award_key", ignoreDuplicates: true })
        .select("id,user_id,achievement_id,scope_type,scope_key,award_key,metadata,source,awarded_at,created_at,updated_at")
        .maybeSingle();

      if (error) {
        if (error.code === "23505") {
          skipped.push({
            achievementId: row.achievement_id,
            reason: "already_awarded_by_unique_constraint",
          });
          continue;
        }

        throw error;
      }

      if (data) awarded.push(data);
    }

    return jsonResponse({
      awarded,
      alreadyEarned,
      skipped,
    });
  } catch (error) {
    const formattedError = formatErrorForResponse(error);

    console.error("check-achievements failed", {
      step: debugStep,
      error: formattedError,
    });

    return jsonResponse(
      {
        error: "Unable to check achievements securely.",
        step: debugStep,
        ...formattedError,
      },
      500,
    );
  }
});
