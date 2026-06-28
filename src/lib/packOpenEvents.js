import { supabase } from "./supabaseClient.js";

function makeFallbackId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function ensurePackOpenClientEventId(cards, setId = "") {
  if (!cards || typeof cards !== "object") return "";

  if (!cards.packOpenClientEventId) {
    Object.defineProperty(cards, "packOpenClientEventId", {
      value: `pack-open:${setId || "unknown"}:${makeFallbackId()}`,
      enumerable: false,
      configurable: true,
    });
  }

  return cards.packOpenClientEventId;
}

function normalizeStats(row = {}) {
  return {
    packsOpened: Number(row.packsOpened || row.packs_opened || 0),
    totalCardsPulled: Number(row.totalCardsPulled || row.total_cards_pulled || 0),
  };
}

async function getCurrentPackOpenUser() {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.warn("Unable to read PackDex pack-open user", error);
    return null;
  }

  return data.user || null;
}

export async function recordPackOpenEvent({ userId = "", setId = "", cards = [], clientEventId = "", openedAt = "" } = {}) {
  if (!supabase) return null;

  const user = await getCurrentPackOpenUser();

  if (!user?.id) return null;
  if (userId && String(userId) !== String(user.id)) return null;

  const eventId = clientEventId || ensurePackOpenClientEventId(cards, setId);

  if (!eventId) return null;

  const { data, error } = await supabase.functions.invoke("record-pack-open", {
    body: {
      client_event_id: eventId,
      set_id: setId,
      opened_at: openedAt || new Date().toISOString(),
    },
  });

  if (error) {
    console.warn("Unable to record PackDex pack-open event", {
      userId: user.id,
      setId,
      error,
    });
    throw error;
  }

  return {
    recorded: Boolean(data?.recorded),
    duplicate: Boolean(data?.duplicate),
    stats: normalizeStats(data?.stats),
  };
}
