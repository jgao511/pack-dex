export const ATOMIC_PACK_RPC_NAME = "increment_collection_cards";
const RETIRED_PACK_RPC_PARTS = ["record", "pack", "open", "event"];
const RETIRED_PACK_EDGE_FUNCTION_PARTS = ["record", "pack", "open"];
export const ATOMIC_PACK_SUBMISSION_VERSION = 3;
export const PACK_RETRY_BASE_DELAY_MS = 2_000;
export const PACK_RETRY_MAX_DELAY_MS = 5 * 60_000;
export const PACK_RATE_LIMIT_RETRY_DELAYS_MS = Object.freeze({
  pack_rate_limit_one_second: 1_250,
  pack_rate_limit_sixty_seconds: 60_000,
});

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
const diagnosticState = new Map();

function retiredPackRpcName() {
  return RETIRED_PACK_RPC_PARTS.join("_");
}

function retiredPackEdgeFunctionName() {
  return RETIRED_PACK_EDGE_FUNCTION_PARTS.join("-");
}

// Kept as a computed compatibility marker for queue sanitation and tests. No
// production request path uses this value as an RPC or Edge Function target.
export const RETIRED_PACK_RPC_NAME = retiredPackRpcName();
export const RETIRED_PACK_EDGE_FUNCTION_NAME = retiredPackEdgeFunctionName();

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
  return String(entry?.clientEventId || entry?.client_event_id || entry?.id || "").trim();
}

function getQueueCards(entry) {
  if (Array.isArray(entry?.batches)) {
    if (entry.batches.length !== 1) return null;
    return entry.batches[0]?.cards;
  }
  return entry?.cards;
}

function getQueueSetId(entry, cards) {
  const explicit = String(entry?.setId || entry?.set_id || "").trim();
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
  if (isLegacyPackQueueEntry(entry)) return { reason: "retired_event_only_job" };
  if (entry.collectionConfirmedAt && entry.packEventConfirmedAt) {
    return { reason: "legacy_already_confirmed_job" };
  }
  if (Array.isArray(entry.batches) && entry.batches.length !== 1) {
    return { reason: "ambiguous_multi_pack_job" };
  }
  if (!isPackQueueEntryVersionCompatible(entry)) {
    return { reason: "incompatible_pack_job_version" };
  }

  const id = getQueueEventId(entry);
  const userId = typeof entry?.userId === "string" ? entry.userId.trim() : "";
  const cards = getQueueCards(entry);
  const setId = getQueueSetId(entry, cards);
  if (!id || id.length > 160 || !userId || !setId || setId.length > 120) {
    return { reason: "malformed_pack_job" };
  }
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 100) {
    return { reason: "invalid_pack_cards" };
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
  const normalized = {
    id,
    userId,
    setId,
    cards,
    createdAt: normalizeQueueTimestamp(entry.createdAt),
    attempts,
    nextRetryAt,
    submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
  };
  if (entry.expectedPacksOpened !== null && entry.expectedPacksOpened !== undefined && Number.isFinite(Number(entry.expectedPacksOpened))) {
    normalized.expectedPacksOpened = Number(entry.expectedPacksOpened);
  }
  if (entry.collectionConfirmedAt) normalized.collectionConfirmedAt = normalizeQueueTimestamp(entry.collectionConfirmedAt);
  if (entry.packEventConfirmedAt) normalized.packEventConfirmedAt = normalizeQueueTimestamp(entry.packEventConfirmedAt);
  return { entry: normalized };
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

  const sanitizedByEvent = new Map();
  const reasons = [];
  let changed = false;

  for (const entry of entries) {
    const normalized = normalizePendingPackQueueEntry(entry);
    if (!normalized.entry) {
      changed = true;
      reasons.push(normalized.reason);
      continue;
    }
    const candidate = normalized.entry;
    const key = `${candidate.userId}:${candidate.id}`;
    const existing = sanitizedByEvent.get(key);
    if (existing) {
      changed = true;
      reasons.push("duplicate_client_event_id");
      const existingScore = existing.cards.length + Number(Boolean(existing.expectedPacksOpened));
      const candidateScore = candidate.cards.length + Number(Boolean(candidate.expectedPacksOpened));
      if (candidateScore > existingScore) sanitizedByEvent.set(key, candidate);
      continue;
    }
    sanitizedByEvent.set(key, candidate);
    if (entry.submissionVersion !== ATOMIC_PACK_SUBMISSION_VERSION || entry.id !== candidate.id) changed = true;
  }

  const sanitized = [...sanitizedByEvent.values()];

  return {
    entries: sanitized,
    changed,
    removed: entries.length - sanitized.length,
    reasons,
  };
}

export function isPendingPackRetryEligible(entry, now = Date.now()) {
  return !entry?.nextRetryAt || Number(entry.nextRetryAt) <= Number(now);
}

export function getPendingPackRetryDelayMs(attempts, {
  reason = "",
  random = Math.random,
} = {}) {
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
    ...details,
  });
  return true;
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
  const retiredRpc = rpcName === retiredPackRpcName();
  const explicitlyPermanent = error?.retryable === false;
  const explicitlyTransient = error?.retryable === true;
  const retiredResponse = retiredRpc && (
    code === "42501" ||
    code === "42883" ||
    code === "PACK_WRITE_PATH_RETIRED" ||
    status === 403 ||
    status === 404 ||
    status === 410 ||
    message.includes(`permission denied for function ${retiredPackRpcName()}`)
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
  let category = "permanent_validation";
  if (retiredResponse) reason = "retired_pack_rpc";
  else if (retryable) {
    reason = "transient_pack_submission_error";
    category = "transient";
  }
  else if (explicitlyPermanent) reason = String(error?.reason || reason);
  else if (code === "42501" || message.includes("permission denied")) {
    reason = "pack_submission_forbidden";
    category = "authentication";
  }
  else if (status === 401 || message.includes("authentication required")) {
    reason = "pack_submission_unauthenticated";
    category = "authentication";
  }
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
    category,
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
