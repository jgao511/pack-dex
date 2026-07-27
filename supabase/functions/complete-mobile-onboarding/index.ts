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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let step = "authenticate";
  try {
    const { admin, user } = await getAuthenticatedUser(req);
    step = "parse";
    const body = await req.json().catch(() => ({}));
    const version = Number(body?.version || 0);
    const skipped = body?.skipped === true;
    const setId = String(body?.set_id || "").trim();
    const cardIds = Array.isArray(body?.card_ids) ? body.card_ids.map((value: unknown) => String(value || "").trim()) : [];
    if (version !== 1) return jsonResponse({ error: "Unsupported onboarding version." }, 400);

    if (!skipped) {
      step = "validate_tutorial";
      const cards = TUTORIAL_CARD_CATALOGS[setId];
      if (!cards || cardIds.length !== 10) {
        return jsonResponse({ error: "Invalid tutorial pack." }, 400);
      }
      const catalogIds = new Set(cards.map((card) => String(card.id || "")));
      if (cardIds.some((id: string) => !catalogIds.has(id))) {
        return jsonResponse({ error: "Tutorial pack contains an unknown card." }, 400);
      }
      const hasShowcaseHit = cardIds.some((id: string) => {
        const card = cards.find((candidate) => String(candidate.id || "") === id);
        return /special illustration rare|illustration rare/i.test(String(card?.rarity || ""));
      });
      if (!hasShowcaseHit) return jsonResponse({ error: "Tutorial pack is missing its showcase hit." }, 400);
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
    return jsonResponse({
      completed: Boolean(row?.completed),
      alreadyCompleted: Boolean(row?.already_completed),
      stats: {
        packsOpened: Number(row?.packs_opened || 0),
        totalCardsPulled: Number(row?.total_cards_pulled || 0),
      },
    });
  } catch (error) {
    console.error("complete-mobile-onboarding failed", { step, error: formatErrorForResponse(error) });
    return jsonResponse({ error: "Unable to complete mobile onboarding securely.", step }, 500);
  }
});
