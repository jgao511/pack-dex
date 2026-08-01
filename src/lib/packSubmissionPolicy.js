export const ATOMIC_PACK_RPC_NAME = "increment_collection_cards";
export const RETIRED_PACK_RPC_NAME = "record_pack_open_event";
export const RETIRED_PACK_EDGE_FUNCTION_NAME = "record-pack-open";
export const ATOMIC_PACK_SUBMISSION_VERSION = 2;

const TRANSIENT_HTTP_STATUSES = new Set([408, 425]);
const TRANSIENT_POSTGRES_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);
const TRANSIENT_POSTGREST_CODES = new Set(["PGRST000", "PGRST001", "PGRST002"]);
const PERMANENT_PACK_ERROR_CODES = new Set([
  "22023", // invalid_parameter_value
  "22P02", // invalid_text_representation
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23505", // unique_violation caused by an incompatible payload
  "42501", // insufficient_privilege / authentication required
  "42883", // undefined_function / wrong signature
  "PGRST202", // function not found in the schema cache
  "PACK_RATE_LIMITED",
  "PACK_WRITE_PATH_RETIRED",
]);

export class PackSubmissionValidationError extends Error {
  constructor(message, reason = "invalid_completed_pack") {
    super(message);
    this.name = "PackSubmissionValidationError";
    this.code = "22023";
    this.reason = reason;
    this.retryable = false;
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
    return operation === RETIRED_PACK_RPC_NAME ||
      operation === `public.${RETIRED_PACK_RPC_NAME}` ||
      operation === RETIRED_PACK_EDGE_FUNCTION_NAME;
  });
}

export function isPackQueueEntryVersionCompatible(entry) {
  if (entry?.submissionVersion === undefined || entry?.submissionVersion === null) return true;
  const version = Number(entry.submissionVersion);
  return Number.isInteger(version) && version >= 1 && version <= ATOMIC_PACK_SUBMISSION_VERSION;
}

function isStructurallyValidPackQueueEntry(entry) {
  const id = typeof entry?.id === "string" ? entry.id.trim() : "";
  const userId = typeof entry?.userId === "string" ? entry.userId.trim() : "";
  const setId = typeof entry?.setId === "string" ? entry.setId.trim() : "";
  const cards = entry?.cards;

  return Boolean(
    id && id.length <= 160 &&
    userId &&
    setId && setId.length <= 120 &&
    Array.isArray(cards) &&
    cards.length >= 1 &&
    cards.length <= 100 &&
    cards.every((card) => card && typeof card === "object" && !Array.isArray(card))
  );
}

// Explicit event-only jobs are never reinterpreted as full pack submissions.
// Versionless PackDex pull jobs are safe to upgrade because they contain the
// completed pack and stable event id. In particular, the former mobile queue's
// collectionConfirmedAt marker lets the atomic RPC repair its matching receipt
// without incrementing the collection a second time.
export function sanitizePendingPackQueueEntries(entries) {
  if (!Array.isArray(entries)) {
    return { entries: [], changed: true, removed: 0, reasons: ["invalid_queue_container"] };
  }

  const sanitized = [];
  const reasons = [];
  let changed = false;

  for (const entry of entries) {
    if (isLegacyPackQueueEntry(entry)) {
      changed = true;
      reasons.push("retired_event_only_job");
      continue;
    }
    if (!isStructurallyValidPackQueueEntry(entry)) {
      changed = true;
      reasons.push("malformed_pack_job");
      continue;
    }
    if (!isPackQueueEntryVersionCompatible(entry)) {
      changed = true;
      reasons.push("incompatible_pack_job_version");
      continue;
    }
    if (entry.submissionVersion === undefined || entry.submissionVersion === null) {
      sanitized.push({ ...entry, submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION });
      changed = true;
      reasons.push("upgraded_versionless_atomic_job");
    } else {
      sanitized.push(entry);
    }
  }

  return {
    entries: sanitized,
    changed,
    removed: entries.length - sanitized.length,
    reasons,
  };
}

export function getSafeCompletedPackPayloadShape(batches) {
  const normalizedBatches = Array.isArray(batches) ? batches : [];
  const batch = normalizedBatches.length === 1 ? normalizedBatches[0] : null;
  const cards = Array.isArray(batch?.cards) ? batch.cards : [];
  const setIds = new Set(
    cards.map((card) => String(card?.set_id || "").trim()).filter(Boolean)
  );

  return {
    rpc: ATOMIC_PACK_RPC_NAME,
    submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
    batchCount: normalizedBatches.length,
    clientEventId: String(batch?.client_event_id || ""),
    cardRowCount: cards.length,
    totalCardQuantity: cards.reduce(
      (total, card) => total + (Number.isFinite(Number(card?.quantity)) ? Number(card.quantity) : 0),
      0
    ),
    setCount: setIds.size,
  };
}

export function makeAtomicPackRpcPayload(batches) {
  if (!Array.isArray(batches) || batches.length !== 1) {
    throw new PackSubmissionValidationError(
      "Exactly one completed pack must be submitted.",
      "completed_pack_count"
    );
  }

  const [batch] = batches;
  const eventId = typeof batch?.client_event_id === "string"
    ? batch.client_event_id.trim()
    : "";
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
    return !setId || !cardId || !Number.isInteger(quantity) || quantity < 1;
  })) {
    throw new PackSubmissionValidationError(
      "A completed pack contains an invalid card row.",
      "invalid_card_row"
    );
  }

  return { batches: [batch] };
}

export function classifyPackSubmissionError(error, { rpcName = ATOMIC_PACK_RPC_NAME } = {}) {
  const code = normalizedErrorCode(error);
  const status = normalizedHttpStatus(error);
  const message = String(error?.message || error?.details || "").toLowerCase();
  const retiredRpc = rpcName === RETIRED_PACK_RPC_NAME;
  const explicitlyPermanent = error?.retryable === false;
  const explicitlyTransient = error?.retryable === true;
  const retiredResponse = retiredRpc && (
    code === "42501" ||
    code === "42883" ||
    code === "PACK_WRITE_PATH_RETIRED" ||
    status === 403 ||
    status === 404 ||
    status === 410 ||
    message.includes("permission denied for function record_pack_open_event")
  );
  const knownPermanentFailure = PERMANENT_PACK_ERROR_CODES.has(code) ||
    (status >= 400 && status < 500 && !TRANSIENT_HTTP_STATUSES.has(status)) ||
    message.includes("exactly one completed pack must be submitted") ||
    message.includes("invalid completed pack payload") ||
    message.includes("authentication required") ||
    message.includes("permission denied") ||
    message.includes("rate limit") ||
    message.includes("rate-limit") ||
    message.includes("function does not exist") ||
    message.includes("could not find the function") ||
    message.includes("returned no result");
  const knownTransientFailure = explicitlyTransient ||
    TRANSIENT_HTTP_STATUSES.has(status) ||
    status >= 500 ||
    code.startsWith("08") ||
    TRANSIENT_POSTGRES_CODES.has(code) ||
    TRANSIENT_POSTGREST_CODES.has(code) ||
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("connection reset") ||
    message.includes("connection refused") ||
    message.includes("temporarily unavailable");
  const retryable = !explicitlyPermanent && !retiredResponse && !knownPermanentFailure && knownTransientFailure;
  const permanent = !retryable;

  let reason = "permanent_pack_submission_error";
  if (retiredResponse) reason = "retired_pack_rpc";
  else if (retryable) reason = "transient_pack_submission_error";
  else if (explicitlyPermanent) reason = String(error?.reason || reason);
  else if (code === "42501" || message.includes("permission denied")) reason = "pack_submission_forbidden";
  else if (status === 401 || message.includes("authentication required")) reason = "pack_submission_unauthenticated";
  else if (code === "42883" || code === "PGRST202") reason = "pack_rpc_unavailable";
  else if (code.startsWith("22") || message.includes("invalid") || message.includes("malformed")) {
    reason = "invalid_pack_submission";
  } else if (code === "PACK_RATE_LIMITED" || message.includes("rate limit") || message.includes("rate-limit")) {
    reason = "pack_rate_limited";
  }

  return {
    permanent,
    retryable,
    code,
    reason,
  };
}

export function logCompletedPackPayloadShape(batches, {
  level = "info",
  reason = "submission",
  logger = console,
} = {}) {
  const method = typeof logger?.[level] === "function" ? level : "info";
  logger?.[method]?.("PackDex completed-pack payload", {
    reason,
    ...getSafeCompletedPackPayloadShape(batches),
  });
}
