import { supabase } from "./supabaseClient.js";
import { getCardCollectionKey, markCardsCollected } from "../utils/collectionStorage.js";
import { sets } from "../data/sets.js";
import { isCollectibleSetCard } from "../utils/energyCardPolicy.js";
import { getCachedSupabaseUser } from "./sessionUserCache.js";
import {
  ATOMIC_PACK_SUBMISSION_VERSION,
  PackSubmissionValidationError,
} from "./packSubmissionPolicy.js";
import {
  cancelCompletedPackQueueDrain,
  enqueueCompletedPackQueueEntry,
  getAcknowledgedCompletedPackOverlays,
  getCompletedPackQueueEntries,
  readCompletedPackQueue,
  reconcileAcknowledgedCompletedPackOverlays,
  scheduleCompletedPackQueueDrain,
  syncCompletedPackQueue,
} from "./completedPackQueue.js";
import { loadCloudCollectionPages } from "./cloudCollectionPagination.js";

export const PENDING_CLOUD_PULLS_KEY = "packdex-pending-cloud-pulls";
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

function assertValidSetId(setId, context = "cloud collection save") {
  if (typeof setId !== "string" || setId.trim() === "") {
    const receivedType = Array.isArray(setId) ? "array" : typeof setId;
    const error = new PackSubmissionValidationError(
      `PackDex ${context} requires a non-empty string set id.`,
      "invalid_set_id"
    );

    console.warn("Invalid PackDex cloud collection set id", {
      context,
      receivedType,
      receivedValue: setId,
    });

    throw error;
  }

  return setId.trim();
}

function getDefaultStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function loadPendingCloudPulls(storage = getDefaultStorage()) {
  return readCompletedPackQueue(PENDING_CLOUD_PULLS_KEY, storage);
}

function compactPendingCard(card) {
  return {
    ...card,
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
    console.warn("Unable to read Supabase user", error);
    return null;
  }
}

export async function loadCloudCollection() {
  const user = await getCurrentUser();

  if (!user) return {};

  const cloudRequestStartedAt = Date.now();
  const collection = {};

  try {
    await loadCloudCollectionPages(supabase, user.id, (rows) => {
      appendCloudRowsToCollection(collection, rows);
    });
  } catch (error) {
    console.warn("Unable to load cloud collection", error);
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

export function enqueuePendingCloudPull(cards, setId, userId, clientEventId = "", { storage = getDefaultStorage() } = {}) {
  const validSetId = assertValidSetId(setId, "pending cloud pull queue");
  const set = findSet(validSetId);
  const collectibleCards = Array.isArray(cards)
    ? cards.filter((card) => isCollectibleSetCard(card, set || { id: validSetId }))
    : [];
  const eventId = typeof clientEventId === "string" ? clientEventId.trim() : "";

  if (!userId || collectibleCards.length === 0) {
    return [];
  }

  if (!eventId) throw new PackSubmissionValidationError(
    "PackDex completed-pack enqueue requires the stable event id created with the pack.",
    "invalid_client_event_id"
  );

  return enqueueCompletedPackQueueEntry(PENDING_CLOUD_PULLS_KEY, {
    id: eventId,
    userId: String(userId),
    setId: validSetId,
    cards: collectibleCards.map(compactPendingCard),
    createdAt: Date.now(),
    attempts: 0,
    nextRetryAt: null,
    state: "pending",
    source: "desktop",
    submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
  }, storage);
}

export function getPendingCloudPullCount(userId, storage = getDefaultStorage()) {
  if (!userId) return 0;

  return getCompletedPackQueueEntries(PENDING_CLOUD_PULLS_KEY, userId, storage).length;
}

export function mergePendingCloudPullsIntoCollection(collection, userId, storage = getDefaultStorage()) {
  if (!userId) return collection || {};

  const overlayPulls = [
    ...loadPendingCloudPulls(storage).filter((pull) => !pull.collectionConfirmedAt),
    ...getAcknowledgedCompletedPackOverlays(PENDING_CLOUD_PULLS_KEY, userId, storage),
  ];
  const pendingCollection = overlayPulls
    .filter((pull) => pull.userId === userId && typeof pull.setId === "string" && Array.isArray(pull.cards))
    .reduce((nextCollection, pull) => {
      const set = findSet(pull.setId);

      if (!set) {
        console.warn("Skipping pending cloud pull for unknown set id", {
          setId: pull.setId,
          cardCount: pull.cards.length,
        });
        return nextCollection;
      }

      return markCardsCollected(nextCollection, pull.cards, pull.setId, pull.createdAt || Date.now());
    }, {});

  return mergeCollectionCounts(collection, pendingCollection);
}

export function syncPendingCloudPulls(userId, options = {}) {
  const client = options.client || supabase;
  const storage = options.storage || getDefaultStorage();
  const validateUser = options.validateUser ?? client === supabase;
  const requestTimeoutMs = options.requestTimeoutMs ?? CLOUD_SYNC_REQUEST_TIMEOUT_MS;
  const run = () => syncCompletedPackQueue({
    storageKey: PENDING_CLOUD_PULLS_KEY,
    userId,
    client,
    storage,
    makeBatch: makeCollectionBatch,
    validateCurrentUser: validateUser ? () => getCurrentUser(client, { force: true }) : null,
    requestTimeoutMs,
    now: options.now || Date.now,
    random: options.random || Math.random,
    source: "desktop",
  });
  return run().then((result) => {
    if (client === supabase && storage === getDefaultStorage() && result.failed > 0) {
      const nextRetryAt = Math.min(...getCompletedPackQueueEntries(PENDING_CLOUD_PULLS_KEY, userId, storage)
        .map((entry) => Number(entry.nextRetryAt || Infinity)));
      if (Number.isFinite(nextRetryAt)) {
        scheduleCompletedPackQueueDrain(PENDING_CLOUD_PULLS_KEY, userId, () => run().catch(() => {}), nextRetryAt);
      }
    }
    return result;
  }).catch((error) => {
    if (error?.packSyncCategory !== "authentication" && client === supabase && storage === getDefaultStorage()) {
      const nextRetryAt = Math.min(...getCompletedPackQueueEntries(PENDING_CLOUD_PULLS_KEY, userId, storage)
        .map((entry) => Number(entry.nextRetryAt || Infinity)));
      if (Number.isFinite(nextRetryAt)) {
        scheduleCompletedPackQueueDrain(PENDING_CLOUD_PULLS_KEY, userId, () => run().catch(() => {}), nextRetryAt);
      }
    }
    throw error;
  });
}

export function cancelPendingCloudPullSync(userId) {
  cancelCompletedPackQueueDrain(PENDING_CLOUD_PULLS_KEY, userId);
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
    console.warn("Unable to save PackDex cloud pull for unknown set id", {
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

  if (!clientEventId || typeof clientEventId !== "string") {
    throw new PackSubmissionValidationError("PackDex cloud pull save requires a stable client event id.");
  }
  const grouped = new Map();

  for (const card of collectibleCards) {
    const row = compactCardRow(card, validSetId, 1);
    const existing = grouped.get(row.card_id);

    grouped.set(row.card_id, {
      ...row,
      quantity: (existing?.quantity || 0) + 1,
    });
  }

  return { client_event_id: clientEventId, cards: [...grouped.values()] };
}

export async function savePulledCardsToCloud(cards, setId, {
  userId = "",
  clientEventId = "",
  client = supabase,
  storage = getDefaultStorage(),
  validateUser = client === supabase,
  requestTimeoutMs = CLOUD_SYNC_REQUEST_TIMEOUT_MS,
} = {}) {
  if (!client || !userId || !Array.isArray(cards) || cards.length === 0) {
    return { rows: [], stats: null, recorded: false };
  }
  enqueuePendingCloudPull(cards, setId, userId, clientEventId, { storage });
  const result = await syncPendingCloudPulls(userId, { client, storage, validateUser, requestTimeoutMs });
  const rejection = result.rejections?.find(
    (entry) => String(entry.clientEventId) === String(clientEventId)
  );
  if (rejection && !rejection.permanent) throw new PackRateLimitError(rejection.reason);
  if (result.failed > 0) {
    throw new Error("PackDex completed-pack submission failed transiently; the pack remains queued.");
  }
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
