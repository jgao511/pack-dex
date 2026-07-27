import { getAuthenticatedUser } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";
import oneFiftyOneCards from "../../../src/data/151.json" with { type: "json" };
import pitchBlackCards from "../../../src/data/pitch-black.json" with { type: "json" };
import prismaticEvolutionsCards from "../../../src/data/prismatic-evolutions.json" with { type: "json" };

type TutorialCard = { id?: unknown; rarity?: unknown };
const TUTORIAL_CARD_CATALOGS: Record<string, TutorialCard[]> = {
  "pitch-black": pitchBlackCards,
  "151": oneFiftyOneCards,
  "prismatic-evolutions": prismaticEvolutionsCards,
};
const ONBOARDING_VERSION = 1;
const ONBOARDING_COMPLETION_ID = "mobile-onboarding:v1";
const TUTORIAL_PACK_EVENT_ID = "mobile-onboarding:v1";

function errorResponse(
  status: number,
  code: string,
  message: string,
  step: string,
  retryable = false,
) {
  return jsonResponse({ ok: false, code, message, step, retryable }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Use POST for mobile onboarding completion.", "request");
  }

  let step = "authenticate";
  try {
    const { admin, user } = await getAuthenticatedUser(req);
    step = "parse";
    const body = await req.json().catch(() => ({}));
    const version = Number(body?.version || 0);
    const completionId = String(body?.completion_id || "").trim();
    const tutorialPackEventId = String(body?.tutorial_pack_event_id || "").trim();
    const skipped = body?.skipped === true;
    const setId = String(body?.set_id || "").trim();
    const cardIds = Array.isArray(body?.card_ids) ? body.card_ids.map((value: unknown) => String(value || "").trim()) : [];
    if (
      version !== ONBOARDING_VERSION ||
      completionId !== ONBOARDING_COMPLETION_ID ||
      tutorialPackEventId !== TUTORIAL_PACK_EVENT_ID
    ) {
      return errorResponse(400, "invalid_onboarding_payload", "Unsupported or unstable onboarding payload.", step);
    }

    if (!skipped) {
      step = "validate_tutorial";
      const cards = TUTORIAL_CARD_CATALOGS[setId];
      if (!cards || cardIds.length !== 10) {
        return errorResponse(400, "invalid_tutorial_pack", "Invalid tutorial pack.", step);
      }
      const catalogIds = new Set(cards.map((card) => String(card.id || "")));
      if (cardIds.some((id: string) => !catalogIds.has(id))) {
        return errorResponse(400, "unknown_tutorial_card", "Tutorial pack contains an unknown card.", step);
      }
      const hasShowcaseHit = cardIds.some((id: string) => {
        const card = cards.find((candidate) => String(candidate.id || "") === id);
        return /special illustration rare|illustration rare/i.test(String(card?.rarity || ""));
      });
      if (!hasShowcaseHit) {
        return errorResponse(400, "missing_showcase_hit", "Tutorial pack is missing its showcase hit.", step);
      }
    }

    step = "complete";
    const { data, error } = await admin.rpc("complete_mobile_onboarding_v1", {
      p_user_id: user.id,
      p_version: version,
      p_set_id: skipped ? "" : setId,
      p_card_ids: skipped ? [] : cardIds,
      p_skipped: skipped,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Onboarding completion returned no result.");
    const alreadyCompleted = Boolean(row?.already_completed);
    return jsonResponse({
      ok: true,
      status: alreadyCompleted ? "already_completed" : "completed",
      tutorialPackSaved: Boolean(row?.tutorial_pack_saved),
      rewardProgress: Number(row?.reward_progress || 0),
      stats: {
        packsOpened: Number(row?.packs_opened || 0),
        totalCardsPulled: Number(row?.total_cards_pulled || 0),
      },
    });
  } catch (error) {
    console.error("complete-mobile-onboarding failed", { step, error: formatErrorForResponse(error) });
    if (step === "authenticate") {
      const message = String((error as Error)?.message || "");
      const code = /missing auth token/i.test(message) ? "unauthorized" : "session_expired";
      return errorResponse(401, code, "A valid authenticated session is required.", step);
    }
    return errorResponse(
      500,
      "server_migration_failure",
      "Unable to save the tutorial pack right now.",
      step,
      true,
    );
  }
});
