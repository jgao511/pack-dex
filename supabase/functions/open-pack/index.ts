import { generatePack } from "../../../src/utils/packGenerator.js";
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
    debugStep = "find_set";
    const set = findSet(setId);

    if (!set) {
      return jsonResponse({ error: "Unknown set." }, 400);
    }

    debugStep = "generate_pack";
    const cards = generatePack(set);
    debugStep = "save_collection";
    await upsertCardsForUser(admin, user.id, cards, set);

    return jsonResponse({
      cards: cards.map((card, index) => compactPackCardForResponse(card, set, index)),
      isGodPack: Boolean(cards.isGodPack),
      godPackFormat: cards.godPackFormat || "",
      godPackDisplayName: cards.godPackDisplayName || "",
    });
  } catch (error) {
    const formattedError = formatErrorForResponse(error);
    const message = formattedError.message || "Unknown error.";

    console.error("open-pack failed", {
      step: debugStep,
      error: formattedError,
    });

    return jsonResponse(
      {
        error: "Unable to open pack securely.",
        step: debugStep,
        ...formattedError,
      },
      500
    );
  }
});
