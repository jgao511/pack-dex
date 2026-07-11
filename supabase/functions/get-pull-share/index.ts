import { getAdminClient } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";

const SHARE_CODE = /^[A-Za-z0-9_-]{10,12}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const shareCode = String(body?.share_code ?? body?.shareCode ?? "");
    if (!SHARE_CODE.test(shareCode)) return jsonResponse({ error: "Share not found." }, 404);

    const { data, error } = await getAdminClient()
      .from("public_pull_shares")
      .select("share_code,set_id,card_ids,pack_number,created_at,expires_at")
      .eq("share_code", shareCode)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ error: "Share not found." }, 404);
    return jsonResponse({ share: data });
  } catch (error) {
    console.error("get-pull-share failed", formatErrorForResponse(error));
    return jsonResponse({ error: "Unable to read pull share." }, 500);
  }
});
