import { supabase } from "./supabaseClient.js";
import { getCardCollectionKey, markCardsCollected } from "../../../src/utils/collectionStorage.js";
import { sets } from "../../../src/data/sets.js";
import { isCollectibleSetCard } from "../../../src/utils/energyCardPolicy.js";
import { countDevRequest } from "../utils/requestDiagnostics.js";
import { getCachedSupabaseUser } from "../../../src/lib/sessionUserCache.js";
import {
  ATOMIC_PACK_SUBMISSION_VERSION,
  PackSubmissionValidationError,
} from "../../../src/lib/packSubmissionPolicy.js";
import {
  cancelCompletedPackQueueDrain,
  enqueueCompletedPackQueueEntry,
  getAcknowledgedCompletedPackOverlays,
  getCompletedPackQueueEntries,
  readCompletedPackQueue,
  reconcileAcknowledgedCompletedPackOverlays,
  scheduleCompletedPackQueueDrain,
  syncCompletedPackQueue,
} from "../../../src/lib/completedPackQueue.js";
import { scheduleAchievementCheck } from "../../../src/lib/achievementCheckScheduler.js";
import { loadCloudCollectionPages } from "../../../src/lib/cloudCollectionPagination.js";

export const PENDING_CLOUD_PULLS_KEY = "packdex-mobile-pending-cloud-pulls";
const CLOUD_SYNC_REQUEST_TIMEOUT_MS = 15_000;

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
  return readCompletedPackQueue(PENDING_CLOUD_PULLS_KEY, storage);
}

export function getPendingCloudPulls(userId, storage = getDefaultStorage()) {
  const normalizedUserId = String(userId || "");

  if (!normalizedUserId) return [];

  return getCompletedPackQueueEntries(PENDING_CLOUD_PULLS_KEY, normalizedUserId, storage);
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

export async function getCurrentUser(client = supabase, { force = false } = {}) {
  if (!client) return null;
  try {
    return await getCachedSupabaseUser(client, { force });
  } catch (error) {
    console.warn("Unable to read mobile Supabase user", error);
    return null;
  }
}

export async function loadCloudCollection() {
  countDevRequest("loadCloudCollection");
  const user = await getCurrentUser();

  if (!user) return {};

  const cloudRequestStartedAt = Date.now();
  const collection = {};

  try {
    await loadCloudCollectionPages(supabase, user.id, (rows) => {
      appendCloudRowsToCollection(collection, rows);
    });
  } catch (error) {
    console.warn("Unable to load mobile cloud collection", error);
    throw error;
  }


  reconcileAcknowledgedCompletedPackOverlays(
    PENDING_CLOUD_PULLS_KEY,
    user.id,
    cloudRequestStartedAt,
    getDefaultStorage()
  );

  return collection;
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
  const set = findSet(validSetId);
  const collectibleCards = Array.isArray(cards)
    ? cards.filter((card) => isCollectibleSetCard(card, set || { id: validSetId }))
    : [];
  const normalizedUserId = String(userId || "");
  const eventId = assertStableClientEventId(clientEventId);

  if (!normalizedUserId || collectibleCards.length === 0) {
    return [];
  }

  return enqueueCompletedPackQueueEntry(PENDING_CLOUD_PULLS_KEY, {
    id: eventId,
    userId: normalizedUserId,
    setId: validSetId,
    cards: collectibleCards.map(compactPendingCard),
    createdAt,
    expectedPacksOpened:
      expectedPacksOpened !== null && expectedPacksOpened !== "" && Number.isFinite(Number(expectedPacksOpened))
        ? Number(expectedPacksOpened)
        : null,
    attempts: 0,
    nextRetryAt: null,
    state: "pending",
    source: "mobile",
    submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
  }, storage);
}

export function mergePendingCloudPullsIntoCollection(
  collection,
  userId,
  storage = getDefaultStorage()
) {
  if (!userId) return collection || {};

  const overlayPulls = [
    ...getPendingCloudPulls(userId, storage).filter((pull) => !pull.collectionConfirmedAt),
    ...getAcknowledgedCompletedPackOverlays(PENDING_CLOUD_PULLS_KEY, userId, storage),
  ];
  const pendingCollection = overlayPulls
    .filter(
      (pull) =>
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

  const collectibleCards = cards.filter((card) => isCollectibleSetCard(card, set));
  if (collectibleCards.length === 0) {
    throw new PackSubmissionValidationError(
      "PackDex cloud pull save did not contain collectible set cards.",
      "empty_completed_pack"
    );
  }

  const eventId = assertStableClientEventId(clientEventId);
  const grouped = new Map();

  for (const card of collectibleCards) {
    const row = compactCardRow(card, validSetId, 1);
    const existing = grouped.get(row.card_id);

    grouped.set(row.card_id, {
      ...row,
      quantity: (existing?.quantity || 0) + 1,
    });
  }

  return { client_event_id: eventId, cards: [...grouped.values()] };
}

export function syncPendingCloudPulls(userId, options = {}) {
  const normalizedUserId = String(userId || "");
  const client = options.client || supabase;
  const storage = options.storage || getDefaultStorage();
  const validateUser = options.validateUser ?? client === supabase;
  const run = () => syncCompletedPackQueue({
    storageKey: PENDING_CLOUD_PULLS_KEY,
    userId: normalizedUserId,
    client,
    storage,
    makeBatch: makeCollectionBatch,
    validateCurrentUser: validateUser ? () => getCurrentUser(client, { force: true }) : null,
    requestTimeoutMs: options.requestTimeoutMs ?? CLOUD_SYNC_REQUEST_TIMEOUT_MS,
    now: options.now || Date.now,
    random: options.random || Math.random,
    source: "mobile",
  });
  const scheduleRetry = () => {
    if (client !== supabase || storage !== getDefaultStorage()) return;
    const nextRetryAt = Math.min(...getPendingCloudPulls(normalizedUserId, storage)
      .map((entry) => Number(entry.nextRetryAt || Infinity)));
    if (Number.isFinite(nextRetryAt)) {
      scheduleCompletedPackQueueDrain(PENDING_CLOUD_PULLS_KEY, normalizedUserId, () => run().catch(() => {}), nextRetryAt);
    }
  };
  return run().then((result) => {
    if (result.failed > 0) scheduleRetry();
    if (result.saved > 0 && result.stats) {
      scheduleAchievementCheck({
        userId: normalizedUserId,
        progression: result.stats,
        reason: result.saved > 1 ? "completed_pack_queue_batch" : "completed_pack_save",
        client,
        ...(options.achievementSchedulerOptions || {}),
      }).catch((error) => {
        console.warn("PackDex achievement check remains eligible after durable queue sync", {
          userId: normalizedUserId,
          savedPackCount: result.saved,
          error,
        });
      });
    }
    return result;
  }).catch((error) => {
    if (error?.packSyncCategory !== "authentication") scheduleRetry();
    throw error;
  });
}

export function cancelPendingCloudPullSync(userId) {
  cancelCompletedPackQueueDrain(PENDING_CLOUD_PULLS_KEY, userId);
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

export function appendCloudRowsToCollection(collection, rows) {
  const nextCollection = collection && typeof collection === "object" ? collection : {};

  for (const row of rows || []) {
    const setId = String(row.set_id || "");
    const cardId = String(row.card_id || "");

    if (!setId || !cardId) continue;

    const setCollection = nextCollection[setId] || (nextCollection[setId] = {});
    const createdAt = row.created_at ? Date.parse(row.created_at) : Date.now();
    const updatedAt = row.updated_at ? Date.parse(row.updated_at) : createdAt;

    setCollection[cardId] = {
      count: Number(row.quantity || 0),
      firstCollectedAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      lastCollectedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
  }

  return nextCollection;
}

export function cloudRowsToCollection(rows) {
  return appendCloudRowsToCollection({}, rows);
}
