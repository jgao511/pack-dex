export const PUBLIC_SET_ROUTE_PREFIX = "/set/";

const CANONICAL_SLUG_OVERRIDES = Object.freeze({
  151: "pokemon-151",
});

export function slugifySetName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createCanonicalSetSlug(set) {
  const id = String(set?.id || "");
  const slug = CANONICAL_SLUG_OVERRIDES[id] || slugifySetName(set?.name);
  if (!slug) throw new Error(`Unable to create a public slug for set ${id || "unknown"}`);
  return slug;
}

export function createCanonicalSetPath(set) {
  return `${PUBLIC_SET_ROUTE_PREFIX}${createCanonicalSetSlug(set)}`;
}
