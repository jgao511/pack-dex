import { PACKDEX_SITE_ORIGIN } from "../../../src/lib/publicRoutes.js";
import { getCanonicalSetPath } from "../../../src/lib/publicSetRoutes.js";

export const MOBILE_ROBOTS_DIRECTIVE = "noindex, follow";

function normalizeMobilePath(pathname = "") {
  const rawPath = String(pathname || "").split(/[?#]/, 1)[0] || "/mobile-app/";
  return rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
}
export function getMobileRouteSeo(pathname = globalThis.location?.pathname || "") {
  const normalizedPath = normalizeMobilePath(pathname);
  const setMatch = normalizedPath.match(/^\/mobile-app\/explore\/sets\/([^/]+)$/i);
  let setId = "";

  if (setMatch) {
    try {
      setId = decodeURIComponent(setMatch[1]);
    } catch {
      setId = "";
    }
  }

  const canonicalPath = setId ? getCanonicalSetPath(setId) : null;

  return Object.freeze({
    pathname: normalizedPath,
    robots: MOBILE_ROBOTS_DIRECTIVE,
    canonicalPath,
    canonicalUrl: canonicalPath ? `${PACKDEX_SITE_ORIGIN}${canonicalPath}` : null,
    isDuplicateSetRoute: Boolean(canonicalPath),
  });
}

function upsertRobots(documentRef, content) {
  let meta = documentRef.head.querySelector('meta[name="robots"]');
  if (!meta) {
    meta = documentRef.createElement("meta");
    meta.setAttribute("name", "robots");
    documentRef.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

function updateCanonical(documentRef, canonicalUrl) {
  let canonical = documentRef.head.querySelector('link[rel="canonical"]');
  if (!canonicalUrl) {
    canonical?.remove();
    return;
  }
  if (!canonical) {
    canonical = documentRef.createElement("link");
    canonical.setAttribute("rel", "canonical");
    documentRef.head.appendChild(canonical);
  }
  canonical.setAttribute("href", canonicalUrl);
}

export function applyMobileRouteSeo(
  pathname = globalThis.location?.pathname || "",
  documentRef = globalThis.document
) {
  const descriptor = getMobileRouteSeo(pathname);
  if (!documentRef?.head?.querySelector || !documentRef?.createElement) return descriptor;

  upsertRobots(documentRef, descriptor.robots);
  updateCanonical(documentRef, descriptor.canonicalUrl);
  return descriptor;
}
