import {
  getAuthenticatedUser,
} from "../_shared/auth.ts";
import {
  corsHeaders,
  formatErrorForResponse,
  jsonResponse,
} from "../_shared/http.ts";

function normalizeText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeOpenedAt(value: unknown) {
  const parsed = value ? Date.parse(String(value)) : NaN;

  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeStats(row: Record<string, unknown> | null | undefined) {
  return {
    packsOpened: Number(row?.packs_opened || 0),
    totalCardsPulled: Number(row?.total_cards_pulled || 0),
  };
}

async function syncProfilePackStats(admin: any, userId: string, { incrementStoredBy = 0 } = {}) {
  const { count: eventCount, error: eventCountError } = await admin
    .from("user_pack_open_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (eventCountError) throw eventCountError;

  const { data: existingStats, error: loadStatsError } = await admin
    .from("user_profile_stats")
    .select("packs_opened,total_cards_pulled")
    .eq("user_id", userId)
    .maybeSingle();

  if (loadStatsError) throw loadStatsError;

  const storedPacksOpened = Number(existingStats?.packs_opened || 0);
  const storedTotalCardsPulled = Number(existingStats?.total_cards_pulled || 0);
  const nextPacksOpened = Math.max(
    Number.isFinite(storedPacksOpened) ? storedPacksOpened + Math.max(incrementStoredBy, 0) : Math.max(incrementStoredBy, 0),
    Number(eventCount || 0),
  );

  const { data, error } = await admin
    .from("user_profile_stats")
    .upsert({
      user_id: userId,
      packs_opened: nextPacksOpened,
      total_cards_pulled: Number.isFinite(storedTotalCardsPulled) ? storedTotalCardsPulled : 0,
    }, { onConflict: "user_id" })
    .select("packs_opened,total_cards_pulled")
    .single();

  if (error) throw error;

  return data;
}

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
    const clientEventId = normalizeText(body?.client_event_id || body?.clientEventId, 160);
    const setId = normalizeText(body?.set_id || body?.setId, 120);
    const openedAt = normalizeOpenedAt(body?.opened_at || body?.openedAt);

    if (!clientEventId) {
      return jsonResponse({ error: "Missing pack-open event id." }, 400);
    }

    debugStep = "insert_pack_open_event";
    const { data: eventRow, error: eventError } = await admin
      .from("user_pack_open_events")
      .insert({
        user_id: user.id,
        client_event_id: clientEventId,
        set_id: setId,
        opened_at: openedAt,
      })
      .select("id,user_id,client_event_id,set_id,opened_at,created_at")
      .maybeSingle();

    if (eventError && eventError.code !== "23505") throw eventError;

    if (eventError?.code === "23505") {
      debugStep = "sync_existing_stats";
      const statsRow = await syncProfilePackStats(admin, user.id);

      return jsonResponse({
        recorded: false,
        duplicate: true,
        stats: normalizeStats(statsRow),
      });
    }

    debugStep = "sync_profile_stats";
    const statsRow = await syncProfilePackStats(admin, user.id, { incrementStoredBy: 1 });

    return jsonResponse({
      recorded: true,
      duplicate: false,
      event: eventRow,
      stats: normalizeStats(statsRow),
    });
  } catch (error) {
    const formattedError = formatErrorForResponse(error);

    console.error("record-pack-open failed", {
      step: debugStep,
      error: formattedError,
    });

    return jsonResponse(
      {
        error: "Unable to record pack-open event.",
        step: debugStep,
        ...formattedError,
      },
      500,
    );
  }
});
