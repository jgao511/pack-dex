import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sets } from "../../../src/data/sets.js";
import { getCardCollectionKey } from "../../../src/utils/collectionStorage.js";
import { getCardImageUrl } from "../../../src/utils/assetUrls.js";
import { getDisplayCardName, getDisplayRarity } from "../../../src/utils/packGenerator.js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("PACKDEX_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("PACKDEX_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase Edge Function server environment.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new Error("Missing auth token.");
  }

  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Invalid or expired session.");
  }

  return { admin, user: data.user };
}

export function findSet(setId: string) {
  return sets.find((set) => set.id === setId);
}

export function compactCardPayload(card: Record<string, unknown>, set: Record<string, unknown>, quantity = 1) {
  const setId = String(set.id || "");

  return {
    card_id: getCardCollectionKey(card, setId),
    set_id: setId,
    quantity,
    card_name: getDisplayCardName(card, set),
    card_number: String(card?.number || ""),
    rarity: getDisplayRarity(card, set),
    image_url: getCardImageUrl(card),
    card_data: null,
  };
}

export async function upsertCardsForUser(admin: ReturnType<typeof createClient>, userId: string, cards: Record<string, unknown>[], set: Record<string, unknown>) {
  const grouped = new Map<string, ReturnType<typeof compactCardPayload>>();

  for (const card of cards) {
    const payload = compactCardPayload(card, set, 1);
    const existing = grouped.get(payload.card_id);

    grouped.set(payload.card_id, {
      ...payload,
      quantity: (existing?.quantity || 0) + 1,
    });
  }

  const groupedRows = [...grouped.values()];
  const cardIds = groupedRows.map((row) => row.card_id);
  const { data: existingRows, error: existingError } = await admin
    .from("user_collection")
    .select("card_id, quantity")
    .eq("user_id", userId)
    .eq("set_id", String(set.id || ""))
    .in("card_id", cardIds);

  if (existingError) throw existingError;

  const existingQuantities = new Map((existingRows || []).map((row) => [row.card_id, Number(row.quantity || 0)]));
  const timestamp = new Date().toISOString();
  const rows = groupedRows.map((row) => ({
    ...row,
    user_id: userId,
    quantity: (existingQuantities.get(row.card_id) || 0) + row.quantity,
    updated_at: timestamp,
  }));

  const { error } = await admin.from("user_collection").upsert(rows, {
    onConflict: "user_id,set_id,card_id",
  });

  if (error) throw error;

  return rows;
}
