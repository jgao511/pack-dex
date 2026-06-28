import {
  corsHeaders,
  formatErrorForResponse,
  jsonResponse,
} from "../_shared/http.ts";
import {
  getAuthenticatedUser,
} from "../_shared/auth.ts";

type AchievementCandidate = {
  achievement_id: string;
  scope_type: string;
  scope_key: string;
  award_key: string;
  metadata: Record<string, unknown>;
  source: string;
};

const PACK_OPEN_COUNT_ACHIEVEMENTS = [
  { achievementId: "packs_opened_10", threshold: 10 },
  { achievementId: "packs_opened_50", threshold: 50 },
  { achievementId: "packs_opened_100", threshold: 100 },
];

function makeAwardKey(userId: string, achievementId: string, scopeKey = "global") {
  return ["account", userId, achievementId, scopeKey].join("::");
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

      for (const milestone of PACK_OPEN_COUNT_ACHIEVEMENTS) {
        if (safePackOpenCount >= milestone.threshold) {
          candidates.push(makeAchievement(userId, milestone.achievementId, {
            packsOpened: safePackOpenCount,
            threshold: milestone.threshold,
            sourceTable: "user_pack_open_events",
          }));
        } else {
          skipped.push({
            achievementId: milestone.achievementId,
            reason: "insufficient_trusted_pack_open_events",
          });
        }
      }
    }

    // TODO: Pull hit, chase-card, binder/page, and price/value achievements need a
    // trusted server-side event model before they can be awarded here. Do not trust
    // raw card lists, arbitrary achievement ids, award keys, or metadata from the browser.

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
        .insert(row)
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
