const COLLECTION_ORIGINS = new Set(["collection", "binder", "collection-search"]);

export function getCardDetailActionVisibility(origin, { hasPokemon, hasSet, hasEra }) {
  return {
    pokemon: Boolean(hasPokemon) && origin !== "pokemon-detail",
    set: Boolean(hasSet) && !COLLECTION_ORIGINS.has(origin) && origin !== "set-detail",
    era: Boolean(hasEra) && !COLLECTION_ORIGINS.has(origin) && origin !== "era-detail",
  };
}

export function getCardActionLayoutClass(count) {
  const normalizedCount = Math.max(0, Number(count) || 0);
  return normalizedCount > 3 ? "has-many-actions" : `has-${normalizedCount}-actions`;
}
