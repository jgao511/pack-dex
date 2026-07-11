import { getAuthenticatedUser } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { verifyPackShareReceipt } from "../_shared/packShareReceipt.ts";

function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function publicShare(row: any) {
  return {
    shareToken: row.share_token,
    setId: row.set_id,
    cardIds: row.ordered_card_ids,
    bestPullCardId: row.best_pull_card_id,
    createdAt: row.created_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, user } = await getAuthenticatedUser(req);
    const body = await req.json().catch(() => ({}));
    const payload = await verifyPackShareReceipt(String(body?.shareReceipt || ""));
    if (payload.userId !== user.id) return jsonResponse({ error: "This pull belongs to a different account." }, 403);

    if (!payload.cardIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 180)) {
      return jsonResponse({ error: "This pull receipt is invalid." }, 400);
    }
    if (!payload.cardIds.includes(payload.bestPullCardId)) return jsonResponse({ error: "This pull receipt is invalid." }, 400);

    const { data: existing } = await admin.from("shared_pack_pulls").select("share_token,set_id,ordered_card_ids,best_pull_card_id,created_at").eq("opening_id", payload.openingId).maybeSingle();
    let row = existing;
    if (!row) {
      const { data, error } = await admin.from("shared_pack_pulls").insert({
        share_token: makeToken(), owner_user_id: user.id, opening_id: payload.openingId,
        set_id: payload.setId, ordered_card_ids: payload.cardIds, best_pull_card_id: payload.bestPullCardId,
      }).select("share_token,set_id,ordered_card_ids,best_pull_card_id,created_at").single();
      if (error?.code === "23505") {
        const retry = await admin.from("shared_pack_pulls").select("share_token,set_id,ordered_card_ids,best_pull_card_id,created_at").eq("opening_id", payload.openingId).single();
        if (retry.error) throw retry.error;
        row = retry.data;
      } else if (error) throw error;
      else row = data;
    }

    return jsonResponse({ url: `https://pack-dex.com/share/${row.share_token}`, share: publicShare(row) });
  } catch (error) {
    console.error("create-pull-share failed", { message: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error && error.message.startsWith("This share receipt")
      ? error.message
      : "Unable to create this share link.";
    return jsonResponse({ error: message }, 400);
  }
});
