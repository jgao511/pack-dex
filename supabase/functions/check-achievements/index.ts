import { getAuthenticatedUser } from "../_shared/auth.ts";
import { corsHeaders, formatErrorForResponse, jsonResponse } from "../_shared/http.ts";
import priceCatalog from "../sync-card-prices/catalog.json" with { type: "json" };
import setCompletionCatalog from "./setCompletionCatalog.js";
import {
  VALUE_MILESTONES,
  SET_MASTERY_MILESTONES,
  calculateCompletedSetCount,
  calculateEstimatedCollectionValue,
  attachCollectionPriceIdentities,
  createAchievementCandidate,
  makeProgressRows,
} from "./achievementMetrics.js";

type Candidate = {
  achievement_id: string;
  scope_type: string;
  scope_key: string;
  award_key: string;
  metadata: Record<string, unknown>;
  source: string;
};

const PACK_MILESTONES = [
  ["first_pack_opened", 1], ["packs_opened_10", 10], ["packs_opened_25", 25],
  ["packs_opened_50", 50], ["packs_opened_100", 100], ["packs_opened_250", 250],
  ["packs_opened_500", 500], ["packs_opened_1000", 1000],
] as const;
const UNIQUE_MILESTONES = [
  ["binder_page_9", 9], ["collector_100", 100], ["unique_cards_250", 250], ["collector_500", 500],
] as const;
const TOTAL_MILESTONES = [
  ["card_stack_100", 100], ["total_cards_250", 250], ["total_cards_500", 500], ["card_stack_1000", 1000],
] as const;

const PROFILE_RECONCILIATION_SCOPE = "profile_reconcile";
const COLLECTION_PAGE_SIZE = 1000;
const CHECK_DEDUP_TABLE = "achievement_check_dedup";
const CHECK_LEASE_MS = 30_000;
const ACHIEVEMENT_EVALUATOR_VERSION = 2;
// Keep PostgREST `in` filter URLs comfortably below proxy/HTTP2 limits even
// when canonical card IDs are long. Large collections are processed in
// bounded server-side batches and still produce one reconciliation response.
const PRICE_CHUNK_SIZE = 100;

function candidate(userId: string, achievementId: string, category: string, current: number, target: number): Candidate {
  return createAchievementCandidate(userId, achievementId, category, current, target) as Candidate;
}

function addReached(
  candidates: Candidate[],
  userId: string,
  milestones: readonly (readonly [string, number])[],
  category: string,
  current: number,
) {
  milestones.forEach(([id, target]) => {
    if (current >= target) candidates.push(candidate(userId, id, category, current, target));
  });
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function makeProgressionFingerprint({
  userId,
  scope,
  packsOpened,
  totalCards,
  uniqueCards,
  collectionValue = null,
  completedSets = null,
}: {
  userId: string;
  scope: string;
  packsOpened: number;
  totalCards: number;
  uniqueCards: number;
  collectionValue?: number | null;
  completedSets?: number | null;
}) {
  return [
    `v${ACHIEVEMENT_EVALUATOR_VERSION}`,
    userId,
    scope,
    packsOpened,
    totalCards,
    uniqueCards,
    collectionValue === null ? "-" : Math.round(collectionValue * 100),
    completedSets === null ? "-" : completedSets,
  ].join(":");
}

async function claimAchievementCheck(
  admin: Awaited<ReturnType<typeof getAuthenticatedUser>>["admin"],
  {
    userId,
    scope,
    progressionFingerprint,
    requestId,
  }: {
    userId: string;
    scope: string;
    progressionFingerprint: string;
    requestId: string;
  },
) {
  const startedAt = new Date();
  const leaseExpiresAt = new Date(startedAt.getTime() + CHECK_LEASE_MS).toISOString();
  const claimRow = {
    user_id: userId,
    scope,
    progression_fingerprint: progressionFingerprint,
    request_id: requestId,
    response_body: null,
    started_at: startedAt.toISOString(),
    completed_at: null,
    lease_expires_at: leaseExpiresAt,
  };
  const { data: inserted, error: insertError } = await admin
    .from(CHECK_DEDUP_TABLE)
    .upsert(claimRow, {
      onConflict: "user_id,scope,progression_fingerprint",
      ignoreDuplicates: true,
    })
    .select("request_id,response_body,lease_expires_at")
    .maybeSingle();
  if (insertError) throw insertError;
  if (inserted?.request_id === requestId) return { ownsClaim: true, cachedResponse: null };

  const { data: existing, error: existingError } = await admin
    .from(CHECK_DEDUP_TABLE)
    .select("request_id,response_body,lease_expires_at")
    .eq("user_id", userId)
    .eq("scope", scope)
    .eq("progression_fingerprint", progressionFingerprint)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.response_body && typeof existing.response_body === "object") {
    return {
      ownsClaim: false,
      cachedResponse: {
        ...existing.response_body,
        awarded: [],
        deduplicated: true,
        deduplicationSource: "server_progression_cache",
        requestId,
        originalRequestId: existing.request_id,
      },
    };
  }

  const leaseTime = Date.parse(String(existing?.lease_expires_at || ""));
  if (Number.isFinite(leaseTime) && leaseTime > Date.now()) {
    return {
      ownsClaim: false,
      cachedResponse: {
        awarded: [],
        deduplicated: true,
        pending: true,
        deduplicationSource: "server_in_flight",
        progressionFingerprint,
        requestId,
        originalRequestId: existing?.request_id || null,
      },
    };
  }

  const { data: reclaimed, error: reclaimError } = await admin
    .from(CHECK_DEDUP_TABLE)
    .update(claimRow)
    .eq("user_id", userId)
    .eq("scope", scope)
    .eq("progression_fingerprint", progressionFingerprint)
    .is("response_body", null)
    .lte("lease_expires_at", startedAt.toISOString())
    .select("request_id")
    .maybeSingle();
  if (reclaimError) throw reclaimError;
  return reclaimed?.request_id === requestId
    ? { ownsClaim: true, cachedResponse: null }
    : {
      ownsClaim: false,
      cachedResponse: {
        awarded: [],
        deduplicated: true,
        pending: true,
        deduplicationSource: "server_in_flight",
        progressionFingerprint,
        requestId,
      },
    };
}

async function loadTrustedCollectionMetrics(
  admin: Awaited<ReturnType<typeof getAuthenticatedUser>>["admin"],
  userId: string,
) {
  const collectionRows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("user_collection")
      .select("set_id,card_id,quantity")
      .eq("user_id", userId)
      .gt("quantity", 0)
      .order("set_id", { ascending: true })
      .order("card_id", { ascending: true })
      .range(from, from + COLLECTION_PAGE_SIZE - 1);
    if (error) throw error;
    collectionRows.push(...(data || []));
    if (!data || data.length < COLLECTION_PAGE_SIZE) break;
    from += COLLECTION_PAGE_SIZE;
  }

  const collectionPriceRows = attachCollectionPriceIdentities(collectionRows, priceCatalog);
  const ownedCardIds = [...new Set(
    collectionPriceRows.map((row) => String(row.price_card_id || "")).filter(Boolean)
  )];
  const priceRows: Record<string, unknown>[] = [];

  for (const cardIds of chunkValues(ownedCardIds, PRICE_CHUNK_SIZE)) {
    const { data, error } = await admin
      .from("card_prices")
      .select("set_id,card_id,market_price_usd,synced_at")
      .in("card_id", cardIds);
    if (error) throw error;
    priceRows.push(...(data || []));
  }

  return {
    collectionValue: calculateEstimatedCollectionValue(collectionPriceRows, priceRows),
    completedSets: calculateCompletedSetCount(collectionRows, setCompletionCatalog),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  let debugStep = "authenticate";
  let ownedClaim: {
    admin: Awaited<ReturnType<typeof getAuthenticatedUser>>["admin"];
    userId: string;
    scope: string;
    progressionFingerprint: string;
    requestId: string;
  } | null = null;
  try {
    const { admin, user } = await getAuthenticatedUser(req);
    const body = await req.json().catch(() => ({}));
    const requestedScope = String(body?.scope || "pack_and_collection");
    const scope = requestedScope === PROFILE_RECONCILIATION_SCOPE
      ? PROFILE_RECONCILIATION_SCOPE
      : "pack_and_collection";
    const requestId = String(body?.request_id || crypto.randomUUID()).slice(0, 160);

    debugStep = "load_compact_profile_stats";
    const { data: stats, error: statsError } = await admin
      .from("user_profile_stats")
      .select("packs_opened,total_cards_pulled,unique_cards")
      .eq("user_id", user.id)
      .maybeSingle();
    if (statsError) throw statsError;

    const packsOpened = Math.max(0, Number(stats?.packs_opened || 0));
    const totalCards = Math.max(0, Number(stats?.total_cards_pulled || 0));
    const uniqueCards = Math.max(0, Number(stats?.unique_cards || 0));
    const isProfileReconciliation = scope === PROFILE_RECONCILIATION_SCOPE;

    let trustedCollectionMetrics = { collectionValue: 0, completedSets: 0 };
    if (isProfileReconciliation) {
      debugStep = "load_trusted_collection_achievement_metrics";
      trustedCollectionMetrics = await loadTrustedCollectionMetrics(admin, user.id);
    }

    const progressionFingerprint = makeProgressionFingerprint({
      userId: user.id,
      scope,
      packsOpened,
      totalCards,
      uniqueCards,
      collectionValue: isProfileReconciliation ? trustedCollectionMetrics.collectionValue : null,
      completedSets: isProfileReconciliation ? trustedCollectionMetrics.completedSets : null,
    });
    debugStep = "claim_progression_check";
    const claim = await claimAchievementCheck(admin, {
      userId: user.id,
      scope,
      progressionFingerprint,
      requestId,
    });
    if (!claim.ownsClaim) return jsonResponse(claim.cachedResponse);
    ownedClaim = { admin, userId: user.id, scope, progressionFingerprint, requestId };

    const candidates: Candidate[] = [candidate(user.id, "account_created", "special", 1, 1)];
    addReached(candidates, user.id, PACK_MILESTONES, "packs", packsOpened);
    addReached(candidates, user.id, UNIQUE_MILESTONES, "collection", uniqueCards);
    addReached(candidates, user.id, TOTAL_MILESTONES, "collection", totalCards);
    if (isProfileReconciliation) {
      addReached(candidates, user.id, VALUE_MILESTONES, "value", trustedCollectionMetrics.collectionValue);
      addReached(candidates, user.id, SET_MASTERY_MILESTONES, "set_mastery", trustedCollectionMetrics.completedSets);
    }

    debugStep = "load_existing_affected_achievements";
    const awardKeys = candidates.map((item) => item.award_key);
    const { data: existingRows, error: existingError } = await admin
      .from("user_achievements")
      .select("award_key")
      .eq("user_id", user.id)
      .in("award_key", awardKeys);
    if (existingError) throw existingError;

    const existingKeys = new Set((existingRows || []).map((row) => row.award_key));
    const rowsToInsert = candidates
      .filter((item) => !existingKeys.has(item.award_key))
      .map((item) => ({ user_id: user.id, ...item }));

    let awarded: Record<string, unknown>[] = [];
    if (rowsToInsert.length > 0) {
      debugStep = "batch_insert_achievements";
      const { data, error } = await admin
        .from("user_achievements")
        .upsert(rowsToInsert, { onConflict: "user_id,award_key", ignoreDuplicates: true })
        .select("id,user_id,achievement_id,scope_type,scope_key,award_key,metadata,source,awarded_at,created_at,updated_at");
      if (error) throw error;
      awarded = data || [];
    }

    const responseBody = isProfileReconciliation
      ? {
        awarded,
        progress: [
          ...makeProgressRows(PACK_MILESTONES, packsOpened, "packs", "user_profile_stats"),
          ...makeProgressRows(UNIQUE_MILESTONES, uniqueCards, "collection", "user_profile_stats"),
          ...makeProgressRows(TOTAL_MILESTONES, totalCards, "collection", "user_profile_stats"),
          ...makeProgressRows(VALUE_MILESTONES, trustedCollectionMetrics.collectionValue, "value", "user_collection,card_prices"),
          ...makeProgressRows(SET_MASTERY_MILESTONES, trustedCollectionMetrics.completedSets, "set_mastery", "user_collection,achievement_set_catalog"),
        ],
        progressionFingerprint,
        requestId,
        deduplicated: false,
      }
      : { awarded, progressionFingerprint, requestId, deduplicated: false };

    debugStep = "complete_progression_check";
    const { error: completionError } = await admin
      .from(CHECK_DEDUP_TABLE)
      .update({
        response_body: responseBody,
        completed_at: new Date().toISOString(),
        lease_expires_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("scope", scope)
      .eq("progression_fingerprint", progressionFingerprint)
      .eq("request_id", requestId);
    if (completionError) throw completionError;
    ownedClaim = null;

    // Keep the defense-in-depth table bounded to the latest completed state per
    // user/scope. A concurrent active lease is left untouched.
    const { error: cleanupError } = await admin
      .from(CHECK_DEDUP_TABLE)
      .delete()
      .eq("user_id", user.id)
      .eq("scope", scope)
      .neq("progression_fingerprint", progressionFingerprint)
      .not("completed_at", "is", null);
    if (cleanupError) {
      console.warn("Unable to prune prior achievement check fingerprints", {
        userId: user.id,
        scope,
        error: formatErrorForResponse(cleanupError),
      });
    }

    return jsonResponse(responseBody);
  } catch (error) {
    if (ownedClaim) {
      await ownedClaim.admin
        .from(CHECK_DEDUP_TABLE)
        .delete()
        .eq("user_id", ownedClaim.userId)
        .eq("scope", ownedClaim.scope)
        .eq("progression_fingerprint", ownedClaim.progressionFingerprint)
        .eq("request_id", ownedClaim.requestId);
    }
    const formattedError = formatErrorForResponse(error);
    console.error("check-achievements failed", { step: debugStep, error: formattedError });
    return jsonResponse({ error: "Unable to check achievements securely.", step: debugStep, ...formattedError }, 500);
  }
});
