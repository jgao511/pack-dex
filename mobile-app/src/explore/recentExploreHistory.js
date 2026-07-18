export const RECENT_EXPLORE_KEY = "packdex:explore:recent:v1";
export const MAX_RECENT_EXPLORE_ITEMS = 8;

export function normalizeRecentExploreRefs(items = [], limit = MAX_RECENT_EXPLORE_ITEMS) {
  const seen = new Set();
  return items.filter((item) => {
    if (!["pokemon", "set", "era"].includes(item?.kind) || item.id == null) return false;
    const key = `${item.kind}:${String(item.id)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit).map((item) => ({ kind: item.kind, id: item.id }));
}

export function prependRecentExploreRef(items, next) {
  return normalizeRecentExploreRefs([next, ...(Array.isArray(items) ? items : [])]);
}
