import { getCardCollectionKey } from "./collectionStorage.js";

const BINDER_STORAGE_KEY = "packdex-binders";
const LEGACY_BINDER_STORAGE_KEY = "packdex-binder-cards";

export function makeBinderId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `binder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeBinderCard(item) {
  if (!item?.key || !item?.setId) return null;

  return {
    key: String(item.key),
    setId: String(item.setId),
    cardId: item.cardId || null,
    cardNumber: item.cardNumber || null,
    addedAt: item.addedAt || Date.now(),
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : 0,
  };
}

export function normalizeBinder(binder) {
  if (!binder?.id) return null;

  const type = binder.type === "master_set" ? "master_set" : "custom";

  return {
    id: String(binder.id),
    name: String(binder.name || "Untitled Binder").trim() || "Untitled Binder",
    tag: String(binder.tag || "Favorites").trim() || "Favorites",
    type,
    setId: binder.setId || binder.set_id || null,
    theme: String(binder.theme || "midnight").trim() || "midnight",
    createdAt: binder.createdAt || Date.now(),
    updatedAt: binder.updatedAt || binder.updated_at || binder.createdAt || Date.now(),
    cards: Array.isArray(binder.cards) ? binder.cards.map(normalizeBinderCard).filter(Boolean) : [],
  };
}

function safeParseBinders(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed.map(normalizeBinder).filter(Boolean);
    }

    if (Array.isArray(parsed?.binders)) {
      return parsed.binders.map(normalizeBinder).filter(Boolean);
    }
  } catch {
    return [];
  }

  return [];
}

function loadLegacyBinderCards() {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGACY_BINDER_STORAGE_KEY));

    return Array.isArray(parsed) ? parsed.map(normalizeBinderCard).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function getBinderCardKey(card, setId) {
  return `${setId}::${getCardCollectionKey(card, setId)}`;
}

export function createBinder({ name, tag, theme = "midnight" }) {
  const createdAt = Date.now();

  return {
    id: makeBinderId(),
    name: String(name || "New Binder").trim() || "New Binder",
    tag: String(tag || "Favorites").trim() || "Favorites",
    type: "custom",
    setId: null,
    theme: String(theme || "midnight").trim() || "midnight",
    createdAt,
    updatedAt: createdAt,
    cards: [],
  };
}

export function createMasterSetBinder(set, theme = "midnight") {
  if (!set?.id) return null;

  const createdAt = Date.now();

  return {
    id: `master-set-${set.id}`,
    name: `${set.name} Master Set`,
    tag: "Master Set",
    type: "master_set",
    setId: set.id,
    theme,
    createdAt,
    updatedAt: createdAt,
    cards: [],
  };
}

export function isMasterSetBinder(binder) {
  return binder?.type === "master_set" && Boolean(binder.setId);
}

export function loadBinders() {
  if (typeof window === "undefined") return [];

  const binders = safeParseBinders(window.localStorage.getItem(BINDER_STORAGE_KEY));

  if (binders.length > 0) return binders;

  const legacyCards = loadLegacyBinderCards();

  if (legacyCards.length === 0) return [];

  const migrated = [
    {
      id: "legacy-favorite-pulls",
      name: "Favorite Pulls",
      tag: "Favorites",
      createdAt: Date.now(),
      cards: legacyCards,
    },
  ];

  saveBinders(migrated);
  return migrated;
}

export function saveBinders(binders) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(BINDER_STORAGE_KEY, JSON.stringify({ binders }));
}

export function isCardInBinder(binder, card, setId) {
  const key = getBinderCardKey(card, setId);

  return Boolean(binder?.cards?.some((item) => item.key === key));
}

export function isCardInAnyBinder(binders, card, setId) {
  return binders.some((binder) => isCardInBinder(binder, card, setId));
}

export function addCardToBinder(binders, binderId, card, setId, timestamp = Date.now()) {
  const key = getBinderCardKey(card, setId);

  return binders.map((binder) => {
    if (binder.id !== binderId || binder.cards.some((item) => item.key === key)) {
      return binder;
    }

    return {
      ...binder,
      updatedAt: timestamp,
      cards: [
        ...binder.cards,
        {
          key,
          setId,
          cardId: card?.id || null,
          cardNumber: card?.number || null,
          addedAt: timestamp,
          order: binder.cards.length,
        },
      ],
    };
  });
}

export function removeCardFromBinder(binders, binderId, card, setId) {
  const key = getBinderCardKey(card, setId);

  return binders.map((binder) =>
    binder.id === binderId ? { ...binder, updatedAt: Date.now(), cards: binder.cards.filter((item) => item.key !== key) } : binder
  );
}

export function clearBinderCards(binders, binderId) {
  return binders.map((binder) => (binder.id === binderId ? { ...binder, updatedAt: Date.now(), cards: [] } : binder));
}

export function updateBinderTheme(binders, binderId, theme) {
  return binders.map((binder) =>
    binder.id === binderId ? { ...binder, theme: String(theme || "midnight"), updatedAt: Date.now() } : binder
  );
}
