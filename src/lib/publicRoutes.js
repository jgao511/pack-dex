import { resolvePublicSetRoute } from "./publicSetRoutes.js";
import {
  normalizeSitePath,
  parseStaticSiteRoute,
} from "./staticPublicRoutes.js";

export * from "./staticPublicRoutes.js";

export function parseSiteRoute(pathname = "/") {
  const rawPath = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  const normalizedPath = normalizeSitePath(rawPath);
  const setRoute = resolvePublicSetRoute(rawPath);

  if (setRoute) {
    if (setRoute.status === "invalid") {
      return Object.freeze({
        kind: "not-found",
        page: "notFound",
        pathname: normalizedPath,
        canonicalPath: null,
        indexable: false,
        isCanonical: false,
        set: null,
      });
    }

    return Object.freeze({
      kind: "set",
      page: "set",
      pathname: normalizedPath,
      canonicalPath: setRoute.canonicalPath,
      indexable: true,
      isCanonical: setRoute.isCanonical,
      isAlias: setRoute.isAlias,
      set: setRoute.set,
      slug: setRoute.slug,
    });
  }

  const staticRoute = parseStaticSiteRoute(rawPath);
  if (staticRoute.kind !== "unmatched") return staticRoute;

  return Object.freeze({
    kind: "not-found",
    page: "notFound",
    pathname: normalizedPath,
    canonicalPath: null,
    indexable: false,
    isCanonical: false,
    set: null,
  });
}

export function isIndexablePublicPath(pathname) {
  return parseSiteRoute(pathname).indexable;
}
