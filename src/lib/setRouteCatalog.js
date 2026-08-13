import generatedSetCatalog from "../data/generated/setCatalogMetadata.json" with { type: "json" };
import { PUBLIC_SET_ROUTE_PREFIX } from "./setSlug.js";

export const setCatalogMetadata = Object.freeze(
  generatedSetCatalog.map((entry) => Object.freeze({ ...entry }))
);

const catalogById = new Map(setCatalogMetadata.map((entry) => [entry.id, entry]));
const catalogBySlug = new Map();

for (const entry of setCatalogMetadata) {
  if (catalogBySlug.has(entry.slug)) {
    throw new Error(`Duplicate public set slug "${entry.slug}"`);
  }
  catalogBySlug.set(entry.slug, entry);
}

function getSetId(setOrId) {
  if (typeof setOrId === "string" || typeof setOrId === "number") return String(setOrId);
  return setOrId?.id == null ? "" : String(setOrId.id);
}

export function getSetCatalogEntry(setOrId) {
  return catalogById.get(getSetId(setOrId)) || null;
}

export function getSetSlug(setOrId) {
  return getSetCatalogEntry(setOrId)?.slug || null;
}

export function getCanonicalSetPath(setOrId) {
  return getSetCatalogEntry(setOrId)?.path || null;
}

export function resolveLightweightPublicSetRoute(pathname = "") {
  const path = String(pathname || "").split(/[?#]/, 1)[0];
  const match = path.match(/^\/set\/([^/]+)\/?$/i);
  if (!match) return null;

  let routeSegment;
  try {
    routeSegment = decodeURIComponent(match[1]);
  } catch {
    return Object.freeze({ status: "invalid", entry: null, setId: null, slug: null, canonicalPath: null, isCanonical: false, isAlias: false });
  }

  const lookupKey = routeSegment.trim().toLowerCase();
  const entry = catalogBySlug.get(lookupKey) || catalogById.get(lookupKey);
  if (!entry) {
    return Object.freeze({ status: "invalid", entry: null, setId: null, slug: lookupKey || null, canonicalPath: null, isCanonical: false, isAlias: false });
  }

  const isCanonical = path === entry.path;
  return Object.freeze({
    status: isCanonical ? "canonical" : "alias",
    entry,
    setId: entry.id,
    slug: entry.slug,
    canonicalPath: entry.path,
    isCanonical,
    isAlias: !isCanonical,
  });
}

export { PUBLIC_SET_ROUTE_PREFIX };
