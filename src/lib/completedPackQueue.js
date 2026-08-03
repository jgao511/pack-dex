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
  validatePackSubmissionAcknowledgement,
} from "./packSubmissionPolicy.js";
import { COMPLETED_PACK_QUEUE_SCHEMA_VERSION } from "./packPersistenceVersion.js";

const inFlightDrains = new Map();
const retryTimers = new Map();
const cancellationVersions = new Map();
const LEASE_DURATION_MS = 30_000;

function emptyResult() {
  return { attempted: 0, saved: 0, rejected: 0, failed: 0, deferred: 0, stats: null, rejections: [] };
}

function queueKey(storageKey, userId) {
  return `${storageKey}:${String(userId || "")}`;
}

function quarantineKey(storageKey) {
  return `${storageKey}:quarantine:v1`;
}

function acknowledgedOverlayKey(storageKey) {
  return `${storageKey}:acknowledged-overlay:v1`;
}

function leaseKey(storageKey, userId) {
  return `${storageKey}:drain-lease:${String(userId || "")}`;
}

function readJsonArray(storage, key) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(storage, key, values) {
  storage?.setItem?.(key, JSON.stringify(Array.isArray(values) ? values : []));
}

function appendQuarantine(storageKey, quarantined, storage, now = Date.now()) {
  if (!storage || !Array.isArray(quarantined) || quarantined.length === 0) return;
  const key = quarantineKey(storageKey);
  const current = readJsonArray(storage, key);
  const additions = quarantined.map((item) => ({
    queueSchemaVersion: COMPLETED_PACK_QUEUE_SCHEMA_VERSION,
    reason: String(item?.reason || "unknown_quarantine_reason").slice(0, 100),
    quarantinedAt: Number(now),
    entry: item?.entry,
  }));
  writeJsonArray(storage, key, [...current, ...additions]);
}

function notifyQueueChanged(storageKey, userId, state) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel("packdex-completed-pack-queue");
    channel.postMessage({ storageKey, userId: String(userId || ""), state: String(state || "changed") });
    channel.close();
  } catch {
    // Storage remains authoritative when cross-context notifications are unavailable.
  }
}

export function getCompletedPackQuarantineEntries(storageKey, storage) {
  return readJsonArray(storage, quarantineKey(storageKey));
}

export function readCompletedPackQueue(storageKey, storage) {
  if (!storage) return [];
  const rawValue = storage.getItem(storageKey);
  if (!rawValue) return [];

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    appendQuarantine(storageKey, [{ entry: { rawValue }, reason: "invalid_queue_json" }], storage);
    writeJsonArray(storage, storageKey, []);
    logPackSubmissionDiagnostic({
      operation: "quarantine_pending_pack_queue",
      reason: "invalid_queue_json",
      details: { quarantinedCount: 1 },
      level: "info",
    });
    return [];
  }

  const sanitized = sanitizePendingPackQueueEntries(parsed);
  if (sanitized.quarantined.length > 0) {
    appendQuarantine(storageKey, sanitized.quarantined, storage);
  }
  if (sanitized.changed) writeJsonArray(storage, storageKey, sanitized.entries);
  for (const reason of new Set(sanitized.reasons)) {
    logPackSubmissionDiagnostic({
      operation: "migrate_or_quarantine_pending_pack_queue",
      reason,
      details: { quarantinedCount: sanitized.quarantined.filter((item) => item.reason === reason).length },
      level: "info",
    });
  }
  return sanitized.entries;
}

export function writeCompletedPackQueue(storageKey, entries, storage) {
  if (!storage) return;
  writeJsonArray(storage, storageKey, entries);
}

export function getCompletedPackQueueEntries(storageKey, userId, storage) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId) return [];
  return readCompletedPackQueue(storageKey, storage).filter(
    (entry) => String(entry.userId || "") === normalizedUserId
  );
}

export function getAcknowledgedCompletedPackOverlays(storageKey, userId, storage) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId) return [];
  return readJsonArray(storage, acknowledgedOverlayKey(storageKey)).filter(
    (entry) => String(entry.userId || "") === normalizedUserId
  );
}

export function reconcileAcknowledgedCompletedPackOverlays(
  storageKey,
  userId,
  cloudRequestStartedAt,
  storage,
  isOverlayCardPresent = null
) {
  const normalizedUserId = String(userId || "");
  const requestStartedAt = Number(cloudRequestStartedAt || 0);
  if (
    !storage ||
    !normalizedUserId ||
    !requestStartedAt ||
    typeof isOverlayCardPresent !== "function"
  ) return 0;
  const key = acknowledgedOverlayKey(storageKey);
  const current = readJsonArray(storage, key);
  const next = current.filter((entry) => !(
    String(entry.userId || "") === normalizedUserId &&
    Number(entry.acknowledgedAt || 0) <= requestStartedAt &&
    Array.isArray(entry.cards) &&
    entry.cards.length > 0 &&
    entry.cards.every((card) => isOverlayCardPresent(entry.setId, card))
  ));
  if (next.length !== current.length) writeJsonArray(storage, key, next);
  return current.length - next.length;
}

export function enqueueCompletedPackQueueEntry(storageKey, entry, storage) {
  if (!storage) return [];
  const current = readCompletedPackQueue(storageKey, storage);
  const combined = sanitizePendingPackQueueEntries([...current, entry]);
  appendQuarantine(storageKey, combined.quarantined, storage);
  writeCompletedPackQueue(storageKey, combined.entries, storage);
  notifyQueueChanged(storageKey, entry?.userId, "pending");
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

function removeQueueEntry(storageKey, userId, eventId, storage, { reason = "" } = {}) {
  if (reason !== "acknowledged" && reason !== "quarantined") {
    throw new Error("A completed-pack queue entry requires an auditable removal reason.");
  }
  const current = readCompletedPackQueue(storageKey, storage);
  const next = current.filter((entry) => !(
    String(entry.userId) === String(userId) && String(entry.id) === String(eventId)
  ));
  if (next.length !== current.length) writeCompletedPackQueue(storageKey, next, storage);
  return current.length - next.length;
}

function quarantineQueueEntry(storageKey, userId, eventId, storage, reason, now = Date.now()) {
  const entry = readCompletedPackQueue(storageKey, storage).find((candidate) => (
    String(candidate.userId) === String(userId) && String(candidate.id) === String(eventId)
  ));
  if (!entry) return 0;
  appendQuarantine(storageKey, [{ entry: { ...entry, state: "quarantined" }, reason }], storage, now);
  const removed = removeQueueEntry(storageKey, userId, eventId, storage, { reason: "quarantined" });
  if (removed) notifyQueueChanged(storageKey, userId, "quarantined");
  return removed;
}

function acknowledgeQueueEntry(storageKey, userId, eventId, storage, acknowledgement, now = Date.now()) {
  const entry = readCompletedPackQueue(storageKey, storage).find((candidate) => (
    String(candidate.userId) === String(userId) && String(candidate.id) === String(eventId)
  ));
  if (!entry) return 0;
  const overlayKey = acknowledgedOverlayKey(storageKey);
  const overlays = readJsonArray(storage, overlayKey).filter((candidate) => !(
    String(candidate.userId) === String(userId) && String(candidate.id) === String(eventId)
  ));
  overlays.push({
    ...entry,
    state: "acknowledged",
    acknowledgedAt: Number(now),
    acknowledgement: acknowledgement.alreadyProcessed ? "already_processed" : "recorded",
  });
  writeJsonArray(storage, overlayKey, overlays);
  const removed = removeQueueEntry(storageKey, userId, eventId, storage, { reason: "acknowledged" });
  if (removed) notifyQueueChanged(storageKey, userId, "acknowledged");
  return removed;
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
    error.retryable = true;
    error.authFailure = true;
    throw error;
  }
}

async function refreshSubmissionSession(client, userId, validateCurrentUser) {
  if (typeof client?.auth?.refreshSession !== "function") return false;
  const { data, error } = await client.auth.refreshSession();
  if (error || !data?.session) return false;
  await assertCurrentUser(userId, validateCurrentUser);
  return true;
}

function makeMalformedAcknowledgementError(reason) {
  const error = new Error(`PackDex received an invalid completed-pack acknowledgement (${reason}).`);
  error.code = "PACK_INVALID_ACKNOWLEDGEMENT";
  error.retryable = true;
  error.acknowledgementReason = reason;
  return error;
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
  source = "unknown",
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
      continue;
    }

    let batches = [];
    try {
      if (!isPackQueueEntryVersionCompatible(liveEntry)) {
        throw new PackSubmissionValidationError("Unsupported pending-pack queue version.", "client_version_mismatch");
      }
      await assertCurrentUser(normalizedUserId, validateCurrentUser);
      batches = [makeBatch(liveEntry.cards, liveEntry.setId, liveEntry.id)];
      const payload = makeAtomicPackRpcPayload(batches, { source });
      updateQueueEntry(storageKey, normalizedUserId, liveEntry.id, (entry) => ({
        ...entry,
        state: "submitting",
        lastSubmissionAt: Number(now()),
      }), storage);

      let refreshedSession = false;
      let rpcResult;
      while (true) {
        result.attempted += 1;
        rpcResult = await callRpcWithTimeout(client, payload, requestTimeoutMs);
        if (!rpcResult?.error) break;
        const rpcClassification = classifyPackSubmissionError(rpcResult.error);
        if (rpcClassification.category === "authentication" && !refreshedSession) {
          refreshedSession = await refreshSubmissionSession(client, normalizedUserId, validateCurrentUser);
          if (refreshedSession) continue;
        }
        throw rpcResult.error;
      }

      await assertCurrentUser(normalizedUserId, validateCurrentUser);
      const acknowledgement = validatePackSubmissionAcknowledgement(rpcResult?.data, liveEntry.id);
      if (!acknowledgement.valid) {
        logPackSubmissionDiagnostic({
          operation: "invalid_pack_acknowledgement",
          reason: acknowledgement.reason,
          details: {
            ...getSafeCompletedPackPayloadShape(batches, { source, userOwnershipMatch: true }),
            queueState: liveEntry.state,
            retryCount: liveEntry.attempts,
          },
        });
        throw makeMalformedAcknowledgementError(acknowledgement.reason);
      }
      result.stats = acknowledgement.stats || result.stats;

      if (!acknowledgement.accepted) {
        const reason = acknowledgement.rejectionCode || "pack_submission_rejected";
        if (acknowledgement.permanentRejection) {
          quarantineQueueEntry(storageKey, normalizedUserId, liveEntry.id, storage, reason, now());
          result.rejected += 1;
          result.rejections.push({ clientEventId: liveEntry.id, reason, permanent: true });
          continue;
        }
        updateQueueEntry(storageKey, normalizedUserId, liveEntry.id, (entry) => (
          reschedulePendingPackEntry(entry, { reason, code: reason, now: now(), random })
        ), storage);
        result.rejected += 1;
        result.failed += 1;
        result.rejections.push({ clientEventId: liveEntry.id, reason, permanent: false });
        break;
      }

      result.saved += acknowledgeQueueEntry(
        storageKey,
        normalizedUserId,
        liveEntry.id,
        storage,
        acknowledgement,
        now()
      );
      logPackSubmissionDiagnostic({
        operation: "acknowledge_pending_pack",
        reason: acknowledgement.alreadyProcessed ? "already_processed" : "recorded",
        details: {
          ...getSafeCompletedPackPayloadShape(batches, { source, userOwnershipMatch: true }),
          queueState: "acknowledged",
          retryCount: liveEntry.attempts,
        },
        level: "info",
      });
    } catch (error) {
      const classification = error?.authFailure
        ? { category: "authentication", retryable: true, permanent: false, code: error.code, reason: "sync_user_changed" }
        : classifyPackSubmissionError(error);
      if (classification.permanent) {
        quarantineQueueEntry(storageKey, normalizedUserId, liveEntry.id, storage, classification.reason, now());
        result.rejected += 1;
        result.rejections.push({ clientEventId: liveEntry.id, reason: classification.reason, permanent: true });
        logPackSubmissionDiagnostic({
          operation: "quarantine_pending_pack",
          code: classification.code,
          reason: classification.reason,
          details: {
            ...getSafeCompletedPackPayloadShape(batches, { source, userOwnershipMatch: true }),
            queueState: "quarantined",
            retryCount: liveEntry.attempts,
          },
        });
        continue;
      }

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
        details: {
          ...getSafeCompletedPackPayloadShape(batches, {
            source,
            userOwnershipMatch: classification.reason !== "sync_user_changed",
          }),
          queueState: "waiting_retry",
          retryCount: liveEntry.attempts + 1,
        },
      });
      error.packSyncCategory = classification.category;
      throw error;
    }
  }

  result.failed = getCompletedPackQueueEntries(storageKey, normalizedUserId, storage).length;
  return result;
}

function makeLeaseOwner() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function withStorageLease(storageKey, userId, storage, callback) {
  if (!storage?.getItem || !storage?.setItem) return callback();
  const key = leaseKey(storageKey, userId);
  const leaseOwner = makeLeaseOwner();
  const now = Date.now();
  try {
    const existing = JSON.parse(storage.getItem(key) || "null");
    if (existing?.expiresAt > now && existing?.owner) return { ...emptyResult(), deferred: 1 };
  } catch {
    // Replace malformed lease metadata; it never contains completed-pack data.
  }
  storage.setItem(key, JSON.stringify({ owner: leaseOwner, expiresAt: now + LEASE_DURATION_MS }));
  try {
    const acquired = JSON.parse(storage.getItem(key) || "null");
    if (acquired?.owner !== leaseOwner) return { ...emptyResult(), deferred: 1 };
    return await callback();
  } finally {
    try {
      const current = JSON.parse(storage.getItem(key) || "null");
      if (current?.owner === leaseOwner) storage.removeItem?.(key);
    } catch {
      // A future attempt can replace malformed lease metadata after expiry.
    }
  }
}

async function withCrossContextLock(lockName, storageKey, userId, storage, callback) {
  const locks = typeof navigator === "undefined" ? null : navigator.locks;
  if (locks?.request) return locks.request(lockName, { mode: "exclusive" }, callback);
  return withStorageLease(storageKey, userId, storage, callback);
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
  if (getCompletedPackQueueEntries(storageKey, normalizedUserId, options.storage).length === 0) {
    return Promise.resolve(emptyResult());
  }
  const key = queueKey(storageKey, normalizedUserId);
  const existing = inFlightDrains.get(key);
  if (existing) return existing;
  const cancellationVersion = cancellationVersions.get(key) || 0;
  const lockName = `packdex-completed-pack-sync:${normalizedUserId}`;
  const promise = withCrossContextLock(
    lockName,
    storageKey,
    normalizedUserId,
    options.storage,
    () => drainQueue({ ...options, userId: normalizedUserId, cancellationVersion })
  ).finally(() => {
    if (inFlightDrains.get(key) === promise) inFlightDrains.delete(key);
  });
  inFlightDrains.set(key, promise);
  return promise;
}
