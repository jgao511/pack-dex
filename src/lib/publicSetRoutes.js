import { activeSets } from "../data/sets.js";
import {
  PUBLIC_SET_ROUTE_PREFIX,
  getCanonicalSetPath,
  getSetCatalogEntry,
  getSetSlug,
  resolveLightweightPublicSetRoute,
  setCatalogMetadata,
} from "./setRouteCatalog.js";

const fullSetById = new Map(activeSets.map((set) => [String(set.id), set]));

export const canonicalSetCatalog = Object.freeze(setCatalogMetadata.map((entry) => {
  const set = fullSetById.get(entry.id);
  if (!set) throw new Error(`Generated public set catalog references missing set ${entry.id}`);
  return Object.freeze({ set, setId: entry.id, slug: entry.slug, path: entry.path });
}));

export function getSetBySlug(slug) {
  const route = resolveLightweightPublicSetRoute(`${PUBLIC_SET_ROUTE_PREFIX}${String(slug || "")}`);
  return route?.entry ? fullSetById.get(route.entry.id) || null : null;
}

export function resolvePublicSetRoute(pathname = "") {
  const route = resolveLightweightPublicSetRoute(pathname);
  if (!route) return null;
  if (route.status === "invalid") {
    return Object.freeze({ ...route, set: null });
  }

  const set = fullSetById.get(route.setId) || null;
  if (!set) {
    return Object.freeze({ status: "invalid", set: null, slug: route.slug, canonicalPath: null, isCanonical: false, isAlias: false });
  }
  return Object.freeze({ ...route, set });
}

export {
  PUBLIC_SET_ROUTE_PREFIX,
  getCanonicalSetPath,
  getSetCatalogEntry,
  getSetSlug,
};
