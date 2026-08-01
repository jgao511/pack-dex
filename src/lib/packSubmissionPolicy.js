export const ATOMIC_PACK_RPC_NAME = "increment_collection_cards";
export const RETIRED_PACK_RPC_NAME = "record_pack_open_event";
export const ATOMIC_PACK_SUBMISSION_VERSION = 2;

const PERMANENT_ATOMIC_ERROR_CODES = new Set([
  "22023",
  "42501",
  "42883",
  "PGRST202",
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
  const operation = String(
    entry?.rpcName || entry?.rpc || entry?.operationName || entry?.operation || ""
  ).trim();
  return operation === RETIRED_PACK_RPC_NAME;
}

export function isPackQueueEntryVersionCompatible(entry) {
  const version = Number(entry?.submissionVersion || 0);
  return !Number.isFinite(version) || version <= ATOMIC_PACK_SUBMISSION_VERSION;
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
  const retiredResponse = retiredRpc && (
    code === "42501" ||
    code === "42883" ||
    code === "PACK_WRITE_PATH_RETIRED" ||
    status === 403 ||
    status === 404 ||
    status === 410 ||
    message.includes("permission denied for function record_pack_open_event")
  );
  const atomicProtocolFailure = rpcName === ATOMIC_PACK_RPC_NAME && (
    PERMANENT_ATOMIC_ERROR_CODES.has(code) ||
    message.includes("exactly one completed pack must be submitted") ||
    message.includes("invalid completed pack payload")
  );
  const permanent = explicitlyPermanent || retiredResponse || atomicProtocolFailure;

  return {
    permanent,
    retryable: !permanent,
    code,
    reason: retiredResponse
      ? "retired_pack_rpc"
      : atomicProtocolFailure
        ? "invalid_or_incompatible_atomic_pack"
        : explicitlyPermanent
          ? String(error?.reason || "permanent_pack_submission_error")
          : "transient_pack_submission_error",
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
