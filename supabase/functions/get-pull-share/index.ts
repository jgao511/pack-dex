import { getAdminClient } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const token = String(new URL(req.url).searchParams.get("token") || body?.token || "").trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return jsonResponse({ error: "Shared pull not found." }, 404);
    const { data: row, error } = await getAdminClient().from("shared_pack_pulls")
      .select("share_token,set_id,ordered_card_ids,best_pull_card_id,created_at").eq("share_token", token).maybeSingle();
    if (error || !row) return jsonResponse({ error: "Shared pull not found." }, 404);

    return jsonResponse({
      shareToken: row.share_token,
      setId: row.set_id,
      cardIds: row.ordered_card_ids,
      bestPullCardId: row.best_pull_card_id,
      createdAt: row.created_at,
    });
  } catch {
    return jsonResponse({ error: "Shared pull not found." }, 404);
  }
});
