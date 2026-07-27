import { getAuthenticatedUser } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";
import { findSet } from "../_shared/packdex.ts";
import { sets } from "../../../src/data/sets.js";

function isTutorialSet(setId: string) {
  if (setId === "151" || setId === "prismatic-evolutions") return true;
  const today = new Date().toISOString().slice(0, 10);
  const newest = [...sets]
    .filter((set) => set.cards?.length && set.pullRateProfile && String(set.releaseDate || "") <= today)
    .sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")))[0];
  return newest?.id === setId;
}

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
      const set = findSet(setId);
      if (!set || !isTutorialSet(setId) || cardIds.length !== 10) {
        return jsonResponse({ error: "Invalid tutorial pack." }, 400);
      }
      const catalogIds = new Set((set.cards || []).map((card: Record<string, unknown>) => String(card.id || "")));
      if (cardIds.some((id: string) => !catalogIds.has(id))) {
        return jsonResponse({ error: "Tutorial pack contains an unknown card." }, 400);
      }
      const hasShowcaseHit = cardIds.some((id: string) => {
        const card = (set.cards || []).find((candidate: Record<string, unknown>) => String(candidate.id || "") === id);
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
