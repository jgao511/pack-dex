import { supabase } from "./supabaseClient.js";
import { getCardCollectionKey, markCardsCollected } from "../../../src/utils/collectionStorage.js";
import { sets } from "../../../src/data/sets.js";
import { countDevRequest } from "../utils/requestDiagnostics.js";
import { getCachedSupabaseUser } from "../../../src/lib/sessionUserCache.js";
import {
  ATOMIC_PACK_RPC_NAME,
  ATOMIC_PACK_SUBMISSION_VERSION,
  PackSubmissionValidationError,
  classifyPackSubmissionError,
  getSafeCompletedPackPayloadShape,
  isLegacyPackQueueEntry,
  isPackQueueEntryVersionCompatible,
  logCompletedPackPayloadShape,
  makeAtomicPackRpcPayload,
  sanitizePendingPackQueueEntries,
} from "../../../src/lib/packSubmissionPolicy.js";

const USER_COLLECTION_TABLE = "user_collection";
export const PENDING_CLOUD_PULLS_KEY = "packdex-mobile-pending-cloud-pulls";
const CLOUD_SYNC_REQUEST_TIMEOUT_MS = 15_000;
const pendingSyncPromisesByUserId = new Map();

export const PACK_RATE_LIMIT_ERROR_CODE = "PACK_RATE_LIMITED";

export class PackRateLimitError extends Error {
  constructor(reason = "pack_rate_limit_one_second") {
    super("Pack submission was rate-limited. Please wait before opening another pack.");
    this.name = "PackRateLimitError";
    this.code = PACK_RATE_LIMIT_ERROR_CODE;
    this.reason = reason;
    this.retryable = false;
  }
}

export function isPackRateLimitError(error) {
  return error?.code === PACK_RATE_LIMIT_ERROR_CODE || error instanceof PackRateLimitError;
}

function findSet(setId) {
  return sets.find((set) => set.id === setId);
}

function assertValidSetId(setId, context = "mobile cloud collection save") {
  if (typeof setId !== "string" || setId.trim() === "") {
    const receivedType = Array.isArray(setId) ? "array" : typeof setId;
    const error = new PackSubmissionValidationError(
      `PackDex ${context} requires a non-empty string set id.`,
      "invalid_set_id"
    );

    console.warn("Invalid PackDex mobile cloud collection set id", {
      context,
      receivedType,
      receivedValue: setId,
    });

    throw error;
  }

  return setId.trim();
}

function assertStableClientEventId(clientEventId) {
  const eventId = typeof clientEventId === "string" ? clientEventId.trim() : "";

  if (!eventId) {
    throw new PackSubmissionValidationError(
      "PackDex cloud pull save requires a stable client event id.",
      "invalid_client_event_id"
    );
  }

  return eventId;
}

function getDefaultStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function loadPendingCloudPulls(storage = getDefaultStorage()) {
  if (!storage) return [];
  const rawValue = storage.getItem(PENDING_CLOUD_PULLS_KEY);
  if (!rawValue) return [];

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    storage.removeItem?.(PENDING_CLOUD_PULLS_KEY);
    return [];
  }

  const sanitized = sanitizePendingPackQueueEntries(parsed);
  if (sanitized.changed) {
    storage.setItem(PENDING_CLOUD_PULLS_KEY, JSON.stringify(sanitized.entries));
    if (sanitized.removed > 0) {
      console.info("Removed obsolete PackDex mobile completed-pack queue entries", {
        removed: sanitized.removed,
        reasons: [...new Set(sanitized.reasons)],
      });
    }
  }
  return sanitized.entries;
}

function savePendingCloudPulls(pulls, storage = getDefaultStorage()) {
  if (!storage) return;

  storage.setItem(PENDING_CLOUD_PULLS_KEY, JSON.stringify(pulls));
}

export function getPendingCloudPulls(userId, storage = getDefaultStorage()) {
  const normalizedUserId = String(userId || "");

  if (!normalizedUserId) return [];

  return loadPendingCloudPulls(storage).filter(
    (pull) => String(pull?.userId || "") === normalizedUserId
  );
}

export function getPendingCloudPullCount(userId, storage = getDefaultStorage()) {
  return getPendingCloudPulls(userId, storage).length;
}

function compactPendingCard(card) {
  return {
    id: card?.id,
    name: card?.name,
    number: card?.number,
    rarity: card?.rarity,
    rarityCategory: card?.rarityCategory,
    pullCategory: card?.pullCategory,
    image: card?.image,
    imagePath: card?.imagePath,
    imageFileName: card?.imageFileName,
    fileName: card?.fileName,
    filename: card?.filename,
    setFolder: card?.setFolder,
    setId: card?.setId,
  };
}

function mergeCollectionCounts(baseCollection, overlayCollection) {
  const merged = { ...(baseCollection || {}) };

  Object.entries(overlayCollection || {}).forEach(([setId, setCollection]) => {
    const currentSetCollection = merged[setId] || {};

    merged[setId] = { ...currentSetCollection };

    Object.entries(setCollection || {}).forEach(([cardId, entry]) => {
      const existing = currentSetCollection[cardId];

      merged[setId][cardId] = {
        count: Number(existing?.count || 0) + Number(entry?.count || 0),
        firstCollectedAt: Math.min(
          Number(existing?.firstCollectedAt || entry?.firstCollectedAt || Date.now()),
          Number(entry?.firstCollectedAt || existing?.firstCollectedAt || Date.now())
        ),
        lastCollectedAt: Math.max(
          Number(existing?.lastCollectedAt || entry?.lastCollectedAt || Date.now()),
          Number(entry?.lastCollectedAt || existing?.lastCollectedAt || Date.now())
        ),
      };
    });
  });

  return merged;
}

export async function getCurrentUser(client = supabase) {
  if (!client) return null;
  try {
    return await getCachedSupabaseUser(client);
  } catch (error) {
    console.warn("Unable to read mobile Supabase user", error);
    return null;
  }
}

export async function loadCloudCollection() {
  countDevRequest("loadCloudCollection");
  const user = await getCurrentUser();

  if (!user) return {};

  const { data, error } = await supabase
    .from(USER_COLLECTION_TABLE)
    .select("set_id,card_id,quantity,created_at,updated_at")
    .eq("user_id", user.id);

  if (error) {
    console.warn("Unable to load mobile cloud collection", error);
    throw error;
  }

  return cloudRowsToCollection(data || []);
}

function compactCardRow(card, setId, quantity = 1) {
  return {
    card_id: getCardCollectionKey(card, setId),
    set_id: setId,
    quantity,
  };
}

export function enqueuePendingCloudPull(
  cards,
  setId,
  userId,
  clientEventId,
  {
    storage = getDefaultStorage(),
    createdAt = Date.now(),
    expectedPacksOpened = null,
  } = {}
) {
  const validSetId = assertValidSetId(setId, "pending cloud pull queue");
  const normalizedUserId = String(userId || "");
  const eventId = assertStableClientEventId(clientEventId);

  if (!normalizedUserId || !Array.isArray(cards) || cards.length === 0) {
    return [];
  }

  const pendingPulls = loadPendingCloudPulls(storage);
  const alreadyQueued = pendingPulls.some(
    (pull) =>
      String(pull?.userId || "") === normalizedUserId &&
      String(pull?.id || "") === eventId
  );
  const nextPendingPulls = alreadyQueued
    ? pendingPulls
    : [
        ...pendingPulls,
        {
          id: eventId,
          userId: normalizedUserId,
          setId: validSetId,
          cards: cards.map(compactPendingCard),
          createdAt,
          expectedPacksOpened:
            expectedPacksOpened !== null &&
            expectedPacksOpened !== "" &&
            Number.isFinite(Number(expectedPacksOpened))
            ? Number(expectedPacksOpened)
            : null,
          collectionConfirmedAt: null,
          packEventConfirmedAt: null,
          submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
        },
      ];

  if (!alreadyQueued) savePendingCloudPulls(nextPendingPulls, storage);
  return nextPendingPulls.filter(
    (pull) => String(pull?.userId || "") === normalizedUserId
  );
}

export function mergePendingCloudPullsIntoCollection(
  collection,
  userId,
  storage = getDefaultStorage()
) {
  if (!userId) return collection || {};

  const pendingCollection = getPendingCloudPulls(userId, storage)
    .filter(
      (pull) =>
        !pull.collectionConfirmedAt &&
        typeof pull.setId === "string" &&
        Array.isArray(pull.cards)
    )
    .reduce((nextCollection, pull) => {
      const set = findSet(pull.setId);

      if (!set) {
        console.warn("Skipping pending mobile cloud pull for unknown set id", {
          setId: pull.setId,
          cardCount: pull.cards.length,
        });
        return nextCollection;
      }

      return markCardsCollected(
        nextCollection,
        pull.cards,
        pull.setId,
        pull.createdAt || Date.now()
      );
    }, {});

  return mergeCollectionCounts(collection, pendingCollection);
}

function makeCollectionBatch(cards, setId, clientEventId) {
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new PackSubmissionValidationError(
      "PackDex cloud pull save requires at least one card.",
      "empty_completed_pack"
    );
  }
  const validSetId = assertValidSetId(setId, "cloud pull save");
  const set = findSet(validSetId);

  if (!set) {
    console.warn("Unable to save PackDex mobile cloud pull for unknown set id", {
      setId: validSetId,
      cardCount: cards.length,
    });
    throw new PackSubmissionValidationError(`Unknown PackDex set id: ${validSetId}`, "unknown_set");
  }

  const eventId = assertStableClientEventId(clientEventId);
  const grouped = new Map();

  for (const card of cards) {
    const row = compactCardRow(card, validSetId, 1);
    const existing = grouped.get(row.card_id);

    grouped.set(row.card_id, {
      ...row,
      quantity: (existing?.quantity || 0) + 1,
    });
  }

  return { client_event_id: eventId, cards: [...grouped.values()] };
}

function updatePendingPullsForUser(userId, update, storage) {
  const normalizedUserId = String(userId || "");
  const current = loadPendingCloudPulls(storage);
  const next = current.map((pull) =>
    String(pull?.userId || "") === normalizedUserId ? update(pull) : pull
  );
  savePendingCloudPulls(next, storage);
  return next;
}

function markCollectionConfirmed(userId, confirmedIds, storage) {
  const confirmedAt = Date.now();

  updatePendingPullsForUser(
    userId,
    (pull) =>
      confirmedIds.has(String(pull?.id || ""))
        ? { ...pull, collectionConfirmedAt: pull.collectionConfirmedAt || confirmedAt }
        : pull,
    storage
  );
}

function markPackEventConfirmed(userId, eventId, storage) {
  const confirmedAt = Date.now();

  updatePendingPullsForUser(
    userId,
    (pull) =>
      String(pull?.id || "") === String(eventId)
        ? { ...pull, packEventConfirmedAt: pull.packEventConfirmedAt || confirmedAt }
        : pull,
    storage
  );
}

function removeFullyConfirmedPulls(userId, storage) {
  const normalizedUserId = String(userId || "");
  const current = loadPendingCloudPulls(storage);
  const removed = current.filter(
    (pull) =>
      String(pull?.userId || "") === normalizedUserId &&
      pull.collectionConfirmedAt &&
      pull.packEventConfirmedAt
  );
  const remaining = current.filter(
    (pull) =>
      String(pull?.userId || "") !== normalizedUserId ||
      !pull.collectionConfirmedAt ||
      !pull.packEventConfirmedAt
  );

  if (removed.length > 0) savePendingCloudPulls(remaining, storage);
  return removed;
}

function removePendingPullIds(userId, ids, storage) {
  if (ids.size === 0) return [];

  const normalizedUserId = String(userId || "");
  const current = loadPendingCloudPulls(storage);
  const removed = current.filter(
    (pull) =>
      String(pull?.userId || "") === normalizedUserId &&
      ids.has(String(pull?.id || ""))
  );
  const remaining = current.filter(
    (pull) =>
      String(pull?.userId || "") !== normalizedUserId ||
      !ids.has(String(pull?.id || ""))
  );

  if (removed.length > 0) savePendingCloudPulls(remaining, storage);
  return removed;
}

async function assertCurrentSyncUser(userId, client, validateUser) {
  if (!validateUser) return;

  const currentUser = await getCurrentUser(client);

  if (String(currentUser?.id || "") !== String(userId || "")) {
    const error = new Error("PackDex pending pull sync stopped because the signed-in user changed.");
    // Preserve this user's queue without submitting it under a different session.
    error.retryable = true;
    throw error;
  }
}

function normalizePackEventStats(data) {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) return null;

  return {
    packsOpened: Number(row.packsOpened || row.packs_opened || 0),
    totalCardsPulled: Number(row.totalCardsPulled || row.total_cards_pulled || 0),
  };
}

function normalizeSubmission(data, fallbackEventId) {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] || {};

  return {
    rows,
    clientEventId: String(row.client_event_id || fallbackEventId || ""),
    accepted: row.accepted !== false,
    rejectionReason: String(row.rejection_reason || ""),
    recorded: row.recorded === true,
    stats: normalizePackEventStats(row),
  };
}

async function callRpcWithTimeout(client, name, payload, timeoutMs) {
  if (!timeoutMs) return client.rpc(name, payload);

  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`PackDex ${name} request timed out; the pull remains queued.`);
      error.retryable = true;
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([client.rpc(name, payload), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function performPendingCloudPullSync(
  userId,
  {
    client = supabase,
    storage = getDefaultStorage(),
    validateUser = client === supabase,
    requestTimeoutMs = CLOUD_SYNC_REQUEST_TIMEOUT_MS,
  } = {}
) {
  const normalizedUserId = String(userId || "");

  if (!normalizedUserId || !client || !storage) {
    return { attempted: 0, saved: 0, rejected: 0, failed: 0, stats: null, rejections: [] };
  }

  // Old split-save builds could terminate after marking both halves locally but
  // before deleting the queue row. That row is already complete and must not be
  // submitted again; normal in-flight confirmation uses the same cleanup.
  removeFullyConfirmedPulls(normalizedUserId, storage);
  const initialPulls = getPendingCloudPulls(normalizedUserId, storage);
  if (initialPulls.length === 0) {
    return { attempted: 0, saved: 0, rejected: 0, failed: 0, stats: null, rejections: [] };
  }

  let latestStats = null;
  const rejections = [];
  let savedCount = 0;

  for (const pull of initialPulls) {
    let batches = [];
    try {
      if (!isPackQueueEntryVersionCompatible(pull)) {
        throw new PackSubmissionValidationError(
          "The queued pack uses a newer submission version.",
          "client_version_mismatch"
        );
      }
      await assertCurrentSyncUser(normalizedUserId, client, validateUser);
      const batch = makeCollectionBatch(pull.cards, pull.setId, pull.id);
      batches = [batch];
      const payload = makeAtomicPackRpcPayload(batches);
      if (import.meta.env?.DEV) logCompletedPackPayloadShape(batches);
      const { data, error } = await callRpcWithTimeout(
        client,
        ATOMIC_PACK_RPC_NAME,
        payload,
        requestTimeoutMs
      );

      if (error) throw error;

      const submission = normalizeSubmission(data, pull.id);
      if (submission.rows.length === 0) {
        throw new Error("PackDex atomic pack RPC returned no result; the pack remains queued.");
      }
      latestStats = submission.stats || latestStats;

      if (!submission.accepted) {
        const rejection = {
          clientEventId: pull.id,
          reason: submission.rejectionReason || "pack_rate_limit_one_second",
        };
        rejections.push(rejection);
        removePendingPullIds(normalizedUserId, new Set([pull.id]), storage);
        continue;
      }

      markCollectionConfirmed(normalizedUserId, new Set([pull.id]), storage);
      markPackEventConfirmed(normalizedUserId, pull.id, storage);
      savedCount += removeFullyConfirmedPulls(normalizedUserId, storage).length;
    } catch (error) {
      const classification = classifyPackSubmissionError(error);
      if (classification.retryable) throw error;
      console.warn("Discarding permanent PackDex mobile completed-pack queue entry", {
        reason: classification.reason,
        code: classification.code,
        migratedFromLegacyRpc: isLegacyPackQueueEntry(pull),
        ...getSafeCompletedPackPayloadShape(batches),
      });
      rejections.push({
        clientEventId: String(pull?.id || ""),
        reason: classification.reason,
        permanent: true,
      });
      removePendingPullIds(normalizedUserId, new Set([String(pull?.id || "")]), storage);
    }
  }

  savedCount += removeFullyConfirmedPulls(normalizedUserId, storage).length;
  const failed = getPendingCloudPullCount(normalizedUserId, storage);

  return {
    attempted: initialPulls.length,
    saved: savedCount,
    rejected: rejections.length,
    failed,
    stats: latestStats,
    rejections,
  };
}

export function syncPendingCloudPulls(userId, options = {}) {
  const normalizedUserId = String(userId || "");

  if (!normalizedUserId) {
    return Promise.resolve({ attempted: 0, saved: 0, rejected: 0, failed: 0, stats: null, rejections: [] });
  }

  const existing = pendingSyncPromisesByUserId.get(normalizedUserId);
  if (existing) return existing;

  const promise = performPendingCloudPullSync(normalizedUserId, options)
    .catch((error) => {
      console.warn("Pending PackDex mobile cloud pull sync failed", {
        userId: normalizedUserId,
        error,
      });
      throw error;
    })
    .finally(() => {
      if (pendingSyncPromisesByUserId.get(normalizedUserId) === promise) {
        pendingSyncPromisesByUserId.delete(normalizedUserId);
      }
    });
  pendingSyncPromisesByUserId.set(normalizedUserId, promise);
  return promise;
}

export async function savePulledCardsToCloud(
  cards,
  setId,
  {
    userId = "",
    clientEventId = "",
    client = supabase,
    storage = getDefaultStorage(),
    validateUser = client === supabase,
    requestTimeoutMs = CLOUD_SYNC_REQUEST_TIMEOUT_MS,
  } = {}
) {
  if (!client || !userId || !Array.isArray(cards) || cards.length === 0) {
    return { attempted: 0, saved: 0, rejected: 0, failed: 0, stats: null, rejections: [] };
  }

  enqueuePendingCloudPull(cards, setId, userId, clientEventId, { storage });
  const result = await syncPendingCloudPulls(userId, {
    client,
    storage,
    validateUser,
    requestTimeoutMs,
  });

  const rejection = result.rejections?.find(
    (entry) => String(entry.clientEventId) === String(clientEventId)
  );
  if (rejection?.permanent) {
    throw new PackSubmissionValidationError(
      "PackDex rejected this completed-pack submission permanently.",
      rejection.reason
    );
  }
  if (rejection) throw new PackRateLimitError(rejection.reason);

  return result;
}

export function cloudRowsToCollection(rows) {
  return rows.reduce((collection, row) => {
    const setId = String(row.set_id || "");
    const cardId = String(row.card_id || "");

    if (!setId || !cardId) return collection;

    const setCollection = collection[setId] || {};
    const createdAt = row.created_at ? Date.parse(row.created_at) : Date.now();
    const updatedAt = row.updated_at ? Date.parse(row.updated_at) : createdAt;

    return {
      ...collection,
      [setId]: {
        ...setCollection,
        [cardId]: {
          count: Number(row.quantity || 0),
          firstCollectedAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
          lastCollectedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
        },
      },
    };
  }, {});
}
