import { supabase } from "./supabaseClient.js";
import { getCardImageUrl } from "../../../src/utils/assetUrls.js";
import { getCardCollectionKey, markCardsCollected } from "../../../src/utils/collectionStorage.js";
import { getDisplayCardName, getDisplayRarity } from "../../../src/utils/packGenerator.js";
import { sets } from "../../../src/data/sets.js";

const USER_COLLECTION_TABLE = "user_collection";
const PENDING_CLOUD_PULLS_KEY = "packdex-mobile-pending-cloud-pulls";

function findSet(setId) {
  return sets.find((set) => set.id === setId);
}

function assertValidSetId(setId, context = "mobile cloud collection save") {
  if (typeof setId !== "string" || setId.trim() === "") {
    const receivedType = Array.isArray(setId) ? "array" : typeof setId;
    const error = new TypeError(`PackDex ${context} requires a non-empty string set id.`);

    console.warn("Invalid PackDex mobile cloud collection set id", {
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

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.warn("Unable to read mobile Supabase user", error);
    return null;
  }

  return data.user || null;
}

export async function loadCloudCollection() {
  const user = await getCurrentUser();

  if (!user) return {};

  const { data, error } = await supabase
    .from(USER_COLLECTION_TABLE)
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    console.warn("Unable to load mobile cloud collection", error);
    throw error;
  }

  return cloudRowsToCollection(data || []);
}

function compactCardRow(card, set, setId, quantity = 1) {
  return {
    card_id: getCardCollectionKey(card, setId),
    set_id: setId,
    quantity,
    card_name: getDisplayCardName(card, set),
    card_number: String(card?.number || ""),
    rarity: getDisplayRarity(card, set),
    image_url: getCardImageUrl(card),
    card_data: null,
  };
}

export function enqueuePendingCloudPull(cards, setId, userId) {
  const validSetId = assertValidSetId(setId, "pending cloud pull queue");

  if (!userId || !Array.isArray(cards) || cards.length === 0) {
    return [];
  }

  const pendingPulls = loadPendingCloudPulls();
  const nextPendingPulls = [
    ...pendingPulls,
    {
      id: `${userId}:${validSetId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      userId,
      setId: validSetId,
      cards: cards.map(compactPendingCard),
      createdAt: Date.now(),
    },
  ];

  savePendingCloudPulls(nextPendingPulls);
  return nextPendingPulls.filter((pull) => pull.userId === userId);
}

export function mergePendingCloudPullsIntoCollection(collection, userId) {
  if (!userId) return collection || {};

  const pendingCollection = loadPendingCloudPulls()
    .filter((pull) => pull.userId === userId && typeof pull.setId === "string" && Array.isArray(pull.cards))
    .reduce((nextCollection, pull) => {
      const set = findSet(pull.setId);

      if (!set) {
        console.warn("Skipping pending mobile cloud pull for unknown set id", {
          setId: pull.setId,
          cardCount: pull.cards.length,
        });
        return nextCollection;
      }

      return markCardsCollected(nextCollection, pull.cards, pull.setId, pull.createdAt || Date.now());
    }, {});

  return mergeCollectionCounts(collection, pendingCollection);
}

export async function syncPendingCloudPulls(userId) {
  if (!userId) return { attempted: 0, saved: 0, failed: 0 };

  const pendingPulls = loadPendingCloudPulls();
  const pullsForOtherUsers = pendingPulls.filter((pull) => pull.userId !== userId);
  const pullsForUser = pendingPulls.filter((pull) => pull.userId === userId);
  const failedPulls = [];
  let saved = 0;

  for (const pull of pullsForUser) {
    try {
      await savePulledCardsToCloud(pull.cards, pull.setId);
      saved += 1;
    } catch (error) {
      console.warn("Pending PackDex mobile cloud pull sync failed", {
        setId: pull.setId,
        cardCount: pull.cards?.length || 0,
        error,
      });
      failedPulls.push(pull);
    }
  }

  savePendingCloudPulls([...pullsForOtherUsers, ...failedPulls]);

  return {
    attempted: pullsForUser.length,
    saved,
    failed: failedPulls.length,
  };
}

export async function savePulledCardsToCloud(cards, setId) {
  const validSetId = assertValidSetId(setId, "cloud pull save");
  const user = await getCurrentUser();

  if (!user || !Array.isArray(cards) || cards.length === 0) {
    return [];
  }

  const set = findSet(validSetId);

  if (!set) {
    console.warn("Unable to save PackDex mobile cloud pull for unknown set id", {
      setId: validSetId,
      cardCount: cards.length,
    });
    throw new Error(`Unknown PackDex set id: ${validSetId}`);
  }

  const grouped = new Map();

  for (const card of cards) {
    const row = compactCardRow(card, set, validSetId, 1);
    const existing = grouped.get(row.card_id);

    grouped.set(row.card_id, {
      ...row,
      quantity: (existing?.quantity || 0) + 1,
    });
  }

  const rows = [...grouped.values()];
  const cardIds = rows.map((row) => row.card_id);
  const { data: existingRows, error: existingError } = await supabase
    .from(USER_COLLECTION_TABLE)
    .select("card_id, quantity")
    .eq("user_id", user.id)
    .eq("set_id", validSetId)
    .in("card_id", cardIds);

  if (existingError) {
    console.warn("Unable to load existing mobile cloud cards before save", {
      setId: validSetId,
      cardCount: cards.length,
      error: existingError,
    });
    throw existingError;
  }

  const existingQuantities = new Map((existingRows || []).map((row) => [row.card_id, Number(row.quantity || 0)]));
  const existingCardIds = new Set((existingRows || []).map((row) => row.card_id));
  const rowsToUpdate = rows.filter((row) => existingCardIds.has(row.card_id));
  const rowsToInsert = rows.filter((row) => !existingCardIds.has(row.card_id));

  for (const row of rowsToUpdate) {
    const { error } = await supabase
      .from(USER_COLLECTION_TABLE)
      .update({
        quantity: (existingQuantities.get(row.card_id) || 0) + row.quantity,
        card_name: row.card_name,
        card_number: row.card_number,
        rarity: row.rarity,
        image_url: row.image_url,
        card_data: null,
      })
      .eq("user_id", user.id)
      .eq("set_id", row.set_id)
      .eq("card_id", row.card_id);

    if (error) {
      console.warn("Unable to update mobile cloud card", {
        setId: validSetId,
        cardId: row.card_id,
        cardCount: cards.length,
        error,
      });
      throw error;
    }
  }

  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from(USER_COLLECTION_TABLE).insert(
      rowsToInsert.map((row) => ({
        ...row,
        user_id: user.id,
      }))
    );

    if (error) {
      console.warn("Unable to insert mobile cloud cards", {
        setId: validSetId,
        rowCount: rowsToInsert.length,
        cardCount: cards.length,
        error,
      });
      throw error;
    }
  }

  return rows;
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
