import { supabase } from "./supabaseClient.js";
import { getCardCollectionKey, markCardsCollected } from "../utils/collectionStorage.js";
import { sets } from "../data/sets.js";
import { getCachedSupabaseUser } from "./sessionUserCache.js";
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
} from "./packSubmissionPolicy.js";

const USER_COLLECTION_TABLE = "user_collection";
export const PENDING_CLOUD_PULLS_KEY = "packdex-pending-cloud-pulls";
let pendingSyncPromise = null;

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

function safeParsePendingPulls(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getDefaultStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function loadPendingCloudPulls(storage = getDefaultStorage()) {
  if (!storage) return [];

  return safeParsePendingPulls(storage.getItem(PENDING_CLOUD_PULLS_KEY));
}

function savePendingCloudPulls(pulls, storage = getDefaultStorage()) {
  if (!storage) return;

  storage.setItem(PENDING_CLOUD_PULLS_KEY, JSON.stringify(pulls));
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

export async function getCurrentUser() {
  if (!supabase) return null;

  try {
    return await getCachedSupabaseUser(supabase);
  } catch (error) {
    console.warn("Unable to read Supabase user", error);
    return null;
  }
}

export async function loadCloudCollection() {
  const user = await getCurrentUser();

  if (!user) return {};

  const { data, error } = await supabase
    .from(USER_COLLECTION_TABLE)
    .select("set_id,card_id,quantity,created_at,updated_at")
    .eq("user_id", user.id);

  if (error) {
    console.warn("Unable to load cloud collection", error);
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

export function enqueuePendingCloudPull(cards, setId, userId, clientEventId = "", { storage = getDefaultStorage() } = {}) {
  const validSetId = assertValidSetId(setId, "pending cloud pull queue");

  if (!userId || !Array.isArray(cards) || cards.length === 0) {
    return [];
  }

  const pendingPulls = loadPendingCloudPulls(storage);
  const eventId = clientEventId || `${userId}:${validSetId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const alreadyQueued = pendingPulls.some(
    (pull) => String(pull?.userId || "") === String(userId) && String(pull?.id || "") === eventId
  );
  if (alreadyQueued) return pendingPulls.filter((pull) => pull.userId === userId);

  const nextPendingPulls = [
    ...pendingPulls,
    {
      id: eventId,
      userId,
      setId: validSetId,
      cards: cards.map(compactPendingCard),
      createdAt: Date.now(),
      submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
    },
  ];

  savePendingCloudPulls(nextPendingPulls, storage);
  return nextPendingPulls.filter((pull) => pull.userId === userId);
}

export function getPendingCloudPullCount(userId, storage = getDefaultStorage()) {
  if (!userId) return 0;

  return loadPendingCloudPulls(storage).filter((pull) => pull.userId === userId).length;
}

export function mergePendingCloudPullsIntoCollection(collection, userId, storage = getDefaultStorage()) {
  if (!userId) return collection || {};

  const pendingCollection = loadPendingCloudPulls(storage)
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

async function performPendingCloudPullSync(userId, { client = supabase, storage = getDefaultStorage() } = {}) {
  if (!userId) return { attempted: 0, saved: 0, rejected: 0, failed: 0, stats: null, rejections: [] };

  if (!client || !storage) return { attempted: 0, saved: 0, rejected: 0, failed: 0, stats: null, rejections: [] };

  const pendingPulls = loadPendingCloudPulls(storage);
  const pullsForOtherUsers = pendingPulls.filter((pull) => pull.userId !== userId);
  const pullsForUser = pendingPulls.filter((pull) => pull.userId === userId);
  if (pullsForUser.length === 0) {
    return { attempted: 0, saved: 0, rejected: 0, failed: 0, stats: null, rejections: [] };
  }

  const failedPulls = [];
  const rejections = [];
  let latestStats = null;

  for (const pull of pullsForUser) {
    let batches = [];
    try {
      if (!isPackQueueEntryVersionCompatible(pull)) {
        throw new PackSubmissionValidationError(
          "The queued pack uses a newer submission version.",
          "client_version_mismatch"
        );
      }
      const batch = makeCollectionBatch(pull.cards, pull.setId, pull.id);
      batches = [batch];
      const payload = makeAtomicPackRpcPayload(batches);
      if (import.meta.env?.DEV) logCompletedPackPayloadShape(batches);
      const { data, error } = await client.rpc(ATOMIC_PACK_RPC_NAME, payload);
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("PackDex atomic pack RPC returned no result; the pack remains queued.");
      latestStats = row
        ? {
            packsOpened: Number(row.packs_opened || 0),
            totalCardsPulled: Number(row.total_cards_pulled || 0),
          }
        : latestStats;

      if (row?.accepted === false) {
        rejections.push({
          clientEventId: pull.id,
          reason: String(row.rejection_reason || "pack_rate_limit_one_second"),
        });
      }
    } catch (error) {
      const classification = classifyPackSubmissionError(error);
      if (classification.retryable) {
        failedPulls.push(pull);
        continue;
      }
      console.warn("Discarding permanent PackDex completed-pack queue entry", {
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
    }
  }

  savePendingCloudPulls([...pullsForOtherUsers, ...failedPulls], storage);

  return {
    attempted: pullsForUser.length,
    saved: pullsForUser.length - failedPulls.length - rejections.length,
    rejected: rejections.length,
    failed: failedPulls.length,
    stats: latestStats,
    rejections,
  };
}

export function syncPendingCloudPulls(userId, options = {}) {
  if (!userId) return Promise.resolve({ attempted: 0, saved: 0, failed: 0 });
  if (pendingSyncPromise) return pendingSyncPromise;
  pendingSyncPromise = performPendingCloudPullSync(userId, options)
    .finally(() => { pendingSyncPromise = null; });
  return pendingSyncPromise;
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

  if (!clientEventId || typeof clientEventId !== "string") {
    throw new PackSubmissionValidationError("PackDex cloud pull save requires a stable client event id.");
  }
  const grouped = new Map();

  for (const card of cards) {
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
} = {}) {
  if (!client || !userId || !Array.isArray(cards) || cards.length === 0) {
    return { rows: [], stats: null, recorded: false };
  }
  enqueuePendingCloudPull(cards, setId, userId, clientEventId, { storage });
  const result = await syncPendingCloudPulls(userId, { client, storage });
  const rejection = result.rejections?.find(
    (entry) => String(entry.clientEventId) === String(clientEventId)
  );
  if (rejection && !rejection.permanent) throw new PackRateLimitError(rejection.reason);
  if (result.failed > 0) {
    throw new Error("PackDex completed-pack submission failed transiently; the pack remains queued.");
  }
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
