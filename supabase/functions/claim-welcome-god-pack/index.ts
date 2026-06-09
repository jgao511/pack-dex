import { generateForcedGodPack } from "../../../src/utils/packGenerator.js";
import { corsHeaders, findSet, getAuthenticatedUser, jsonResponse, upsertCardsForUser } from "../_shared/packdex.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { admin, user } = await getAuthenticatedUser(req);
    const body = await req.json().catch(() => ({}));
    const setId = String(body?.set_id || body?.setId || "");
    const forcedFormat = body?.forcedFormat ? String(body.forcedFormat) : undefined;
    const set = findSet(setId);

    if (!set) {
      return jsonResponse({ error: "Unknown welcome reward set." }, 400);
    }

    await admin.from("user_welcome_rewards").upsert(
      {
        user_id: user.id,
        welcome_god_pack_claimed: false,
        welcome_god_pack_set: null,
        welcome_reward_claimed_at: null,
      },
      { onConflict: "user_id", ignoreDuplicates: true }
    );

    const claimedAt = new Date().toISOString();
    const { data: rewardRow, error: claimError } = await admin
      .from("user_welcome_rewards")
      .update({
        welcome_god_pack_claimed: true,
        welcome_god_pack_set: set.id,
        welcome_reward_claimed_at: claimedAt,
      })
      .eq("user_id", user.id)
      .eq("welcome_god_pack_claimed", false)
      .select("user_id, welcome_god_pack_claimed, welcome_god_pack_set, welcome_reward_claimed_at")
      .maybeSingle();

    if (claimError) throw claimError;

    if (!rewardRow) {
      return jsonResponse({
        alreadyClaimed: true,
        error: "This welcome reward has already been claimed.",
      }, 409);
    }

    const cards = generateForcedGodPack(set, set, forcedFormat);

    if (!cards?.length || !cards.isGodPack) {
      return jsonResponse({ error: "This welcome reward pack is unavailable." }, 400);
    }

    const savedRows = await upsertCardsForUser(admin, user.id, cards, set);

    return jsonResponse({
      cards,
      savedRows,
      godPackFormat: cards.godPackFormat || forcedFormat || "",
      rewardStatus: {
        isEligible: true,
        isClaimed: true,
        setId: set.id,
        claimedAt,
      },
    });
  } catch (error) {
    console.error("claim-welcome-god-pack failed", error);
    return jsonResponse({ error: "Unable to claim welcome reward securely." }, 500);
  }
});
