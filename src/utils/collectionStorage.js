import { getSetCardById, sets } from "../data/sets.js";
import { isCollectibleSetCard } from "./energyCardPolicy.js";

export const COLLECTION_STORAGE_KEY = "pokemon-pack-simulator-collection";

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function isCodeCard(card) {
  return normalizeText(card?.name).includes("code card");
}

function safeParseCollection(value) {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getCardCollectionKey(card, setId) {
  if (card?.id) return String(card.id);
  throw new Error(`Card ${setId || "unknown-set"} is missing its stable PackDex ID.`);
}

function getDefaultStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadCollection(storage = getDefaultStorage()) {
  if (!storage) return {};

  return safeParseCollection(storage.getItem(COLLECTION_STORAGE_KEY));
}

export function saveCollection(collection, storage = getDefaultStorage()) {
  if (!storage) return collection || {};

  const persistedCollection = collection || {};
  storage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(persistedCollection));
  return persistedCollection;
}

export function markCardCollected(collection, card, setId, timestamp = Date.now()) {
  const set = sets.find((candidate) => candidate.id === setId) || { id: setId };
  if (card?.legacyQuarantine || !isCollectibleSetCard(card, set)) return collection;

  const key = getCardCollectionKey(card, setId);
  const setCollection = collection[setId] || {};
  const existing = setCollection[key];

  return {
    ...collection,
    [setId]: {
      ...setCollection,
      [key]: {
        count: (existing?.count || 0) + 1,
        firstCollectedAt: existing?.firstCollectedAt || timestamp,
        lastCollectedAt: timestamp,
      },
    },
  };
}

export function markCardsCollected(collection, cards, setId, timestamp = Date.now()) {
  return cards.reduce(
    (nextCollection, card) => markCardCollected(nextCollection, card, setId, timestamp),
    collection
  );
}

export function getCardCollectionEntry(collection, card, setId) {
  const key = getCardCollectionKey(card, setId);

  return collection?.[setId]?.[key];
}

export function isCardCollected(collection, card, setId) {
  return (getCardCollectionEntry(collection, card, setId)?.count || 0) > 0;
}

export function getCardCount(collection, card, setId) {
  return getCardCollectionEntry(collection, card, setId)?.count || 0;
}

export function getPullableCollectionCards(set) {
  return (set?.cards || []).filter((card) => !isCodeCard(card) && isCollectibleSetCard(card, set));
}

export function getLegacyCollectionCards(set, collection) {
  return (set?.legacyCards || []).filter((card) => getCardCount(collection, card, set.id) > 0);
}

export function getCollectionVisibleCards(set, collection) {
  return [...getPullableCollectionCards(set), ...getLegacyCollectionCards(set, collection)];
}

export function resolveSavedCollectionCard(set, cardId) {
  return getSetCardById(set, cardId, { includeLegacy: true });
}

export function getSetCollectionProgress(collection, set) {
  const cards = getPullableCollectionCards(set);
  const collected = cards.filter((card) => isCardCollected(collection, card, set.id)).length;
  const total = cards.length;
  const percent = total > 0 ? Math.round((collected / total) * 100) : 0;

  return {
    collected,
    total,
    percent,
  };
}
