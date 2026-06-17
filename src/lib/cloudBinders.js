import { normalizeBinder } from "../utils/binderStorage.js";
import { supabase } from "./supabaseClient.js";

const USER_BINDERS_TABLE = "user_binders";

function toTimestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;

  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sortCards(cards) {
  return [...(cards || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.addedAt || 0) - (b.addedAt || 0));
}

function rowToBinder(row) {
  return normalizeBinder({
    id: row.binder_id,
    name: row.name,
    tag: row.tag,
    type: row.type,
    setId: row.set_id,
    theme: row.theme,
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
    cards: sortCards(row.cards),
  });
}

function binderToRow(userId, binder) {
  const normalized = normalizeBinder(binder);

  if (!userId || !normalized) return null;

  return {
    user_id: userId,
    binder_id: normalized.id,
    name: normalized.name,
    tag: normalized.tag,
    type: normalized.type,
    set_id: normalized.setId,
    theme: normalized.theme,
    cards: sortCards(normalized.cards),
    created_at: new Date(normalized.createdAt || Date.now()).toISOString(),
    updated_at: new Date(normalized.updatedAt || Date.now()).toISOString(),
  };
}

function isMissingMetadataColumnError(error) {
  const message = `${error?.message || ""} ${error?.details || ""}`;

  return message.includes("type") || message.includes("set_id") || message.includes("theme");
}

function stripMetadataColumns(row) {
  const { type, set_id, theme, ...legacyRow } = row;

  return legacyRow;
}

function ensureClient(userId) {
  return Boolean(supabase && userId);
}

export async function loadCloudBinders(userId) {
  if (!ensureClient(userId)) return [];

  const { data, error } = await supabase
    .from(USER_BINDERS_TABLE)
    .select("binder_id, name, tag, type, set_id, theme, cards, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingMetadataColumnError(error)) {
      const { data: legacyData, error: legacyError } = await supabase
        .from(USER_BINDERS_TABLE)
        .select("binder_id, name, tag, cards, created_at, updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (!legacyError) {
        return (legacyData || []).map(rowToBinder).filter(Boolean);
      }
    }

    console.warn("Unable to load cloud binders", error);
    throw error;
  }

  return (data || []).map(rowToBinder).filter(Boolean);
}

export async function saveCloudBinders(userId, binders) {
  if (!ensureClient(userId)) return [];

  const normalizedBinders = (Array.isArray(binders) ? binders : []).map(normalizeBinder).filter(Boolean);
  const rows = normalizedBinders.map((binder) => binderToRow(userId, binder)).filter(Boolean);
  const binderIds = rows.map((row) => row.binder_id);

  if (rows.length > 0) {
    const { error: upsertError } = await supabase.from(USER_BINDERS_TABLE).upsert(rows, {
      onConflict: "user_id,binder_id",
    });

    if (upsertError) {
      if (isMissingMetadataColumnError(upsertError)) {
        const { error: legacyUpsertError } = await supabase.from(USER_BINDERS_TABLE).upsert(rows.map(stripMetadataColumns), {
          onConflict: "user_id,binder_id",
        });

        if (!legacyUpsertError) {
          console.warn("Cloud binders saved without master-set metadata. Run supabase/user_binders_master_set_metadata.sql to persist binder types.");
        } else {
          console.warn("Unable to save cloud binders", legacyUpsertError);
          throw legacyUpsertError;
        }
      } else {
        console.warn("Unable to save cloud binders", upsertError);
        throw upsertError;
      }
    }
  }

  const { data: existingRows, error: existingError } = await supabase
    .from(USER_BINDERS_TABLE)
    .select("binder_id")
    .eq("user_id", userId);

  if (existingError) {
    console.warn("Unable to load cloud binders before pruning", existingError);
    throw existingError;
  }

  const keepIds = new Set(binderIds);
  const deleteIds = (existingRows || []).map((row) => row.binder_id).filter((binderId) => !keepIds.has(binderId));

  if (deleteIds.length === 0) return normalizedBinders;

  const { error: deleteError } = await supabase
    .from(USER_BINDERS_TABLE)
    .delete()
    .eq("user_id", userId)
    .in("binder_id", deleteIds);

  if (deleteError) {
    console.warn("Unable to prune cloud binders", deleteError);
    throw deleteError;
  }

  return normalizedBinders;
}

export async function upsertCloudBinder(userId, binder) {
  if (!ensureClient(userId)) return null;

  const row = binderToRow(userId, binder);

  if (!row) return null;

  const { error } = await supabase.from(USER_BINDERS_TABLE).upsert(row, {
    onConflict: "user_id,binder_id",
  });

  if (error) {
    if (isMissingMetadataColumnError(error)) {
      const { error: legacyError } = await supabase.from(USER_BINDERS_TABLE).upsert(stripMetadataColumns(row), {
        onConflict: "user_id,binder_id",
      });

      if (!legacyError) {
        console.warn("Cloud binder saved without master-set metadata. Run supabase/user_binders_master_set_metadata.sql to persist binder types.");
        return normalizeBinder(binder);
      }

      console.warn("Unable to upsert cloud binder", legacyError);
      throw legacyError;
    }

    console.warn("Unable to upsert cloud binder", error);
    throw error;
  }

  return normalizeBinder(binder);
}

export async function deleteCloudBinder(userId, binderId) {
  if (!ensureClient(userId) || !binderId) return;

  const { error } = await supabase.from(USER_BINDERS_TABLE).delete().eq("user_id", userId).eq("binder_id", String(binderId));

  if (error) {
    console.warn("Unable to delete cloud binder", error);
    throw error;
  }
}
