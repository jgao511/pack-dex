import {
  PACKDEX_SITE_ORIGIN,
  parseStaticSiteRoute,
} from "./staticPublicRoutes.js";

export const DEFAULT_TITLE = "PackDex — Free Pokémon TCG Pack Opening & Collection";
export const DEFAULT_DESCRIPTION =
  "Open virtual Pokémon TCG packs, explore English-language sets, and track a digital collection with PackDex, a free fan-made collector companion.";

export const PUBLIC_PAGE_SEO = Object.freeze({
  home: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  welcome: {
    title: DEFAULT_TITLE,
    description:
      "Discover PackDex, a free fan-made Pokémon TCG simulator and collector companion for virtual pack opening, set exploration, wishlists, and collection tracking.",
  },
  install: {
    title: "Download PackDex for iPhone | PackDex",
    description:
      "Download PackDex for iPhone to explore Pokémon TCG sets, discover cards, open virtual packs, and build your digital collection.",
  },
  sets: {
    title: "Explore Pokémon TCG Sets | PackDex",
    description:
      "Browse every English-language Pokémon TCG set supported by PackDex across eras, then explore its card catalog, virtual packs, and collection progress.",
  },
  howItWorks: {
    title: "How PackDex Works | PackDex",
    description:
      "Learn how PackDex virtual pack openings, reveal modes, collection tracking, wishlists, guest use, accounts, and informational card values work.",
  },
  faq: {
    title: "PackDex FAQ",
    description:
      "Find answers about PackDex virtual packs, free access, accounts, collections, wishlists, card values, and its unofficial fan-made status.",
  },
  about: {
    title: "About PackDex",
    description:
      "Read why Jonathan created PackDex as an independent fan-made Pokémon TCG pack-opening simulator and collector companion.",
  },
  support: {
    title: "PackDex Support | Help, Contact & Account Deletion",
    description:
      "Contact PackDex support, find answers, send feedback, request features, and learn how to permanently delete your PackDex account.",
  },
  privacy: {
    title: "Privacy Policy | PackDex",
    description:
      "Learn how PackDex handles account, collection, app, sharing, technical, advertising, and privacy-choice information.",
  },
  terms: {
    title: "Terms of Service | PackDex",
    description:
      "Review the terms governing PackDex virtual pack opening, collection, sharing, pricing, account, and advertising features.",
  },
});

export function createSeoDescriptor({
  title,
  description,
  canonicalPath = null,
  indexable = false,
  type = "website",
  image = "/packdex-icon-512.png",
  jsonLd = [],
} = {}) {
  const canonicalUrl = canonicalPath ? `${PACKDEX_SITE_ORIGIN}${canonicalPath}` : null;
  return Object.freeze({
    title: title || DEFAULT_TITLE,
    description: description || DEFAULT_DESCRIPTION,
    canonicalPath,
    canonicalUrl,
    robots: indexable ? "index, follow" : "noindex, follow",
    indexable: Boolean(indexable),
    openGraph: Object.freeze({
      type,
      siteName: "PackDex",
      title: title || DEFAULT_TITLE,
      description: description || DEFAULT_DESCRIPTION,
      url: canonicalUrl,
      image: `${PACKDEX_SITE_ORIGIN}${image}`,
    }),
    twitter: Object.freeze({
      card: "summary",
      title: title || DEFAULT_TITLE,
      description: description || DEFAULT_DESCRIPTION,
      image: `${PACKDEX_SITE_ORIGIN}${image}`,
    }),
    jsonLd: Object.freeze(jsonLd),
  });
}

function websiteJsonLd() {
  return Object.freeze({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "PackDex",
    url: `${PACKDEX_SITE_ORIGIN}/`,
    description: DEFAULT_DESCRIPTION,
  });
}

function webApplicationJsonLd() {
  return Object.freeze({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "PackDex",
    url: `${PACKDEX_SITE_ORIGIN}/`,
    applicationCategory: "GameApplication",
    operatingSystem: "Any modern web browser",
    description: DEFAULT_DESCRIPTION,
  });
}

export function getNoindexSeoDescriptor({
  title = "PackDex",
  description = DEFAULT_DESCRIPTION,
} = {}) {
  return createSeoDescriptor({ title, description, canonicalPath: null, indexable: false });
}

export function getStaticPublicSeoDescriptor(pathname = "/") {
  const route = parseStaticSiteRoute(pathname);
  if (route.kind !== "public") {
    const title = route.kind === "unmatched" ? "Page Not Found | PackDex" : "PackDex";
    return getNoindexSeoDescriptor({ title });
  }

  const pageSeo = PUBLIC_PAGE_SEO[route.page] || PUBLIC_PAGE_SEO.home;
  const jsonLd = route.page === "home" || route.page === "welcome"
    ? [websiteJsonLd(), webApplicationJsonLd()]
    : [];

  return createSeoDescriptor({
    ...pageSeo,
    canonicalPath: route.canonicalPath,
    indexable: true,
    jsonLd,
  });
}
