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

export function compactPackCardForResponse(card: Record<string, unknown>, set: Record<string, unknown>, slotIndex: number) {
  const setId = String(set.id || "");

  return {
    id: card.id ? String(card.id) : getCardCollectionKey(card, setId),
    setId,
    setFolder: card.setFolder || set.setFolder || set.id,
    name: getDisplayCardName(card, set),
    number: String(card.number || ""),
    rarity: getDisplayRarity(card, set),
    rarityCategory: card.rarityCategory,
    pullCategory: card.pullCategory || card.rarityCategory,
    subset: card.subset || "",
    subsetType: card.subsetType || "",
    imagePath: card.imagePath || card.image || "",
    fileName: card.fileName || card.imageFileName || card.filename || "",
    image_url: getCardImageUrl(card),
    slot: slotIndex + 1,
  };
}

async function assertUserCollectionColumns(admin: ReturnType<typeof createClient>) {
  const { error } = await admin
    .from("user_collection")
    .select("user_id,set_id,card_id,quantity,card_name,card_number,rarity,image_url,card_data,updated_at")
    .limit(1);

  if (error) {
    throw {
      ...error,
      packdexStep: "check_user_collection_columns",
    };
  }
}

export async function upsertCardsForUser(admin: ReturnType<typeof createClient>, userId: string, cards: Record<string, unknown>[], set: Record<string, unknown>) {
  await assertUserCollectionColumns(admin);

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

  if (existingError) {
    throw {
      ...existingError,
      packdexStep: "load_existing_collection_rows",
      cardIds,
      setId: String(set.id || ""),
    };
  }

  const existingQuantities = new Map((existingRows || []).map((row) => [row.card_id, Number(row.quantity || 0)]));
  const timestamp = new Date().toISOString();
  const rows = groupedRows.map((row) => ({
    ...row,
    user_id: userId,
    quantity: (existingQuantities.get(row.card_id) || 0) + row.quantity,
    updated_at: timestamp,
  }));

  const existingCardIds = new Set((existingRows || []).map((row) => row.card_id));
  const rowsToUpdate = rows.filter((row) => existingCardIds.has(row.card_id));
  const rowsToInsert = rows.filter((row) => !existingCardIds.has(row.card_id));

  for (const row of rowsToUpdate) {
    const { error } = await admin
      .from("user_collection")
      .update({
        quantity: row.quantity,
        card_name: row.card_name,
        card_number: row.card_number,
        rarity: row.rarity,
        image_url: row.image_url,
        card_data: null,
        updated_at: timestamp,
      })
      .eq("user_id", userId)
      .eq("set_id", row.set_id)
      .eq("card_id", row.card_id);

    if (error) {
      throw {
        ...error,
        packdexStep: "update_collection_row",
        cardId: row.card_id,
        setId: row.set_id,
      };
    }
  }

  if (rowsToInsert.length > 0) {
    const { error } = await admin.from("user_collection").insert(rowsToInsert);

    if (error) {
      throw {
        ...error,
        packdexStep: "insert_collection_rows",
        rowCount: rowsToInsert.length,
        sampleRow: rowsToInsert[0],
      };
    }
  }

  return rows;
}

export async function incrementProfileStatsForUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  stats: { packsOpened?: number; totalCardsPulled?: number },
) {
  const packsOpened = Number(stats.packsOpened || 0);
  const totalCardsPulled = Number(stats.totalCardsPulled || 0);

  const { data: existingStats, error: loadError } = await admin
    .from("user_profile_stats")
    .select("packs_opened,total_cards_pulled")
    .eq("user_id", userId)
    .maybeSingle();

  if (loadError) {
    throw {
      ...loadError,
      packdexStep: "load_profile_stats",
      userId,
    };
  }

  const nextStats = {
    user_id: userId,
    packs_opened: Number(existingStats?.packs_opened || 0) + packsOpened,
    total_cards_pulled: Number(existingStats?.total_cards_pulled || 0) + totalCardsPulled,
  };

  const { data, error } = await admin
    .from("user_profile_stats")
    .upsert(nextStats, { onConflict: "user_id" })
    .select("packs_opened,total_cards_pulled")
    .single();

  if (error) {
    throw {
      ...error,
      packdexStep: "upsert_profile_stats",
      userId,
    };
  }

  return {
    packsOpened: Number(data?.packs_opened || 0),
    totalCardsPulled: Number(data?.total_cards_pulled || 0),
  };
}

export function formatErrorForResponse(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;

    return {
      packdexStep: record.packdexStep,
      code: record.code,
      message: record.message,
      details: record.details,
      hint: record.hint,
      cardId: record.cardId,
      setId: record.setId,
      rowCount: record.rowCount,
      sampleRow: record.sampleRow,
    };
  }

  return {
    message: String(error),
  };
}
