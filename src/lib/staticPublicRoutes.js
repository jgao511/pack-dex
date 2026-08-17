export const PACKDEX_SITE_ORIGIN = "https://www.pack-dex.com";

export const PUBLIC_ROUTE_PATHS = Object.freeze({
  home: "/",
  welcome: "/welcome",
  sets: "/sets",
  howItWorks: "/how-it-works",
  faq: "/faq",
  about: "/about",
  support: "/support",
  privacy: "/privacy",
  terms: "/terms",
});

export const PUBLIC_ROUTE_PATTERNS = Object.freeze({
  set: "/set/:slug",
});

export const INDEXABLE_PUBLIC_PATHS = Object.freeze(Object.values(PUBLIC_ROUTE_PATHS));

export const EDITORIAL_PUBLIC_PATHS = Object.freeze([
  PUBLIC_ROUTE_PATHS.howItWorks,
  PUBLIC_ROUTE_PATHS.faq,
  PUBLIC_ROUTE_PATHS.about,
  PUBLIC_ROUTE_PATHS.support,
  PUBLIC_ROUTE_PATHS.privacy,
  PUBLIC_ROUTE_PATHS.terms,
]);

export const UTILITY_ROUTE_PATHS = Object.freeze({
  collection: "/collection",
  profile: "/profile",
  settings: "/settings",
  login: "/login",
  signup: "/signup",
  resetPassword: "/reset-password",
  authCallback: "/auth/callback",
  onboarding: "/onboarding",
});

const publicPageByPath = new Map(
  Object.entries(PUBLIC_ROUTE_PATHS).map(([page, pathname]) => [pathname, page])
);
const utilityPageByPath = new Map(
  Object.entries(UTILITY_ROUTE_PATHS).map(([page, pathname]) => [pathname, page])
);
const editorialPathSet = new Set(EDITORIAL_PUBLIC_PATHS);

export function normalizeSitePath(pathname = "/") {
  const withoutQuery = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : "/";
}

export function getCanonicalUrl(pathname) {
  return `${PACKDEX_SITE_ORIGIN}${normalizeSitePath(pathname)}`;
}

export function isEditorialPublicPath(pathname) {
  return editorialPathSet.has(normalizeSitePath(pathname));
}

export function parseStaticSiteRoute(pathname = "/") {
  const rawPath = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  const normalizedPath = normalizeSitePath(rawPath);
  const publicPage = publicPageByPath.get(normalizedPath);

  if (publicPage) {
    const canonicalPath = PUBLIC_ROUTE_PATHS[publicPage];
    return Object.freeze({
      kind: "public",
      page: publicPage,
      pathname: normalizedPath,
      canonicalPath,
      indexable: true,
      isCanonical: rawPath === canonicalPath,
      set: null,
    });
  }

  const utilityPage = utilityPageByPath.get(normalizedPath);
  if (utilityPage) {
    return Object.freeze({
      kind: "utility",
      page: utilityPage,
      pathname: normalizedPath,
      canonicalPath: null,
      indexable: false,
      isCanonical: false,
      set: null,
    });
  }

  if (normalizedPath === "/mobile-app" || normalizedPath.startsWith("/mobile-app/")) {
    return Object.freeze({
      kind: "utility",
      page: "mobileApp",
      pathname: normalizedPath,
      canonicalPath: null,
      indexable: false,
      isCanonical: false,
      set: null,
    });
  }

  return Object.freeze({
    kind: "unmatched",
    page: null,
    pathname: normalizedPath,
    canonicalPath: null,
    indexable: false,
    isCanonical: false,
    set: null,
  });
}
