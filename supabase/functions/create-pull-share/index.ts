import { getAdminClient } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";

const MAX_CARDS = 20;
const MAX_ID_LENGTH = 180;
const SHARE_ORIGIN = Deno.env.get("PUBLIC_SHARE_ORIGIN") || "https://pack-dex.com";

function text(value: unknown, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function getClientIp(req: Request) {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
}

function hourWindow() {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.toISOString();
}

function dayWindow() {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function makeShareCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g).slice(0, 12);
}

async function getOptionalUserId(admin: ReturnType<typeof getAdminClient>, req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { data } = await admin.auth.getUser(token);
  return data.user?.id || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const setId = text(body?.set_id ?? body?.setId, MAX_ID_LENGTH);
    const cardIds = Array.isArray(body?.card_ids ?? body?.cardIds) ? (body.card_ids ?? body.cardIds).map((id: unknown) => text(id, MAX_ID_LENGTH)) : [];
    const packNumber = body?.pack_number ?? body?.packNumber;

    if (!setId || cardIds.length < 1 || cardIds.length > MAX_CARDS || cardIds.some((id: string | null) => !id)) {
      return jsonResponse({ error: "Invalid pull share payload." }, 400);
    }
    if (packNumber != null && (!Number.isInteger(packNumber) || packNumber < 1 || packNumber > 1_000_000_000)) {
      return jsonResponse({ error: "Invalid pack number." }, 400);
    }

    const admin = getAdminClient();
    const ipAllowed = await admin.rpc("consume_public_pull_share_rate_limit", {
      p_scope: "ip-hour", p_subject: getClientIp(req), p_window_started_at: hourWindow(), p_limit: 30,
    });
    if (ipAllowed.error) throw ipAllowed.error;
    if (!ipAllowed.data) return jsonResponse({ error: "Too many shares. Please try again later." }, 429);

    const userId = await getOptionalUserId(admin, req);
    if (userId) {
      const userAllowed = await admin.rpc("consume_public_pull_share_rate_limit", {
        p_scope: "user-day", p_subject: userId, p_window_started_at: dayWindow(), p_limit: 100,
      });
      if (userAllowed.error) throw userAllowed.error;
      if (!userAllowed.data) return jsonResponse({ error: "Daily share limit reached." }, 429);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const shareCode = makeShareCode();
      const { error } = await admin.from("public_pull_shares").insert({
        share_code: shareCode,
        set_id: setId,
        card_ids: cardIds,
        pack_number: packNumber ?? null,
      });
      if (!error) return jsonResponse({ share_code: shareCode, url: `${SHARE_ORIGIN}/s/${shareCode}` }, 201);
      if (error.code !== "23505") throw error;
    }

    return jsonResponse({ error: "Unable to create a share code." }, 503);
  } catch (error) {
    console.error("create-pull-share failed", formatErrorForResponse(error));
    return jsonResponse({ error: "Unable to create pull share." }, 500);
  }
});
