import { resolveLightweightPublicSetRoute } from "./setRouteCatalog.js";
import { normalizeSitePath, parseStaticSiteRoute } from "./staticPublicRoutes.js";

export function parseRuntimeSiteRoute(pathname = "/") {
  const rawPath = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  const normalizedPath = normalizeSitePath(rawPath);
  const setRoute = resolveLightweightPublicSetRoute(rawPath);

  if (setRoute) {
    if (setRoute.status === "invalid") {
      return Object.freeze({ kind: "not-found", page: "notFound", pathname: normalizedPath, canonicalPath: null, indexable: false, isCanonical: false, set: null, setId: null });
    }
    return Object.freeze({
      kind: "set",
      page: "set",
      pathname: normalizedPath,
      canonicalPath: setRoute.canonicalPath,
      indexable: true,
      isCanonical: setRoute.isCanonical,
      isAlias: setRoute.isAlias,
      set: setRoute.entry,
      setId: setRoute.setId,
      slug: setRoute.slug,
    });
  }

  const staticRoute = parseStaticSiteRoute(rawPath);
  if (staticRoute.kind !== "unmatched") return staticRoute;
  return Object.freeze({ kind: "not-found", page: "notFound", pathname: normalizedPath, canonicalPath: null, indexable: false, isCanonical: false, set: null, setId: null });
}
