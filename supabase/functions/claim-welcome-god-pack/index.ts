import { generateForcedGodPack } from "../../../src/utils/packGenerator.js";
import {
  compactPackCardForResponse,
  corsHeaders,
  findSet,
  formatErrorForResponse,
  getAuthenticatedUser,
  jsonResponse,
  upsertCardsForUser,
} from "../_shared/packdex.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let debugStep = "start";

  try {
    debugStep = "authenticate";
    const { admin, user } = await getAuthenticatedUser(req);
    debugStep = "parse_body";
    const body = await req.json().catch(() => ({}));
    const setId = String(body?.set_id || body?.setId || "");
    const forcedFormat = body?.forcedFormat ? String(body.forcedFormat) : undefined;
    debugStep = "find_set";
    const set = findSet(setId);

    if (!set) {
      return jsonResponse({ error: "Unknown welcome reward set." }, 400);
    }

    debugStep = "load_reward";
    const { data: existingReward, error: loadRewardError } = await admin
      .from("user_welcome_rewards")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (loadRewardError) throw loadRewardError;

    if (!existingReward) {
      debugStep = "create_reward";
      const { error: createRewardError } = await admin
        .from("user_welcome_rewards")
        .insert({ user_id: user.id });

      if (createRewardError) throw createRewardError;
    }

    const claimedAt = new Date().toISOString();
    debugStep = "claim_reward";
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

    debugStep = "generate_pack";
    const cards = generateForcedGodPack(set, set, forcedFormat);

    if (!cards?.length || !cards.isGodPack) {
      return jsonResponse({ error: "This welcome reward pack is unavailable." }, 400);
    }

    debugStep = "save_collection";
    await upsertCardsForUser(admin, user.id, cards, set);

    return jsonResponse({
      cards: cards.map((card, index) => compactPackCardForResponse(card, set, index)),
      godPackFormat: cards.godPackFormat || forcedFormat || "",
      godPackDisplayName: cards.godPackDisplayName || "God Pack",
      rewardStatus: {
        isEligible: true,
        isClaimed: true,
        setId: set.id,
        claimedAt,
      },
    });
  } catch (error) {
    const formattedError = formatErrorForResponse(error);

    console.error("claim-welcome-god-pack failed", {
      step: debugStep,
      error: formattedError,
    });

    return jsonResponse(
      {
        error: "Unable to claim welcome reward securely.",
        step: debugStep,
        ...formattedError,
      },
      500
    );
  }
});
