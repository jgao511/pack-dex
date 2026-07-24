import { getAuthenticatedUser } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";

type Candidate = {
  achievement_id: string;
  scope_type: string;
  scope_key: string;
  award_key: string;
  metadata: Record<string, unknown>;
  source: string;
};

const PACK_MILESTONES = [
  ["first_pack_opened", 1], ["packs_opened_10", 10], ["packs_opened_25", 25],
  ["packs_opened_50", 50], ["packs_opened_100", 100], ["packs_opened_250", 250],
  ["packs_opened_500", 500], ["packs_opened_1000", 1000],
] as const;
const UNIQUE_MILESTONES = [
  ["binder_page_9", 9], ["collector_100", 100], ["unique_cards_250", 250], ["collector_500", 500],
] as const;
const TOTAL_MILESTONES = [
  ["card_stack_100", 100], ["total_cards_250", 250], ["total_cards_500", 500], ["card_stack_1000", 1000],
] as const;

function candidate(userId: string, achievementId: string, category: string, current: number, target: number): Candidate {
  return {
    achievement_id: achievementId,
    scope_type: "global",
    scope_key: "global",
    award_key: ["account", userId, achievementId, "global"].join("::"),
    metadata: {
      category,
      icon_key: category === "packs" ? "pack" : "binder",
      progress_current: current,
      progress_target: target,
      progress_percent: Math.min(100, Math.floor((current / target) * 100)),
    },
    source: "edge:check-achievements-incremental",
  };
}

function addReached(
  candidates: Candidate[],
  userId: string,
  milestones: readonly (readonly [string, number])[],
  category: string,
  current: number,
) {
  milestones.forEach(([id, target]) => {
    if (current >= target) candidates.push(candidate(userId, id, category, current, target));
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let debugStep = "authenticate";
  try {
    const { admin, user } = await getAuthenticatedUser(req);
    const body = await req.json().catch(() => ({}));
    const scope = String(body?.scope || "pack_and_collection");

    debugStep = "load_compact_profile_stats";
    const { data: stats, error: statsError } = await admin
      .from("user_profile_stats")
      .select("packs_opened,total_cards_pulled,unique_cards,sets_completed")
      .eq("user_id", user.id)
      .maybeSingle();
    if (statsError) throw statsError;

    const candidates: Candidate[] = [candidate(user.id, "account_created", "special", 1, 1)];
    const packsOpened = Math.max(0, Number(stats?.packs_opened || 0));
    const totalCards = Math.max(0, Number(stats?.total_cards_pulled || 0));
    const uniqueCards = Math.max(0, Number(stats?.unique_cards || 0));

    if (scope === "pack" || scope === "pack_and_collection") {
      addReached(candidates, user.id, PACK_MILESTONES, "packs", packsOpened);
    }
    if (scope === "collection" || scope === "pack_and_collection") {
      addReached(candidates, user.id, UNIQUE_MILESTONES, "collection", uniqueCards);
      addReached(candidates, user.id, TOTAL_MILESTONES, "collection", totalCards);
    }

    debugStep = "load_existing_affected_achievements";
    const awardKeys = candidates.map((item) => item.award_key);
    const { data: existingRows, error: existingError } = await admin
      .from("user_achievements")
      .select("award_key")
      .eq("user_id", user.id)
      .in("award_key", awardKeys);
    if (existingError) throw existingError;

    const existingKeys = new Set((existingRows || []).map((row) => row.award_key));
    const rowsToInsert = candidates
      .filter((item) => !existingKeys.has(item.award_key))
      .map((item) => ({ user_id: user.id, ...item }));

    let awarded: Record<string, unknown>[] = [];
    if (rowsToInsert.length > 0) {
      debugStep = "batch_insert_achievements";
      const { data, error } = await admin
        .from("user_achievements")
        .upsert(rowsToInsert, { onConflict: "user_id,award_key", ignoreDuplicates: true })
        .select("id,user_id,achievement_id,scope_type,scope_key,award_key,metadata,source,awarded_at,created_at,updated_at");
      if (error) throw error;
      awarded = data || [];
    }

    return jsonResponse({ awarded });
  } catch (error) {
    const formattedError = formatErrorForResponse(error);
    console.error("check-achievements failed", { step: debugStep, error: formattedError });
    return jsonResponse({ error: "Unable to check achievements securely.", step: debugStep, ...formattedError }, 500);
  }
});
