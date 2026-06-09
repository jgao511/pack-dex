import { generatePack } from "../../../src/utils/packGenerator.js";
import { corsHeaders, findSet, getAuthenticatedUser, jsonResponse, upsertCardsForUser } from "../_shared/packdex.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { admin, user } = await getAuthenticatedUser(req);
    const body = await req.json().catch(() => ({}));
    const setId = String(body?.set_id || body?.setId || "");
    const set = findSet(setId);

    if (!set) {
      return jsonResponse({ error: "Unknown set." }, 400);
    }

    const cards = generatePack(set);
    const savedRows = await upsertCardsForUser(admin, user.id, cards, set);

    return jsonResponse({
      cards,
      savedRows,
      isGodPack: Boolean(cards.isGodPack),
      godPackFormat: cards.godPackFormat || "",
      godPackDisplayName: cards.godPackDisplayName || "",
    });
  } catch (error) {
    console.error("open-pack failed", error);
    return jsonResponse({ error: "Unable to open pack securely." }, 500);
  }
});
