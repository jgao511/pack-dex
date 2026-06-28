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
      debugStep = "load_existing_stats";
      const { data: statsRow, error: statsError } = await admin
        .from("user_profile_stats")
        .select("packs_opened,total_cards_pulled")
        .eq("user_id", user.id)
        .maybeSingle();

      if (statsError) throw statsError;

      return jsonResponse({
        recorded: false,
        duplicate: true,
        stats: normalizeStats(statsRow),
      });
    }

    debugStep = "increment_profile_stats";
    const { data: statsRows, error: statsError } = await admin.rpc("increment_user_profile_stats_for_user", {
      target_user_id: user.id,
      packs_opened_delta: 1,
      total_cards_pulled_delta: 0,
    });

    if (statsError) throw statsError;

    const statsRow = Array.isArray(statsRows) ? statsRows[0] : statsRows;

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
