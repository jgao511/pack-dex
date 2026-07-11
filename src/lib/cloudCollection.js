import { supabase } from "./supabaseClient.js";
import { getCardCollectionKey, markCardsCollected } from "../utils/collectionStorage.js";
import { sets } from "../data/sets.js";
import { getCachedSupabaseUser } from "./sessionUserCache.js";

const USER_COLLECTION_TABLE = "user_collection";
const PENDING_CLOUD_PULLS_KEY = "packdex-pending-cloud-pulls";
let pendingSyncPromise = null;

function findSet(setId) {
  return sets.find((set) => set.id === setId);
}

function assertValidSetId(setId, context = "cloud collection save") {
  if (typeof setId !== "string" || setId.trim() === "") {
    const receivedType = Array.isArray(setId) ? "array" : typeof setId;
    const error = new TypeError(`PackDex ${context} requires a non-empty string set id.`);

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

function loadPendingCloudPulls() {
  if (typeof window === "undefined") return [];

  return safeParsePendingPulls(window.localStorage.getItem(PENDING_CLOUD_PULLS_KEY));
}

function savePendingCloudPulls(pulls) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(PENDING_CLOUD_PULLS_KEY, JSON.stringify(pulls));
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

export function enqueuePendingCloudPull(cards, setId, userId, clientEventId = "") {
  const validSetId = assertValidSetId(setId, "pending cloud pull queue");

  if (!userId || !Array.isArray(cards) || cards.length === 0) {
    return [];
  }

  const pendingPulls = loadPendingCloudPulls();
  const nextPendingPulls = [
    ...pendingPulls,
    {
      id: clientEventId || `${userId}:${validSetId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      userId,
      setId: validSetId,
      cards: cards.map(compactPendingCard),
      createdAt: Date.now(),
    },
  ];

  savePendingCloudPulls(nextPendingPulls);
  return nextPendingPulls.filter((pull) => pull.userId === userId);
}

export function getPendingCloudPullCount(userId) {
  if (!userId) return 0;

  return loadPendingCloudPulls().filter((pull) => pull.userId === userId).length;
}

export function mergePendingCloudPullsIntoCollection(collection, userId) {
  if (!userId) return collection || {};

  const pendingCollection = loadPendingCloudPulls()
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

async function performPendingCloudPullSync(userId) {
  if (!userId) return { attempted: 0, saved: 0, failed: 0 };

  const pendingPulls = loadPendingCloudPulls();
  const pullsForOtherUsers = pendingPulls.filter((pull) => pull.userId !== userId);
  const pullsForUser = pendingPulls.filter((pull) => pull.userId === userId);
  if (pullsForUser.length === 0) return { attempted: 0, saved: 0, failed: 0 };
  const batches = pullsForUser.map((pull) => makeCollectionBatch(pull.cards, pull.setId, pull.id));
  const { data, error } = await supabase.rpc("increment_collection_cards", { batches });
  if (error) throw error;
  const confirmedIds = new Set((data || []).map((row) => String(row.client_event_id || "")));
  const failedPulls = pullsForUser.filter((pull) => !confirmedIds.has(String(pull.id)));
  savePendingCloudPulls([...pullsForOtherUsers, ...failedPulls]);

  return {
    attempted: pullsForUser.length,
    saved: pullsForUser.length - failedPulls.length,
    failed: failedPulls.length,
  };
}

export function syncPendingCloudPulls(userId) {
  if (!userId) return Promise.resolve({ attempted: 0, saved: 0, failed: 0 });
  if (pendingSyncPromise) return pendingSyncPromise;
  pendingSyncPromise = performPendingCloudPullSync(userId)
    .finally(() => { pendingSyncPromise = null; });
  return pendingSyncPromise;
}

function makeCollectionBatch(cards, setId, clientEventId) {
  const validSetId = assertValidSetId(setId, "cloud pull save");
  const set = findSet(validSetId);

  if (!set) {
    console.warn("Unable to save PackDex cloud pull for unknown set id", {
      setId: validSetId,
      cardCount: cards.length,
    });
    throw new Error(`Unknown PackDex set id: ${validSetId}`);
  }

  if (!clientEventId || typeof clientEventId !== "string") {
    throw new TypeError("PackDex cloud pull save requires a stable client event id.");
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

export async function savePulledCardsToCloud(cards, setId, { userId = "", clientEventId = "" } = {}) {
  if (!supabase || !userId || !Array.isArray(cards) || cards.length === 0) return [];
  const batch = makeCollectionBatch(cards, setId, clientEventId);
  const { data, error } = await supabase.rpc("increment_collection_cards", { batches: [batch] });
  if (error) throw error;
  return data || [];
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
