import {
  ATOMIC_PACK_RPC_NAME,
  PackSubmissionValidationError,
  classifyPackSubmissionError,
  getSafeCompletedPackPayloadShape,
  isPackQueueEntryVersionCompatible,
  isPendingPackRetryEligible,
  logPackSubmissionDiagnostic,
  makeAtomicPackRpcPayload,
  reschedulePendingPackEntry,
  sanitizePendingPackQueueEntries,
} from "./packSubmissionPolicy.js";

const inFlightDrains = new Map();
const retryTimers = new Map();
const cancellationVersions = new Map();

function emptyResult() {
  return { attempted: 0, saved: 0, rejected: 0, failed: 0, deferred: 0, stats: null, rejections: [] };
}

function queueKey(storageKey, userId) {
  return `${storageKey}:${String(userId || "")}`;
}

export function readCompletedPackQueue(storageKey, storage) {
  if (!storage) return [];
  const rawValue = storage.getItem(storageKey);
  if (!rawValue) return [];

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    storage.removeItem?.(storageKey);
    logPackSubmissionDiagnostic({
      operation: "sanitize_pending_pack_queue",
      reason: "invalid_queue_json",
      details: { queueSchemaVersion: null, batchCount: 0, cardCount: 0, hasEventId: false, hasUserId: false },
      level: "info",
    });
    return [];
  }

  const sanitized = sanitizePendingPackQueueEntries(parsed);
  if (sanitized.changed) storage.setItem(storageKey, JSON.stringify(sanitized.entries));
  for (const reason of new Set(sanitized.reasons)) {
    logPackSubmissionDiagnostic({
      operation: "sanitize_pending_pack_queue",
      reason,
      details: {
        queueSchemaVersion: null,
        batchCount: 0,
        cardCount: 0,
        hasEventId: false,
        hasUserId: false,
        discardedCount: sanitized.removed,
      },
      level: "info",
    });
  }
  return sanitized.entries;
}

export function writeCompletedPackQueue(storageKey, entries, storage) {
  if (!storage) return;
  storage.setItem(storageKey, JSON.stringify(entries));
}

export function getCompletedPackQueueEntries(storageKey, userId, storage) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId) return [];
  return readCompletedPackQueue(storageKey, storage).filter(
    (entry) => String(entry.userId || "") === normalizedUserId
  );
}

export function enqueueCompletedPackQueueEntry(storageKey, entry, storage) {
  if (!storage) return [];
  const current = readCompletedPackQueue(storageKey, storage);
  const combined = sanitizePendingPackQueueEntries([...current, entry]);
  writeCompletedPackQueue(storageKey, combined.entries, storage);
  return combined.entries.filter((candidate) => candidate.userId === entry.userId);
}

function updateQueueEntry(storageKey, userId, eventId, update, storage) {
  const current = readCompletedPackQueue(storageKey, storage);
  const next = current.map((entry) => (
    String(entry.userId) === String(userId) && String(entry.id) === String(eventId)
      ? update(entry)
      : entry
  ));
  writeCompletedPackQueue(storageKey, next, storage);
  return next;
}

function removeQueueEntry(storageKey, userId, eventId, storage) {
  const current = readCompletedPackQueue(storageKey, storage);
  const next = current.filter((entry) => !(
    String(entry.userId) === String(userId) && String(entry.id) === String(eventId)
  ));
  if (next.length !== current.length) writeCompletedPackQueue(storageKey, next, storage);
  return current.length - next.length;
}

function normalizeStats(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    packsOpened: Number(row.packsOpened || row.packs_opened || 0),
    totalCardsPulled: Number(row.totalCardsPulled || row.total_cards_pulled || 0),
  };
}

function normalizeSubmission(data, eventId) {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] || {};
  return {
    rows,
    clientEventId: String(row.client_event_id || eventId || ""),
    accepted: row.accepted !== false,
    rejectionReason: String(row.rejection_reason || ""),
    recorded: row.recorded === true,
    stats: normalizeStats(row),
  };
}

async function callRpcWithTimeout(client, payload, timeoutMs) {
  if (!timeoutMs) return client.rpc(ATOMIC_PACK_RPC_NAME, payload);
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error("PackDex completed-pack request timed out; the pack remains queued.");
      error.retryable = true;
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([client.rpc(ATOMIC_PACK_RPC_NAME, payload), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function assertCurrentUser(userId, validateCurrentUser) {
  if (!validateCurrentUser) return;
  const currentUser = await validateCurrentUser();
  if (String(currentUser?.id || "") !== String(userId || "")) {
    const error = new Error("PackDex completed-pack synchronization stopped because the account changed.");
    error.code = "PACK_SYNC_USER_CHANGED";
    error.retryable = false;
    error.authFailure = true;
    throw error;
  }
}

function isRateLimitReason(reason) {
  return reason === "pack_rate_limit_one_second" || reason === "pack_rate_limit_sixty_seconds";
}

async function drainQueue({
  storageKey,
  userId,
  client,
  storage,
  makeBatch,
  validateCurrentUser,
  requestTimeoutMs,
  now = Date.now,
  random = Math.random,
  cancellationVersion,
}) {
  const result = emptyResult();
  const normalizedUserId = String(userId || "");
  const snapshot = getCompletedPackQueueEntries(storageKey, normalizedUserId, storage);
  if (!snapshot.length) return result;

  for (const snapshotEntry of snapshot) {
    if ((cancellationVersions.get(queueKey(storageKey, normalizedUserId)) || 0) !== cancellationVersion) break;
    const liveEntry = getCompletedPackQueueEntries(storageKey, normalizedUserId, storage)
      .find((entry) => entry.id === snapshotEntry.id);
    if (!liveEntry) continue;
    if (!isPendingPackRetryEligible(liveEntry, now())) {
      result.deferred += 1;
      break;
    }

    let batches = [];
    try {
      if (!isPackQueueEntryVersionCompatible(liveEntry)) {
        throw new PackSubmissionValidationError("Unsupported pending-pack queue version.", "client_version_mismatch");
      }
      await assertCurrentUser(normalizedUserId, validateCurrentUser);
      batches = [makeBatch(liveEntry.cards, liveEntry.setId, liveEntry.id)];
      const payload = makeAtomicPackRpcPayload(batches);
      result.attempted += 1;
      const { data, error } = await callRpcWithTimeout(client, payload, requestTimeoutMs);
      if (error) throw error;
      await assertCurrentUser(normalizedUserId, validateCurrentUser);

      const submission = normalizeSubmission(data, liveEntry.id);
      if (!submission.rows.length) {
        const error = new Error("PackDex completed-pack RPC returned no acknowledgement.");
        error.retryable = true;
        throw error;
      }
      result.stats = submission.stats || result.stats;
      if (!submission.accepted) {
        const reason = submission.rejectionReason || "pack_submission_rejected";
        if (isRateLimitReason(reason)) {
          updateQueueEntry(storageKey, normalizedUserId, liveEntry.id, (entry) => (
            reschedulePendingPackEntry(entry, { reason, code: "PACK_RATE_LIMITED", now: now(), random })
          ), storage);
          result.rejected += 1;
          result.failed += 1;
          result.rejections.push({ clientEventId: liveEntry.id, reason, permanent: false });
          break;
        }
        throw new PackSubmissionValidationError("The completed pack was rejected.", reason);
      }

      result.saved += removeQueueEntry(storageKey, normalizedUserId, liveEntry.id, storage);
    } catch (error) {
      const classification = error?.authFailure
        ? { category: "authentication", retryable: false, code: error.code, reason: "sync_user_changed" }
        : classifyPackSubmissionError(error);
      if (classification.retryable || classification.category === "authentication") {
        updateQueueEntry(storageKey, normalizedUserId, liveEntry.id, (entry) => (
          reschedulePendingPackEntry(entry, {
            reason: classification.reason,
            code: classification.code,
            now: now(),
            random,
          })
        ), storage);
        result.failed += 1;
        logPackSubmissionDiagnostic({
          operation: "drain_pending_pack_queue",
          code: classification.code,
          reason: classification.reason,
          details: getSafeCompletedPackPayloadShape(batches),
        });
        error.packSyncCategory = classification.category;
        throw error;
      }

      removeQueueEntry(storageKey, normalizedUserId, liveEntry.id, storage);
      result.rejected += 1;
      result.rejections.push({ clientEventId: liveEntry.id, reason: classification.reason, permanent: true });
      logPackSubmissionDiagnostic({
        operation: "discard_pending_pack",
        code: classification.code,
        reason: classification.reason,
        details: getSafeCompletedPackPayloadShape(batches),
      });
    }
  }

  result.failed = getCompletedPackQueueEntries(storageKey, normalizedUserId, storage).length;
  return result;
}

async function withBrowserLock(lockName, callback) {
  const locks = typeof navigator === "undefined" ? null : navigator.locks;
  if (!locks?.request) return callback();
  return locks.request(lockName, { mode: "exclusive" }, callback);
}

export function cancelCompletedPackQueueDrain(storageKey, userId) {
  const key = queueKey(storageKey, userId);
  cancellationVersions.set(key, (cancellationVersions.get(key) || 0) + 1);
  const timer = retryTimers.get(key);
  if (timer) clearTimeout(timer);
  retryTimers.delete(key);
}

export function scheduleCompletedPackQueueDrain(storageKey, userId, callback, nextRetryAt) {
  if (typeof window === "undefined") return;
  const key = queueKey(storageKey, userId);
  const existing = retryTimers.get(key);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, Number(nextRetryAt || 0) - Date.now());
  const timer = window.setTimeout(() => {
    retryTimers.delete(key);
    callback();
  }, Math.min(delay, 2_147_483_647));
  retryTimers.set(key, timer);
}

export function syncCompletedPackQueue(options) {
  const { storageKey, userId } = options;
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || !options.client || !options.storage) return Promise.resolve(emptyResult());
  const key = queueKey(storageKey, normalizedUserId);
  const existing = inFlightDrains.get(key);
  if (existing) return existing;
  const cancellationVersion = cancellationVersions.get(key) || 0;
  const lockName = `packdex-completed-pack-sync:${normalizedUserId}`;
  const promise = withBrowserLock(lockName, () => drainQueue({
    ...options,
    userId: normalizedUserId,
    cancellationVersion,
  })).finally(() => {
    if (inFlightDrains.get(key) === promise) inFlightDrains.delete(key);
  });
  inFlightDrains.set(key, promise);
  return promise;
}
