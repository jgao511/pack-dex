import { getAuthenticatedUser } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";
import {
  compactWelcomeRewardCard,
  findWelcomeRewardSet,
  generateWelcomeRewardGodPack,
} from "../_shared/welcomeRewardPackdex.ts";

const WELCOME_REWARD_SET_IDS = new Set([
  "prismatic-evolutions",
  "black-bolt",
  "white-flare",
  "ascended-heroes",
  "151",
]);

type WelcomeClaimAcknowledgement = {
  status: string;
  client_event_id: string;
  recorded: boolean;
  already_processed: boolean;
  eligible_packs: number;
  reward_set_id: string;
  reward_claim_id: string;
  reward_claimed_at: string | null;
  packs_opened: number;
  total_cards_pulled: number;
};

function parseClaimAcknowledgement(data: unknown): WelcomeClaimAcknowledgement | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown>;

  if (
    !row ||
    typeof row.status !== "string" ||
    typeof row.client_event_id !== "string" ||
    typeof row.recorded !== "boolean" ||
    typeof row.already_processed !== "boolean" ||
    typeof row.eligible_packs !== "number" ||
    typeof row.reward_set_id !== "string" ||
    typeof row.reward_claim_id !== "string" ||
    (row.reward_claimed_at !== null && typeof row.reward_claimed_at !== "string") ||
    typeof row.packs_opened !== "number" ||
    typeof row.total_cards_pulled !== "number"
  ) {
    return null;
  }

  return row as WelcomeClaimAcknowledgement;
}

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
    const set = findWelcomeRewardSet(setId);

    if (!set || !WELCOME_REWARD_SET_IDS.has(setId)) {
      return jsonResponse({ error: "Unknown welcome reward set." }, 400);
    }

    debugStep = "generate_pack";
    const cards = generateWelcomeRewardGodPack(set, forcedFormat);

    if (!cards?.length || !cards.isGodPack || cards.length !== 10) {
      return jsonResponse({ error: "This welcome reward pack is unavailable." }, 400);
    }

    const claimId = crypto.randomUUID();
    const eventId = `welcome-god-pack:${claimId}`;
    const responseCards = cards.map((card, index) => compactWelcomeRewardCard(card, set, index));

    debugStep = "claim_atomic";
    const { data, error } = await admin.rpc("claim_welcome_god_pack_v1", {
      p_user_id: user.id,
      p_set_id: set.id,
      p_claim_id: claimId,
      p_reward_cards: responseCards,
    });
    if (error) throw error;

    const acknowledgement = parseClaimAcknowledgement(data);
    if (!acknowledgement) {
      throw new Error("Malformed atomic welcome reward acknowledgement");
    }

    if (acknowledgement.status === "not_ready") {
      return jsonResponse({
        error: "Open 50 eligible packs before claiming this reward.",
        rewardStatus: {
          isEligible: true,
          isReady: false,
          isClaimed: false,
          eligiblePacks: acknowledgement.eligible_packs,
          targetPacks: 50,
        },
      }, 403);
    }

    if (acknowledgement.status === "already_claimed") {
      return jsonResponse({
        alreadyClaimed: true,
        error: "This welcome reward has already been claimed.",
        rewardStatus: {
          isEligible: true,
          isReady: true,
          isClaimed: true,
          eligiblePacks: acknowledgement.eligible_packs,
          targetPacks: 50,
          setId: acknowledgement.reward_set_id,
          claimedAt: acknowledgement.reward_claimed_at || "",
        },
      }, 409);
    }

    if (acknowledgement.status === "legacy_pending_review") {
      return jsonResponse({
        error: "This reward needs support review before it can be completed safely.",
        supportReviewRequired: true,
      }, 409);
    }

    if (
      acknowledgement.status !== "claimed" ||
      acknowledgement.recorded !== true ||
      acknowledgement.already_processed !== false ||
      acknowledgement.client_event_id !== eventId ||
      acknowledgement.reward_claim_id !== claimId ||
      acknowledgement.reward_set_id !== set.id ||
      typeof acknowledgement.reward_claimed_at !== "string"
    ) {
      throw new Error("Invalid atomic welcome reward acknowledgement");
    }

    return jsonResponse({
      cards: responseCards,
      godPackFormat: cards.godPackFormat || forcedFormat || "",
      godPackDisplayName: cards.godPackDisplayName || "God Pack",
      stats: {
        packsOpened: acknowledgement.packs_opened,
        totalCardsPulled: acknowledgement.total_cards_pulled,
      },
      rewardStatus: {
        isEligible: true,
        isReady: true,
        isClaimed: true,
        eligiblePacks: acknowledgement.eligible_packs,
        targetPacks: 50,
        setId: set.id,
        claimedAt: acknowledgement.reward_claimed_at,
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
