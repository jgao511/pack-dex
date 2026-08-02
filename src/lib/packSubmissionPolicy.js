import {
  COMPLETED_PACK_QUEUE_SCHEMA_VERSION,
  PACKDEX_CLIENT_BUILD,
  PACK_RPC_CONTRACT_VERSION,
} from "./packPersistenceVersion.js";

export const ATOMIC_PACK_RPC_NAME = "increment_collection_cards";
const RETIRED_PACK_RPC_PARTS = ["record", "pack", "open", "event"];
const RETIRED_PACK_EDGE_FUNCTION_PARTS = ["record", "pack", "open"];
export const ATOMIC_PACK_SUBMISSION_VERSION = PACK_RPC_CONTRACT_VERSION;
export const PACK_RETRY_BASE_DELAY_MS = 8_000;
export const PACK_RETRY_MAX_DELAY_MS = 15 * 60_000;
export const PACK_RATE_LIMIT_RETRY_DELAYS_MS = Object.freeze({
  pack_rate_limit_one_second: 1_500,
  pack_rate_limit_sixty_seconds: 60_000,
});

const AUTH_HTTP_STATUSES = new Set([401, 403]);
const AUTH_POSTGRES_CODES = new Set(["42501"]);
const UNAVAILABLE_CODES = new Set(["42883", "PGRST202"]);
const RATE_LIMIT_CODES = new Set(["PACK_RATE_LIMITED", "429"]);
const DOCUMENTED_PERMANENT_REJECTION_CODES = new Set([
  "invalid_completed_pack_count",
  "invalid_completed_pack_payload",
  "invalid_collection_card_payload",
  "completed_pack_crosses_sets",
]);
const VALID_QUEUE_STATES = new Set(["pending", "submitting", "waiting_retry"]);
const diagnosticState = new Map();

function retiredPackRpcName() {
  return RETIRED_PACK_RPC_PARTS.join("_");
}

function retiredPackEdgeFunctionName() {
  return RETIRED_PACK_EDGE_FUNCTION_PARTS.join("-");
}

// Compatibility markers only. No current request path calls either target.
export const RETIRED_PACK_RPC_NAME = retiredPackRpcName();
export const RETIRED_PACK_EDGE_FUNCTION_NAME = retiredPackEdgeFunctionName();

export class PackSubmissionValidationError extends Error {
  constructor(message, reason = "invalid_completed_pack") {
    super(message);
    this.name = "PackSubmissionValidationError";
    this.code = "PACK_LOCAL_VALIDATION";
    this.reason = reason;
    this.retryable = false;
    this.localPermanent = true;
  }
}

function normalizedErrorCode(error) {
  return String(error?.code || error?.cause?.code || "").trim().toUpperCase();
}

function normalizedHttpStatus(error) {
  const status = Number(error?.status || error?.statusCode || error?.cause?.status || 0);
  return Number.isFinite(status) ? status : 0;
}

export function isLegacyPackQueueEntry(entry) {
  const candidates = [
    entry?.rpcName,
    entry?.rpc,
    entry?.operationName,
    entry?.operation,
    entry?.functionName,
    entry?.edgeFunction,
    entry?.target?.rpc,
    entry?.request?.rpc,
  ];

  return candidates.some((candidate) => {
    const operation = String(candidate || "").trim().toLowerCase();
    return operation === retiredPackRpcName() ||
      operation === `public.${retiredPackRpcName()}` ||
      operation === retiredPackEdgeFunctionName();
  });
}

export function isPackQueueEntryVersionCompatible(entry) {
  if (entry?.submissionVersion === undefined || entry?.submissionVersion === null) return true;
  const version = Number(entry.submissionVersion);
  return Number.isInteger(version) && version >= 1 && version <= ATOMIC_PACK_SUBMISSION_VERSION;
}

function getQueueEventId(entry) {
  return String(
    entry?.clientEventId ||
    entry?.client_event_id ||
    entry?.request?.p_client_event_id ||
    entry?.id ||
    ""
  ).trim();
}

function getQueueCards(entry) {
  if (Array.isArray(entry?.batches)) {
    if (entry.batches.length !== 1) return null;
    return entry.batches[0]?.cards;
  }
  return entry?.cards || entry?.payload?.cards || entry?.request?.cards;
}

function getQueueSetId(entry, cards) {
  const explicit = String(
    entry?.setId ||
    entry?.set_id ||
    entry?.request?.p_set_id ||
    entry?.batches?.[0]?.set_id ||
    ""
  ).trim();
  if (explicit) return explicit;
  const setIds = new Set(
    (cards || []).map((card) => String(card?.setId || card?.set_id || "").trim()).filter(Boolean)
  );
  return setIds.size === 1 ? [...setIds][0] : "";
}

function getCardIdentifier(card) {
  return String(card?.id || card?.cardId || card?.card_id || card?.number || "").trim();
}

function normalizeQueueTimestamp(value, fallback = Date.now()) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePendingPackQueueEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { reason: "malformed_pack_job" };
  }
  if (Array.isArray(entry.batches) && entry.batches.length !== 1) {
    return { reason: "ambiguous_multi_pack_job" };
  }
  if (!isPackQueueEntryVersionCompatible(entry)) {
    return { reason: "incompatible_pack_job_version" };
  }

  const id = getQueueEventId(entry);
  const userId = String(entry?.userId || entry?.user_id || "").trim();
  const cards = getQueueCards(entry);
  const setId = getQueueSetId(entry, cards);
  if (!id || id.length > 160 || !userId || !setId || setId.length > 120) {
    return { reason: isLegacyPackQueueEntry(entry) ? "legacy_event_only_job" : "malformed_pack_job" };
  }
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 100) {
    return { reason: isLegacyPackQueueEntry(entry) ? "legacy_event_only_job" : "invalid_pack_cards" };
  }
  if (cards.some((card) => {
    if (!card || typeof card !== "object" || Array.isArray(card) || !getCardIdentifier(card)) return true;
    const cardSetId = String(card.setId || card.set_id || "").trim();
    const quantity = card.quantity === undefined ? 1 : Number(card.quantity);
    return (cardSetId && cardSetId !== setId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100;
  })) {
    return { reason: "invalid_pack_cards" };
  }

  const attempts = Math.max(0, Math.floor(Number(entry.attempts) || 0));
  const nextRetryAt = entry.nextRetryAt === null || entry.nextRetryAt === undefined
    ? null
    : normalizeQueueTimestamp(entry.nextRetryAt, 0) || null;
  const requestedState = String(entry.state || "pending");
  const state = requestedState === "submitting"
    ? (nextRetryAt ? "waiting_retry" : "pending")
    : VALID_QUEUE_STATES.has(requestedState) ? requestedState : "pending";
  const normalized = {
    id,
    userId,
    setId,
    cards,
    createdAt: normalizeQueueTimestamp(entry.createdAt),
    attempts,
    nextRetryAt,
    state,
    submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
    queueSchemaVersion: COMPLETED_PACK_QUEUE_SCHEMA_VERSION,
    source: String(entry.source || (isLegacyPackQueueEntry(entry) ? "legacy_migrated" : "unknown")).slice(0, 40),
  };
  if (entry.expectedPacksOpened !== null && entry.expectedPacksOpened !== undefined && Number.isFinite(Number(entry.expectedPacksOpened))) {
    normalized.expectedPacksOpened = Number(entry.expectedPacksOpened);
  }
  if (entry.collectionConfirmedAt) normalized.collectionConfirmedAt = normalizeQueueTimestamp(entry.collectionConfirmedAt);
  if (entry.packEventConfirmedAt) normalized.packEventConfirmedAt = normalizeQueueTimestamp(entry.packEventConfirmedAt);
  if (entry.lastErrorCode) normalized.lastErrorCode = String(entry.lastErrorCode).slice(0, 32);
  if (entry.lastErrorReason) normalized.lastErrorReason = String(entry.lastErrorReason).slice(0, 80);
  return { entry: normalized, migratedLegacy: isLegacyPackQueueEntry(entry) };
}

function comparableEntryPayload(entry) {
  return JSON.stringify({ setId: entry.setId, cards: entry.cards });
}

// Active storage intentionally remains an array so stale v2/v3 clients do not
// misread a new top-level container and overwrite recoverable work. Every entry
// carries an explicit schema version; irrecoverable rows are returned for local
// quarantine rather than silently discarded.
export function sanitizePendingPackQueueEntries(entries) {
  if (!Array.isArray(entries)) {
    return {
      entries: [],
      quarantined: [{ entry: entries, reason: "invalid_queue_container" }],
      changed: true,
      removed: 0,
      reasons: ["invalid_queue_container"],
    };
  }

  const sanitizedByEvent = new Map();
  const quarantined = [];
  const reasons = [];
  let changed = false;

  for (const originalEntry of entries) {
    const normalized = normalizePendingPackQueueEntry(originalEntry);
    if (!normalized.entry) {
      changed = true;
      reasons.push(normalized.reason);
      quarantined.push({ entry: originalEntry, reason: normalized.reason });
      continue;
    }
    const candidate = normalized.entry;
    const key = `${candidate.userId}:${candidate.id}`;
    const existing = sanitizedByEvent.get(key);
    if (existing) {
      changed = true;
      if (comparableEntryPayload(existing) === comparableEntryPayload(candidate)) {
        reasons.push("duplicate_client_event_id_same_payload");
        const existingScore = Number(Boolean(existing.expectedPacksOpened)) + Number(Boolean(existing.collectionConfirmedAt));
        const candidateScore = Number(Boolean(candidate.expectedPacksOpened)) + Number(Boolean(candidate.collectionConfirmedAt));
        if (candidateScore > existingScore) sanitizedByEvent.set(key, candidate);
      } else {
        reasons.push("duplicate_client_event_id_payload_conflict");
        quarantined.push({ entry: originalEntry, reason: "duplicate_client_event_id_payload_conflict" });
      }
      continue;
    }
    sanitizedByEvent.set(key, candidate);
    if (
      normalized.migratedLegacy ||
      originalEntry.submissionVersion !== ATOMIC_PACK_SUBMISSION_VERSION ||
      originalEntry.queueSchemaVersion !== COMPLETED_PACK_QUEUE_SCHEMA_VERSION ||
      originalEntry.id !== candidate.id ||
      originalEntry.state !== candidate.state
    ) changed = true;
  }

  const sanitized = [...sanitizedByEvent.values()];
  return {
    entries: sanitized,
    quarantined,
    changed,
    removed: entries.length - sanitized.length,
    reasons,
  };
}

export function isPendingPackRetryEligible(entry, now = Date.now()) {
  return !entry?.nextRetryAt || Number(entry.nextRetryAt) <= Number(now);
}

export function getPendingPackRetryDelayMs(attempts, { reason = "", random = Math.random } = {}) {
  const controlledDelay = PACK_RATE_LIMIT_RETRY_DELAYS_MS[reason];
  if (controlledDelay) return controlledDelay;
  const exponent = Math.max(0, Math.min(10, Number(attempts) || 0));
  const bounded = Math.min(PACK_RETRY_MAX_DELAY_MS, PACK_RETRY_BASE_DELAY_MS * (2 ** exponent));
  const jitter = 0.75 + Math.max(0, Math.min(1, Number(random?.()) || 0)) * 0.5;
  return Math.min(PACK_RETRY_MAX_DELAY_MS, Math.round(bounded * jitter));
}

export function reschedulePendingPackEntry(entry, {
  reason = "transient_pack_submission_error",
  code = "",
  now = Date.now(),
  random = Math.random,
} = {}) {
  const attempts = Math.max(0, Number(entry?.attempts) || 0) + 1;
  const delay = getPendingPackRetryDelayMs(attempts - 1, { reason, random });
  return {
    ...entry,
    state: "waiting_retry",
    attempts,
    nextRetryAt: Number(now) + delay,
    lastErrorCode: String(code || "").slice(0, 32),
    lastErrorReason: String(reason || "").slice(0, 80),
  };
}

export function logPackSubmissionDiagnostic({
  operation = "completed_pack_submission",
  code = "",
  reason = "unknown",
  details = {},
  logger = console,
  level = "warn",
  now = Date.now(),
  cooldownMs = 30_000,
} = {}) {
  const fingerprint = [operation, code, reason].map((value) => String(value || "")).join(":");
  const previous = diagnosticState.get(fingerprint);
  if (previous && Number(now) - previous.lastReportedAt < cooldownMs) {
    previous.repeatCount += 1;
    return false;
  }
  const repeatCount = previous?.repeatCount || 0;
  diagnosticState.set(fingerprint, { lastReportedAt: Number(now), repeatCount: 0 });
  const method = typeof logger?.[level] === "function" ? level : "warn";
  logger?.[method]?.("PackDex completed-pack diagnostic", {
    operation,
    code: String(code || ""),
    reason: String(reason || "unknown"),
    repeatCount,
    clientBuild: PACKDEX_CLIENT_BUILD,
    rpcContractVersion: PACK_RPC_CONTRACT_VERSION,
    queueSchemaVersion: COMPLETED_PACK_QUEUE_SCHEMA_VERSION,
    ...details,
  });
  return true;
}

function truncatedEventId(value) {
  const eventId = String(value || "");
  return eventId ? eventId.slice(-12) : "";
}

export function getSafeCompletedPackPayloadShape(batches, { source = "unknown", userOwnershipMatch = null } = {}) {
  const normalizedBatches = Array.isArray(batches) ? batches : [];
  const batch = normalizedBatches.length === 1 ? normalizedBatches[0] : null;
  const cards = Array.isArray(batch?.cards) ? batch.cards : [];
  const setIds = new Set(cards.map((card) => String(card?.set_id || "").trim()).filter(Boolean));
  return {
    rpc: ATOMIC_PACK_RPC_NAME,
    submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
    batchCount: normalizedBatches.length,
    eventIdSuffix: truncatedEventId(batch?.client_event_id),
    setId: setIds.size === 1 ? [...setIds][0] : "",
    cardRowCount: cards.length,
    totalCardQuantity: cards.reduce(
      (total, card) => total + (Number.isFinite(Number(card?.quantity)) ? Number(card.quantity) : 0),
      0
    ),
    setCount: setIds.size,
    source,
    userOwnershipMatch,
  };
}

export function makeAtomicPackRpcPayload(batches, { source = "unknown" } = {}) {
  if (!Array.isArray(batches) || batches.length !== 1) {
    throw new PackSubmissionValidationError("Exactly one completed pack must be submitted.", "completed_pack_count");
  }
  const [batch] = batches;
  const eventId = typeof batch?.client_event_id === "string" ? batch.client_event_id.trim() : "";
  const cards = batch?.cards;
  if (!eventId || !Array.isArray(cards) || cards.length === 0) {
    throw new PackSubmissionValidationError(
      "A completed pack requires a stable event id and at least one card row.",
      "invalid_completed_pack"
    );
  }
  if (cards.some((card) => {
    const setId = typeof card?.set_id === "string" ? card.set_id.trim() : "";
    const cardId = typeof card?.card_id === "string" ? card.card_id.trim() : "";
    const quantity = Number(card?.quantity);
    return !setId || !cardId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100;
  })) {
    throw new PackSubmissionValidationError("A completed pack contains an invalid card row.", "invalid_card_row");
  }
  return {
    batches: [{
      ...batch,
      client_build: PACKDEX_CLIENT_BUILD,
      rpc_contract_version: PACK_RPC_CONTRACT_VERSION,
      queue_schema_version: COMPLETED_PACK_QUEUE_SCHEMA_VERSION,
      client_surface: String(source || "unknown").slice(0, 40),
    }],
  };
}

export function validatePackSubmissionAcknowledgement(data, submittedEventId) {
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  if (!rows.length) return { valid: false, reason: "missing_acknowledgement", rows };
  const expectedId = String(submittedEventId || "");
  const idsMatch = rows.every((row) => String(row?.client_event_id || "") === expectedId);
  if (!idsMatch) return { valid: false, reason: "mismatched_client_event_id", rows };
  const row = rows[0];
  if (typeof row.accepted !== "boolean") return { valid: false, reason: "missing_accepted", rows };
  const recorded = row.recorded === true;
  const alreadyProcessed = row.already_processed === true;
  if (row.accepted && !recorded && !alreadyProcessed) {
    return { valid: false, reason: "missing_recorded_or_already_processed", rows };
  }
  const rejectionCode = String(row.rejection_code || row.rejection_reason || "");
  if (!row.accepted && (!rejectionCode || typeof row.retryable !== "boolean")) {
    return { valid: false, reason: "incomplete_rejection_acknowledgement", rows };
  }
  return {
    valid: true,
    rows,
    accepted: row.accepted,
    recorded,
    alreadyProcessed,
    clientEventId: expectedId,
    rejectionCode,
    retryable: row.retryable === true,
    permanentRejection: row.accepted === false && row.retryable === false &&
      DOCUMENTED_PERMANENT_REJECTION_CODES.has(rejectionCode),
    stats: {
      packsOpened: Number(row.packsOpened || row.packs_opened || 0),
      totalCardsPulled: Number(row.totalCardsPulled || row.total_cards_pulled || 0),
    },
  };
}

export function classifyPackSubmissionError(error, { rpcName = ATOMIC_PACK_RPC_NAME } = {}) {
  const code = normalizedErrorCode(error);
  const status = normalizedHttpStatus(error);
  const message = String(error?.message || error?.details || "").toLowerCase();
  const localPermanent = error instanceof PackSubmissionValidationError || error?.localPermanent === true;
  const authentication = AUTH_HTTP_STATUSES.has(status) || AUTH_POSTGRES_CODES.has(code) ||
    message.includes("authentication required") || message.includes("missing session") ||
    message.includes("expired jwt") || message.includes("permission denied");
  const rateLimited = status === 429 || RATE_LIMIT_CODES.has(code) ||
    message.includes("rate limit") || message.includes("rate-limit");
  const unavailable = UNAVAILABLE_CODES.has(code) || message.includes("function does not exist") ||
    message.includes("could not find the function") || message.includes("schema cache");

  let reason = "transient_pack_submission_error";
  let category = "transient";
  if (localPermanent) {
    reason = String(error?.reason || "invalid_pack_submission");
    category = "local_validation";
  } else if (authentication) {
    reason = status === 401 ? "pack_submission_unauthenticated" : "pack_submission_authentication_failure";
    category = "authentication";
  } else if (rateLimited) {
    reason = "pack_rate_limited";
    category = "rate_limit";
  } else if (unavailable) {
    reason = "pack_rpc_unavailable";
    category = "deployment_skew";
  } else if (rpcName === retiredPackRpcName()) {
    reason = "retired_pack_rpc";
    category = "legacy_client";
  }
  return { permanent: localPermanent, retryable: !localPermanent, code, reason, category };
}

export function logCompletedPackPayloadShape(batches, { level = "info", reason = "submission", logger = console } = {}) {
  const method = typeof logger?.[level] === "function" ? level : "info";
  logger?.[method]?.("PackDex completed-pack payload", {
    reason,
    ...getSafeCompletedPackPayloadShape(batches),
  });
}
