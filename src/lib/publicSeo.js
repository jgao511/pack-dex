import {
  PACKDEX_SITE_ORIGIN,
  PUBLIC_ROUTE_PATHS,
  parseStaticSiteRoute,
} from "./staticPublicRoutes.js";
import {
  getCanonicalSetPath,
  getSetCatalogEntry,
  resolveLightweightPublicSetRoute,
} from "./setRouteCatalog.js";
import {
  createSeoDescriptor,
  getNoindexSeoDescriptor,
  getStaticPublicSeoDescriptor,
} from "./staticPublicSeo.js";

function breadcrumbJsonLd(set, canonicalPath) {
  return Object.freeze({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: Object.freeze([
      Object.freeze({
        "@type": "ListItem",
        position: 1,
        name: "Sets",
        item: `${PACKDEX_SITE_ORIGIN}${PUBLIC_ROUTE_PATHS.sets}`,
      }),
      Object.freeze({
        "@type": "ListItem",
        position: 2,
        name: set.name,
        item: `${PACKDEX_SITE_ORIGIN}${canonicalPath}`,
      }),
    ]),
  });
}

export function getSetSeoDescriptor(set) {
  const canonicalPath = getCanonicalSetPath(set);
  if (!canonicalPath || !set) return getNoindexSeoDescriptor();

  const supportedCardCount = getSetCatalogEntry(set)?.cardCount || 0;
  const title = `${set.name} Virtual Packs & Collection | PackDex`;
  const cardPhrase = supportedCardCount ? `browse ${supportedCardCount} supported cards` : "browse its supported catalog";
  const description =
    `Explore ${set.name} in PackDex. Open virtual packs, ${cardPhrase}, discover set highlights, and track your digital collection.`;

  return createSeoDescriptor({
    title,
    description,
    canonicalPath,
    indexable: true,
    image: `/set-logos/${set.setFolder || set.id}.png`,
    jsonLd: [breadcrumbJsonLd(set, canonicalPath)],
  });
}

export function getPublicSeoDescriptor(pathname = "/") {
  const setRoute = resolveLightweightPublicSetRoute(pathname);
  if (setRoute?.entry) return getSetSeoDescriptor(setRoute.entry);
  const route = parseStaticSiteRoute(pathname);
  if (route.kind === "unmatched") return getNoindexSeoDescriptor({ title: "Page Not Found | PackDex" });
  return getStaticPublicSeoDescriptor(pathname);
}

export {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  PUBLIC_PAGE_SEO,
  getNoindexSeoDescriptor,
} from "./staticPublicSeo.js";
