import { generateForcedGodPack } from "../../../src/utils/packGenerator.js";
import {
  compactPackCardForResponse,
  corsHeaders,
  findSet,
  formatErrorForResponse,
  getAuthenticatedUser,
  incrementProfileStatsForUser,
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
      .select("user_id,welcome_god_pack_claimed,welcome_god_pack_set,welcome_reward_claimed_at,welcome_reward_claim_id,welcome_reward_cards,welcome_reward_cards_saved_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (loadRewardError) throw loadRewardError;

    if (existingReward?.welcome_god_pack_claimed && existingReward.welcome_reward_cards_saved_at) {
      return jsonResponse({
        alreadyClaimed: true,
        error: "This welcome reward has already been claimed.",
        rewardStatus: {
          isEligible: true,
          isClaimed: true,
          setId: existingReward.welcome_god_pack_set || "",
          claimedAt: existingReward.welcome_reward_claimed_at || "",
        },
      }, 409);
    }

    if (
      existingReward?.welcome_god_pack_claimed &&
      !existingReward.welcome_reward_cards_saved_at &&
      Array.isArray(existingReward.welcome_reward_cards)
    ) {
      debugStep = "retry_save_claimed_reward";
      const retrySet = findSet(String(existingReward.welcome_god_pack_set || ""));

      if (!retrySet) {
        return jsonResponse({ error: "Claimed welcome reward set is unavailable." }, 400);
      }

      const retryCards = existingReward.welcome_reward_cards as Record<string, unknown>[];

      await upsertCardsForUser(admin, user.id, retryCards, retrySet);
      const savedAt = new Date().toISOString();
      const stats = await incrementProfileStatsForUser(admin, user.id, {
        packsOpened: 1,
        totalCardsPulled: retryCards.length,
      });

      const { error: markSavedError } = await admin
        .from("user_welcome_rewards")
        .update({ welcome_reward_cards_saved_at: savedAt })
        .eq("user_id", user.id)
        .is("welcome_reward_cards_saved_at", null);

      if (markSavedError) throw markSavedError;

      return jsonResponse({
        cards: retryCards,
        godPackFormat: "",
        godPackDisplayName: "God Pack",
        stats,
        rewardStatus: {
          isEligible: true,
          isClaimed: true,
          setId: retrySet.id,
          claimedAt: existingReward.welcome_reward_claimed_at || savedAt,
        },
      });
    }

    if (!existingReward) {
      debugStep = "create_reward";
      const { error: createRewardError } = await admin
        .from("user_welcome_rewards")
        .insert({ user_id: user.id });

      if (createRewardError) throw createRewardError;
    }

    debugStep = "generate_pack";
    const cards = generateForcedGodPack(set, set, forcedFormat);

    if (!cards?.length || !cards.isGodPack) {
      return jsonResponse({ error: "This welcome reward pack is unavailable." }, 400);
    }

    const claimedAt = new Date().toISOString();
    const claimId = crypto.randomUUID();
    const responseCards = cards.map((card, index) => compactPackCardForResponse(card, set, index));

    debugStep = "claim_reward";
    const { data: rewardRow, error: claimError } = await admin
      .from("user_welcome_rewards")
      .update({
        welcome_god_pack_claimed: true,
        welcome_god_pack_set: set.id,
        welcome_reward_claimed_at: claimedAt,
        welcome_reward_claim_id: claimId,
        welcome_reward_cards: responseCards,
      })
      .eq("user_id", user.id)
      .eq("welcome_god_pack_claimed", false)
      .select("user_id, welcome_god_pack_claimed, welcome_god_pack_set, welcome_reward_claimed_at, welcome_reward_cards_saved_at")
      .maybeSingle();

    if (claimError) throw claimError;

    if (!rewardRow) {
      return jsonResponse({
        alreadyClaimed: true,
        error: "This welcome reward has already been claimed.",
      }, 409);
    }

    debugStep = "save_collection";
    await upsertCardsForUser(admin, user.id, cards, set);
    const savedAt = new Date().toISOString();
    debugStep = "save_profile_stats";
    const stats = await incrementProfileStatsForUser(admin, user.id, {
      packsOpened: 1,
      totalCardsPulled: cards.length,
    });

    debugStep = "mark_reward_cards_saved";
    const { error: markSavedError } = await admin
      .from("user_welcome_rewards")
      .update({ welcome_reward_cards_saved_at: savedAt })
      .eq("user_id", user.id)
      .is("welcome_reward_cards_saved_at", null);

    if (markSavedError) throw markSavedError;

    return jsonResponse({
      cards: responseCards,
      godPackFormat: cards.godPackFormat || forcedFormat || "",
      godPackDisplayName: cards.godPackDisplayName || "God Pack",
      stats,
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
