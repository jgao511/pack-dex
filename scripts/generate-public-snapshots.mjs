import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGAL_DOCUMENTS, LEGAL_LAST_UPDATED, PACKDEX_SUPPORT_EMAIL } from "../src/content/legalDocuments.js";
import { getPublicSeoDescriptor } from "../src/lib/publicSeo.js";
import { PUBLIC_ROUTE_PATHS, UTILITY_ROUTE_PATHS } from "../src/lib/publicRoutes.js";
import { canonicalSetCatalog } from "../src/lib/publicSetRoutes.js";
import { getSetExploreDetails } from "../src/lib/setExploreDetails.js";
import { getSetPublicContent } from "../src/lib/setContent.js";
import { getPullableCollectionCards } from "../src/utils/collectionStorage.js";
import { getCardImageUrl, getSetPackArtUrl } from "../src/utils/assetUrls.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDist = path.join(repoRoot, "dist");

const FAQ_ITEMS = Object.freeze([
  {
    question: "Is PackDex free to play?",
    answer:
      "Yes. PackDex is 100% free to play. You can open virtual packs and explore the platform without purchasing physical cards or virtual currency. Cards obtained through PackDex exist only within the simulator and have no redeemable cash value.",
  },
  {
    question: "Are the cards I pull real?",
    answer:
      "No. Every PackDex opening is virtual. Cards pulled on PackDex cannot be shipped, redeemed, exchanged for money, converted into prizes, or sold through PackDex.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. You can explore PackDex and open packs as a guest. Creating an account allows you to maintain a persistent PackDex collection and use account-based collection features across supported devices.",
  },
  {
    question: "Are PackDex openings the same as physical Pokémon TCG packs?",
    answer:
      "No. PackDex is an independent simulator designed to recreate the fun of opening and collecting cards digitally. Virtual results should not be interpreted as a guarantee or prediction of what a particular physical Pokémon TCG pack will contain.",
  },
  {
    question: "How do I track my collection?",
    answer:
      "Cards you pull can be added to your PackDex collection and organized by set. You can see what you have collected, what you are still missing, and your progress toward completing individual sets.",
  },
  {
    question: "What is the PackDex wishlist?",
    answer:
      "The wishlist gives you a separate place to keep track of cards you still want to find. Save missing favorites and use the wishlist as your personal chase list while exploring different sets.",
  },
  {
    question: "What do the card values mean?",
    answer:
      "PackDex may display estimated market information for supported cards when pricing data is available. These values are provided for informational and collection-tracking purposes and can change over time. PackDex does not buy or sell the cards displayed in the app.",
  },
  {
    question: "Can I complete an entire set?",
    answer:
      "Yes. PackDex lets you track progress through individual sets so you can keep opening virtual packs, revisit your collection, and see which cards you still need.",
  },
  {
    question: "Is PackDex an official Pokémon product?",
    answer:
      "No. PackDex is an unofficial, fan-made project and is not affiliated with, endorsed by, or sponsored by Nintendo, Creatures, GAME FREAK, The Pokémon Company, or any official Pokémon TCG partner. Pokémon names, imagery, card data, and related trademarks belong to their respective owners.",
  },
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function publicHeader() {
  return `
    <header class="public-snapshot__header">
      <a class="public-snapshot__brand" href="/" aria-label="PackDex home">
        <img src="/packdex-icon-192.png" width="40" height="40" alt="" />
        <span>PackDex</span>
      </a>
      <nav aria-label="Public site">
        <a href="/sets">Sets</a>
        <a href="/how-it-works">How It Works</a>
        <a href="/faq">FAQ</a>
        <a href="/about">About</a>
      </nav>
    </header>`;
}

function productHeader({ showTabs = false } = {}) {
  return `
    <header class="public-snapshot__product-header${showTabs ? "" : " public-snapshot__product-header--pack-flow"}">
      <a class="public-snapshot__product-brand" href="/sets" aria-label="PackDex set selector">
        <img src="/packdex-icon-192.png" width="40" height="40" alt="" />
        <span class="public-snapshot__wordmark"><span>Pack</span><span>Dex</span></span>
      </a>
      ${showTabs ? `<nav class="public-snapshot__product-tabs" aria-label="Main navigation">
        <a class="is-active" href="/sets" aria-current="page">Open a Pack</a>
        <a href="/collection">Collection</a>
        <a href="/profile">Profile</a>
      </nav>` : ""}
    </header>`;
}

function publicFooter() {
  return `
    <footer class="public-snapshot__footer">
      <nav aria-label="Policies and information">
        <a href="/sets">Sets</a>
        <a href="/how-it-works">How It Works</a>
        <a href="/faq">FAQ</a>
        <a href="/about">About</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </nav>
      <p>PackDex is an unofficial, fan-made project and is not affiliated with or endorsed by Nintendo, Creatures, GAME FREAK, or The Pokémon Company. Pokémon names, imagery, card data, and related trademarks belong to their respective owners.</p>
    </footer>`;
}

function pageShell({
  pathname,
  eyebrow = "PackDex",
  title,
  intro = "",
  content = "",
  className = "",
  headerMarkup = publicHeader(),
}) {
  return `<div class="public-snapshot ${escapeHtml(className)}" data-packdex-static-snapshot="${escapeHtml(pathname)}">
    ${headerMarkup}
    <main id="main-content" class="public-snapshot__main">
      <section class="public-snapshot__hero">
        <p class="public-snapshot__eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        ${intro ? `<p class="public-snapshot__lead">${escapeHtml(intro)}</p>` : ""}
      </section>
      ${content}
    </main>
    ${publicFooter()}
  </div>`;
}

function renderWelcomeSnapshot(pathname = "/") {
  const whatIsPackDex = [
    "PackDex is an unofficial, fan-made Pokémon TCG pack-opening simulator and collector companion built for fans who want to explore the franchise, learn more about different sets, and enjoy the collecting experience online.",
    "Anyone who has tried to get back into Pokémon cards lately knows how hard it can be to find packs in stores. PackDex gives you another way to explore the hobby: choose an English Pokémon TCG set and open a virtual pack directly in your browser.",
    "Each opening adds cards to your PackDex collection, where you can revisit your pulls, track progress toward completing sets, build a wishlist, and see which cards you are still missing.",
    "PackDex is designed as a collecting experience and companion rather than a marketplace or gambling platform. Virtual cards have no cash value, cannot be redeemed for physical cards or prizes, and cannot be bought or sold through PackDex.",
    "Whether you want to revisit an older era, learn more about a set you never opened, or simply enjoy chasing a favorite card, PackDex gives you a free way to explore the Pokémon TCG and build a virtual collection at your own pace.",
  ];
  const steps = [
    ["Choose a Set", "Browse every English Pokémon TCG set across different eras and choose the one you want to explore. Move between generations, revisit old favorites, or discover sets you may have missed."],
    ["Open a Virtual Pack", "Start an opening and reveal your cards one at a time. PackDex uses set-specific pack configurations to create a virtual opening experience while keeping every result entirely digital."],
    ["Build Your Collection", "Cards you pull are added directly to your PackDex collection. Track progress by set, revisit cards you have already discovered, and see what you are still missing as you work toward your own collection goals."],
    ["Find Your Next Chase", "Use your wishlist to keep track of cards you want to find, explore card information and available market estimates, and return to your favorite sets as your collection grows."],
  ];

  const content = `
    <section class="public-snapshot__section">
      <h2>What is PackDex?</h2>
      ${whatIsPackDex.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
    </section>
    <section class="public-snapshot__section">
      <h2>How PackDex Works</h2>
      <ol class="public-snapshot__steps">
        ${steps.map(([heading, body]) => `<li><h3>${escapeHtml(heading)}</h3><p>${escapeHtml(body)}</p></li>`).join("\n")}
      </ol>
      <p>PackDex is a simulator and collector companion, not a prediction of what will appear in a physical Pokémon TCG product. Virtual results exist only within PackDex.</p>
      <p><a class="public-snapshot__cta" href="/how-it-works">Learn How PackDex Works</a></p>
    </section>
    <section class="public-snapshot__section">
      <h2>Explore the Pokémon TCG Across Eras</h2>
      <p>Pokémon cards have changed significantly across generations, and part of the fun of PackDex is moving between them. Explore sets from different eras, compare their cards and rarities, and build separate collection progress for the sets you care about most.</p>
      <p>Jump into a familiar favorite or discover cards from an era you may have missed. Each set gives you another collection to work toward, giving you a reason to revisit older releases even after you begin exploring newer ones.</p>
      <p>PackDex brings English-language sets together in one collection experience so your virtual collection can grow across generations.</p>
      <p><a class="public-snapshot__cta" href="/sets">Explore All Sets →</a></p>
    </section>
    <section class="public-snapshot__section">
      <h2>Frequently Asked Questions</h2>
      <div class="public-snapshot__faq">
        ${FAQ_ITEMS.slice(0, 4).map((item) => `<article><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p></article>`).join("\n")}
      </div>
      <p><a class="public-snapshot__cta" href="/faq">View All FAQs →</a></p>
    </section>`;

  return pageShell({
    pathname,
    eyebrow: "Virtual packs. Real collecting goals.",
    title: "Open Pokémon TCG Packs. Build Your PackDex.",
    intro:
      "Choose an English-language set, open virtual packs in your browser, and track the cards you discover in a free digital collection.",
    content,
    className: "public-snapshot--welcome",
  });
}

function groupSetCatalogByEra() {
  const groups = new Map();
  for (const entry of canonicalSetCatalog) {
    const era = entry.set.era || entry.set.series || "Other English Sets";
    if (!groups.has(era)) groups.set(era, []);
    groups.get(era).push(entry);
  }
  return groups;
}

function renderSetsSnapshot() {
  const groups = groupSetCatalogByEra();
  const content = [...groups.entries()].map(([era, entries]) => `
    <section class="public-snapshot__section public-snapshot__era" aria-labelledby="era-${escapeHtml(era.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}">
      <h2 id="era-${escapeHtml(era.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}">${escapeHtml(era)}</h2>
      <div class="public-snapshot__set-grid">
        ${entries.map(({ set, path: setPath }) => `<a class="public-snapshot__set-link" href="${escapeHtml(setPath)}">
          <img src="/set-logos/${escapeHtml(set.setFolder)}.png" loading="lazy" alt="${escapeHtml(set.name)} set logo" />
          <strong>${escapeHtml(set.name)}</strong>
          <span>${escapeHtml(getSetPublicContent(set).supportedCardCount)} supported cards</span>
        </a>`).join("\n")}
      </div>
    </section>`).join("\n");

  return pageShell({
    pathname: PUBLIC_ROUTE_PATHS.sets,
    eyebrow: "Open a Pack",
    title: "Choose a Pokémon TCG Set",
    intro:
      `Browse ${canonicalSetCatalog.length} supported English-language sets by era. Choose one to open a virtual pack or explore its PackDex collection and card catalog.`,
    content,
    className: "public-snapshot--sets",
    headerMarkup: productHeader({ showTabs: true }),
  });
}

function formatReleaseDate(releaseDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(releaseDate || ""))) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${releaseDate}T00:00:00Z`));
}

function renderSetSnapshot(entry) {
  const { set, path: setPath } = entry;
  const publicContent = getSetPublicContent(set);
  const supportedCards = getPullableCollectionCards(set);
  const releaseDate = formatReleaseDate(publicContent.releaseDate);
  const setDetails = getSetExploreDetails(set, {
    featuredCardLimit: 4,
    featuredPokemonLimit: 6,
  });
  const printedTotal = Number.isInteger(publicContent.printedTotal) ? publicContent.printedTotal : null;
  const supportedCardCount = publicContent.supportedCardCount;
  const stats = [
    ["Era", set.era || set.series || null],
    ["Set size", `${supportedCardCount} supported cards`],
    ["Released", releaseDate],
    ["Main set", printedTotal ? `${printedTotal} cards` : null],
  ].filter(([, value]) => value);
  const packArtUrl = getSetPackArtUrl(set) || "/card-back.webp";
  const featuredPokemon = setDetails.featuredPokemon.map(({ species }) => species.displayName);

  const content = `
    <section class="public-snapshot__pack-ready" aria-labelledby="pack-ready-title">
      <div class="public-snapshot__pack-title">
        <span>Pack Ready</span>
        <img class="public-snapshot__opening-logo" src="/set-logos/${escapeHtml(set.setFolder)}.png" alt="${escapeHtml(set.name)} set logo" />
        <h1 id="pack-ready-title">${escapeHtml(set.name)}</h1>
      </div>
      <div class="public-snapshot__pack-stage" aria-label="${escapeHtml(set.name)} virtual booster pack">
        <img class="public-snapshot__pack-card public-snapshot__pack-card--back" src="/card-back.webp" alt="" />
        <img class="public-snapshot__pack-card public-snapshot__pack-card--middle" src="/card-back.webp" alt="" />
        <img class="public-snapshot__pack-art" src="${escapeHtml(packArtUrl)}" alt="${escapeHtml(set.name)} virtual pack artwork" decoding="async" fetchpriority="high" />
      </div>
      <div class="public-snapshot__pack-actions">
        <a href="/sets">Back to Sets</a>
        <a href="#set-collection">Collection</a>
        <a class="public-snapshot__cta" href="${escapeHtml(setPath)}" aria-label="Open a ${escapeHtml(set.name)} virtual pack">Open Pack</a>
      </div>
      <p>Virtual cards have no cash value and cannot be redeemed for physical products or prizes.</p>
    </section>
    <section class="public-snapshot__section">
      <h2>About ${escapeHtml(set.name)}</h2>
      <p>${escapeHtml(publicContent.summary)}</p>
      <dl class="public-snapshot__stats">
        ${stats.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("\n")}
      </dl>
      ${featuredPokemon.length ? `<p><strong>Featured Pokémon:</strong> ${featuredPokemon.map(escapeHtml).join(" · ")}</p>` : ""}
      ${publicContent.guide?.funFacts?.map((fact) => `<p><strong>Set highlight:</strong> ${escapeHtml(fact)}</p>`).join("\n") || ""}
      ${setDetails.specialFeature ? `<p class="public-snapshot__special-feature">&#10022; ${escapeHtml(setDetails.specialFeature)}</p>` : ""}
      ${setDetails.featuredCards.length ? `<div class="public-snapshot__featured-cards" aria-label="Featured cards in ${escapeHtml(set.name)}">
        ${setDetails.featuredCards.map(({ card }) => `<figure><img src="${escapeHtml(getCardImageUrl(card))}" alt="${escapeHtml(card.name)} card" loading="lazy" decoding="async" /><figcaption>${escapeHtml(card.name)}</figcaption></figure>`).join("\n")}
      </div>` : ""}
    </section>
    <section id="set-collection" class="public-snapshot__section">
      <h2>${escapeHtml(set.name)} Collection</h2>
      <p>PackDex tracks this set separately across ${supportedCardCount} supported cards. In the interactive view, collectors can review pulled quantities, missing cards, completion progress, rarity information, and wishlist state.</p>
      <p>Guest progress stays with the supported browser or device. An account enables PackDex's persistent account-based collection features across supported devices.</p>
    </section>
    <section class="public-snapshot__section">
      <h2>${escapeHtml(set.name)} Card Catalog and Checklist</h2>
      <p>Use this factual PackDex catalog to review the supported cards in the set. In the interactive collection view, pulled quantities, missing cards, completion progress, and wishlist state are stored separately for each collector.</p>
      <ol class="public-snapshot__catalog">
        ${supportedCards.map((card) => `<li><span class="public-snapshot__card-number">${escapeHtml(card.number || "—")}</span><strong>${escapeHtml(card.name || "Unknown card")}</strong><span>${escapeHtml(card.rarity || "Rarity not specified")}</span></li>`).join("\n")}
      </ol>
    </section>`;

  return `<div class="public-snapshot public-snapshot--set" data-packdex-static-snapshot="${escapeHtml(setPath)}">
    ${productHeader()}
    <main id="main-content" class="public-snapshot__main">${content}</main>
    ${publicFooter()}
  </div>`;
}

function renderHowItWorksSnapshot() {
  const sections = [
    ["1. Choose a Set", "Start with the public set catalog and browse supported English-language Pokémon TCG sets by era. Each set page combines factual PackDex catalog information, collector-focused set highlights, a virtual pack-opening entry point, and collection tools."],
    ["2. Open a Virtual Pack", "PackDex uses its implemented set-specific pack configuration to assemble an entirely digital opening. Depending on the interface and selected reveal style, cards can be revealed one at a time or through the supported pack flow. The cards are virtual records and no physical product is opened, shipped, or awarded."],
    ["3. Build and Review Your Collection", "Cards from completed openings can be added to your PackDex collection. Set views organize collected and missing cards, quantities, completion progress, and card information so you can return to a set and continue your own collection goals."],
    ["4. Keep a Wishlist", "Wishlist controls keep cards you want to find separate from cards already collected. A wishlist is a personal chase list within PackDex; it is not an order, marketplace listing, or promise that a future opening will contain the card."],
    ["Guest and Account Use", "You can browse public set resources and use PackDex as a guest. Guest data is maintained on the current browser or device where supported. Creating an account enables PackDex's persistent account-based collection features across supported devices. Clearing local browser data can remove guest progress."],
    ["Card Values", "When supported pricing data is available, PackDex may show market estimates for informational collection tracking. Estimates can be delayed, incomplete, or change over time. PackDex does not buy or sell cards and does not provide a redemption value for virtual cards."],
    ["What the Simulation Represents", "PackDex recreates the experience of discovering and collecting cards online. Its results do not predict a physical booster, guarantee official pull rates, or establish the contents or value of any physical Pokémon TCG product. Every PackDex card and result remains virtual-only."],
  ];
  const content = sections.map(([heading, body]) => `
    <section class="public-snapshot__section">
      <h2>${escapeHtml(heading)}</h2>
      <p>${escapeHtml(body)}</p>
    </section>`).join("\n");

  return pageShell({
    pathname: PUBLIC_ROUTE_PATHS.howItWorks,
    eyebrow: "A virtual collector companion",
    title: "How PackDex Works",
    intro:
      "Choose a set, open a virtual pack, save the cards you discover, and use collection and wishlist tools to decide what to chase next.",
    content: `${content}<p class="public-snapshot__final-cta"><a class="public-snapshot__cta" href="/sets">Choose a Set</a></p>`,
  });
}

function renderFaqSnapshot() {
  return pageShell({
    pathname: PUBLIC_ROUTE_PATHS.faq,
    eyebrow: "Questions about virtual collecting",
    title: "PackDex FAQ",
    intro: "Answers to genuine questions about PackDex packs, collections, accounts, wishlists, values, and fan-made status.",
    content: `<section class="public-snapshot__section public-snapshot__faq">
      ${FAQ_ITEMS.map((item) => `<article><h2>${escapeHtml(item.question)}</h2><p>${escapeHtml(item.answer)}</p></article>`).join("\n")}
    </section>`,
  });
}

function renderAboutSnapshot() {
  const paragraphs = [
    "Hi, my name is Jonathan. I grew up loving collecting Pokémon cards. As I got older and tried to return to the hobby, I realized how much harder it had become to find packs and casually enjoy collecting the way I remembered.",
    "PackDex started as a simple project built around a simple idea: recreate some of the excitement of opening Pokémon cards while giving collectors a way to explore sets and keep track of everything they discover along the way.",
    "What began as a virtual pack-opening experiment grew into a larger collector companion with set tracking, wishlists, collection progress, card information, multiple opening styles, and support for Pokémon TCG sets across different eras.",
    "PackDex is built and maintained as an independent fan project. The focus is not on buying or selling cards, but on the collecting experience itself: discovering new cards, filling empty spots in a collection, learning more about different sets, and chasing a favorite card.",
    "PackDex continues to evolve through experimentation and feedback from the people who use it. New features, interface improvements, set support, and collection tools are added with the goal of making the virtual collecting experience more useful and enjoyable.",
    "PackDex is not affiliated with or endorsed by Nintendo, Creatures, GAME FREAK, The Pokémon Company, or any official Pokémon TCG partner. Pokémon names, imagery, card data, and related trademarks belong to their respective owners.",
  ];

  return pageShell({
    pathname: PUBLIC_ROUTE_PATHS.about,
    eyebrow: "An independent fan project",
    title: "About PackDex",
    intro: "A note from Jonathan about why PackDex exists and the collecting experience it is built to support.",
    content: `<section class="public-snapshot__section public-snapshot__prose">
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
    </section>`,
  });
}

function renderLegalDocument(type) {
  const document = LEGAL_DOCUMENTS[type];
  const content = `
    <section class="public-snapshot__section public-snapshot__legal">
      <p><strong>Last updated:</strong> ${escapeHtml(LEGAL_LAST_UPDATED)}</p>
      ${document.introduction.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
      ${document.sections.map((section) => `<section>
        <h2>${escapeHtml(section.title)}</h2>
        ${(section.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
        ${section.items?.length ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}</ul>` : ""}
        ${section.contact ? `<p>${escapeHtml(section.contact)} <a href="mailto:${escapeHtml(PACKDEX_SUPPORT_EMAIL)}">${escapeHtml(PACKDEX_SUPPORT_EMAIL)}</a>.</p>` : ""}
        ${type === "privacy" && section.title === "Advertising and Cookies" ? '<p>For more information, see <a href="https://policies.google.com/technologies/ads" rel="noopener noreferrer">Google\'s advertising privacy information</a>.</p>' : ""}
      </section>`).join("\n")}
    </section>`;

  return pageShell({
    pathname: PUBLIC_ROUTE_PATHS[type],
    eyebrow: "PackDex legal",
    title: document.title,
    intro: document.metaDescription,
    content,
    className: "public-snapshot--legal",
  });
}

function replaceHeadElement(html, matcher, replacement) {
  return matcher.test(html)
    ? html.replace(matcher, replacement)
    : html.replace("</head>", `    ${replacement}\n  </head>`);
}

function applySeoMetadata(template, pathname) {
  const seo = getPublicSeoDescriptor(pathname);
  let html = template;
  html = replaceHeadElement(html, /<title>[^<]*<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);
  html = replaceHeadElement(html, /<meta\s+[^>]*name=["']description["'][^>]*>/i, `<meta name="description" content="${escapeHtml(seo.description)}" />`);
  html = replaceHeadElement(html, /<meta\s+[^>]*name=["']robots["'][^>]*>/i, `<meta name="robots" content="${escapeHtml(seo.robots)}" />`);
  const canonicalMatcher = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;
  html = seo.canonicalUrl
    ? replaceHeadElement(html, canonicalMatcher, `<link rel="canonical" href="${escapeHtml(seo.canonicalUrl)}" />`)
    : html.replace(canonicalMatcher, "");
  html = replaceHeadElement(html, /<meta\s+[^>]*property=["']og:type["'][^>]*>/i, `<meta property="og:type" content="${escapeHtml(seo.openGraph.type)}" />`);
  html = replaceHeadElement(html, /<meta\s+[^>]*property=["']og:site_name["'][^>]*>/i, `<meta property="og:site_name" content="PackDex" />`);
  html = replaceHeadElement(html, /<meta\s+[^>]*property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${escapeHtml(seo.openGraph.title)}" />`);
  html = replaceHeadElement(html, /<meta\s+[^>]*property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${escapeHtml(seo.openGraph.description)}" />`);
  const openGraphUrlMatcher = /<meta\s+[^>]*property=["']og:url["'][^>]*>/i;
  html = seo.openGraph.url
    ? replaceHeadElement(html, openGraphUrlMatcher, `<meta property="og:url" content="${escapeHtml(seo.openGraph.url)}" />`)
    : html.replace(openGraphUrlMatcher, "");
  html = replaceHeadElement(html, /<meta\s+[^>]*property=["']og:image["'][^>]*>/i, `<meta property="og:image" content="${escapeHtml(seo.openGraph.image)}" />`);
  html = replaceHeadElement(html, /<meta\s+[^>]*name=["']twitter:card["'][^>]*>/i, `<meta name="twitter:card" content="${escapeHtml(seo.twitter.card)}" />`);
  html = replaceHeadElement(html, /<meta\s+[^>]*name=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${escapeHtml(seo.twitter.title)}" />`);
  html = replaceHeadElement(html, /<meta\s+[^>]*name=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${escapeHtml(seo.twitter.description)}" />`);
  html = replaceHeadElement(html, /<meta\s+[^>]*name=["']twitter:image["'][^>]*>/i, `<meta name="twitter:image" content="${escapeHtml(seo.twitter.image)}" />`);
  html = html.replace(/\s*<script\s+type=["']application\/ld\+json["']\s+data-packdex-static-json-ld[^>]*>[\s\S]*?<\/script>/gi, "");

  if (seo.jsonLd.length) {
    const scripts = seo.jsonLd.map((value) => {
      const json = JSON.stringify(value).replace(/</g, "\\u003c");
      return `    <script type="application/ld+json" data-packdex-static-json-ld>${json}</script>`;
    }).join("\n");
    html = html.replace("</head>", `${scripts}\n  </head>`);
  }

  return html;
}

const SNAPSHOT_STYLE = `<style data-packdex-static-snapshot-style>
  .public-snapshot{--pd-bg:#090d19;--pd-panel:#11172a;--pd-surface-soft:#0d1323;--pd-line:rgba(184,176,255,.16);--pd-text:#f8fbff;--pd-muted:#aab4d5;--pd-subtle:#7f8aa8;--pd-accent:#7c4dff;--pd-accent-hover:#8e68ff;--pd-accent-soft:rgba(124,77,255,.14);--pd-accent-text:#c8b9ff;min-height:100vh;background:var(--pd-bg);color:var(--pd-text);font-family:"Space Grotesk",system-ui,sans-serif;line-height:1.65}.public-snapshot *{box-sizing:border-box}.public-snapshot a{color:inherit}.public-snapshot__header,.public-snapshot__main,.public-snapshot__footer{width:min(1180px,calc(100% - 32px));margin-inline:auto}.public-snapshot__header{min-height:78px;display:flex;align-items:center;justify-content:space-between;gap:28px;border-bottom:1px solid var(--pd-line)}.public-snapshot__brand{display:flex;align-items:center;gap:10px;font-size:1.15rem;font-weight:800;text-decoration:none}.public-snapshot__brand img{border-radius:12px}.public-snapshot__header nav,.public-snapshot__footer nav{display:flex;flex-wrap:wrap;gap:20px}.public-snapshot__header nav a,.public-snapshot__footer nav a{text-decoration:none;color:var(--pd-muted)}.public-snapshot__header nav a:hover,.public-snapshot__header nav a:focus,.public-snapshot__footer nav a:hover,.public-snapshot__footer nav a:focus{color:var(--pd-text)}.public-snapshot__main{padding-block:64px}.public-snapshot__hero{max-width:820px;padding-bottom:28px}.public-snapshot__eyebrow{margin:0 0 8px;color:var(--pd-accent);font-size:.78rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.public-snapshot h1{font-size:clamp(2.2rem,7vw,4.8rem);line-height:1.02;letter-spacing:-.045em;margin:.1em 0 .32em}.public-snapshot h2{font-size:clamp(1.45rem,3vw,2.15rem);line-height:1.18;letter-spacing:-.025em}.public-snapshot h3{font-size:1.05rem}.public-snapshot__lead{font-size:clamp(1.05rem,2vw,1.3rem);color:var(--pd-muted);max-width:760px}.public-snapshot__section{margin:26px 0;padding:clamp(22px,4vw,38px);border:1px solid var(--pd-line);border-radius:22px;background:var(--pd-panel)}.public-snapshot__section>h2:first-child{margin-top:0}.public-snapshot__section p,.public-snapshot__legal li{color:var(--pd-muted)}.public-snapshot__cta{display:inline-flex;min-height:46px;align-items:center;padding:10px 18px;border-radius:999px;background:var(--pd-accent);color:#fff!important;font-weight:800;box-shadow:0 8px 18px rgba(81,43,180,.26);text-decoration:none}.public-snapshot__steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:0;list-style:none;counter-reset:steps}.public-snapshot__steps li{padding:20px;border-radius:16px;background:var(--pd-surface-soft);border:1px solid var(--pd-line)}.public-snapshot__faq{display:grid;gap:14px}.public-snapshot__faq article{padding:20px;border:1px solid var(--pd-line);border-radius:16px;background:var(--pd-surface-soft)}.public-snapshot__faq h2,.public-snapshot__faq h3{margin-top:0}.public-snapshot__set-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.public-snapshot__set-link{min-height:178px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:16px;border:1px solid var(--pd-line);border-radius:16px;background:var(--pd-surface-soft);text-decoration:none}.public-snapshot__set-link:hover,.public-snapshot__set-link:focus{border-color:var(--pd-accent)}.public-snapshot__set-link img{width:100%;height:78px;object-fit:contain;object-position:center}.public-snapshot__set-link span{font-size:.86rem;color:var(--pd-muted)}.public-snapshot__breadcrumbs{display:flex;gap:10px;color:var(--pd-muted);margin-bottom:20px}.public-snapshot__set-overview{display:grid;grid-template-columns:minmax(180px,320px) 1fr;gap:36px;align-items:center}.public-snapshot__set-logo{width:100%;max-height:220px;object-fit:contain}.public-snapshot__stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.public-snapshot__stats div{padding:14px;border-radius:14px;background:var(--pd-surface-soft)}.public-snapshot__stats dt{color:var(--pd-muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.07em}.public-snapshot__stats dd{margin:4px 0 0;font-weight:700}.public-snapshot__rarities{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0;list-style:none}.public-snapshot__rarities li{display:flex;justify-content:space-between;gap:16px;padding:10px 13px;border-radius:10px;background:var(--pd-surface-soft)}.public-snapshot__catalog{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;padding:0;list-style:none}.public-snapshot__catalog li{display:grid;grid-template-columns:minmax(42px,auto) 1fr;column-gap:9px;padding:10px 12px;border-radius:10px;background:var(--pd-surface-soft)}.public-snapshot__catalog li>span:last-child{grid-column:2;color:var(--pd-muted);font-size:.82rem}.public-snapshot__card-number{color:var(--pd-accent);font-variant-numeric:tabular-nums}.public-snapshot__legal>section{padding-top:16px;border-top:1px solid var(--pd-line)}.public-snapshot__footer{padding-block:34px 54px;border-top:1px solid var(--pd-line);color:var(--pd-muted);font-size:.9rem}.public-snapshot__footer p{max-width:900px}.public-snapshot__final-cta{text-align:center;padding-top:16px}.public-snapshot--sets .public-snapshot__main{padding-top:34px}.public-snapshot--sets .public-snapshot__hero{max-width:700px;padding-bottom:8px}.public-snapshot--sets .public-snapshot__hero h1{font-size:clamp(1.65rem,3vw,2.2rem);font-weight:650;letter-spacing:-.04em}.public-snapshot--sets .public-snapshot__lead{font-size:1rem}.public-snapshot--sets .public-snapshot__era{padding:24px 0;border-width:1px 0 0;border-radius:0;background:transparent}.public-snapshot--sets .public-snapshot__set-link{background:var(--pd-surface-soft)}.public-snapshot__pack-ready{min-height:520px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:18px 0 48px;text-align:center}.public-snapshot__pack-title{display:grid;justify-items:center;gap:8px}.public-snapshot__pack-title>span{color:var(--pd-accent-text);font-size:.78rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.public-snapshot--set .public-snapshot__pack-title h1{margin:0;color:var(--pd-text);font-size:clamp(1.35rem,3vw,1.85rem);font-weight:650;letter-spacing:-.03em}.public-snapshot__opening-logo{width:min(300px,75vw);height:92px;object-fit:contain}.public-snapshot__pack-stage{position:relative;width:min(290px,82vw);height:310px}.public-snapshot__pack-card,.public-snapshot__pack-art{position:absolute;inset:50% auto auto 50%;display:block;object-fit:contain}.public-snapshot__pack-card{width:168px;height:234px;border-radius:11px;box-shadow:0 18px 38px rgba(0,0,0,.32)}.public-snapshot__pack-card--back{transform:translate(-63%,-48%) rotate(-8deg);opacity:.58}.public-snapshot__pack-card--middle{transform:translate(-37%,-50%) rotate(8deg);opacity:.78}.public-snapshot__pack-art{width:196px;height:292px;transform:translate(-50%,-50%);filter:drop-shadow(0 20px 26px rgba(0,0,0,.4))}.public-snapshot__pack-actions{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px}.public-snapshot__pack-actions>a{min-height:44px;display:inline-flex;align-items:center;padding:9px 16px;border:1px solid var(--pd-line);border-radius:12px;color:var(--pd-muted);font-weight:700;text-decoration:none}.public-snapshot__pack-actions>a:hover,.public-snapshot__pack-actions>a:focus{color:var(--pd-text);border-color:rgba(184,176,255,.34);background:var(--pd-accent-soft)}.public-snapshot__pack-actions>.public-snapshot__cta{border-color:var(--pd-accent);color:#fff!important}.public-snapshot__pack-ready>p{max-width:620px;margin:0;color:var(--pd-muted);font-size:.88rem}.public-snapshot--set .public-snapshot__main{padding-top:28px}@media(max-width:900px){.public-snapshot__steps,.public-snapshot__set-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.public-snapshot__catalog,.public-snapshot__rarities{grid-template-columns:repeat(2,minmax(0,1fr))}.public-snapshot__set-overview{grid-template-columns:1fr}.public-snapshot__set-logo{max-width:330px;margin-inline:auto}.public-snapshot__stats{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.public-snapshot__pack-ready{min-height:470px;padding-bottom:34px}.public-snapshot__pack-stage{height:270px}.public-snapshot__pack-card{width:146px;height:204px}.public-snapshot__pack-art{width:174px;height:260px}.public-snapshot__pack-actions{width:100%}.public-snapshot__pack-actions>a{justify-content:center;flex:1 1 120px}.public-snapshot--sets .public-snapshot__main{padding-top:24px}.public-snapshot__header{align-items:flex-start;padding-block:16px;flex-direction:column}.public-snapshot__header nav{gap:14px;font-size:.9rem}.public-snapshot__main{padding-block:38px}.public-snapshot__section{padding:20px;border-radius:16px}.public-snapshot__steps,.public-snapshot__set-grid,.public-snapshot__catalog,.public-snapshot__rarities,.public-snapshot__stats{grid-template-columns:1fr}.public-snapshot__set-link{min-height:150px}.public-snapshot h1{font-size:clamp(2rem,13vw,3.2rem)}}
</style>`;

const PRODUCT_SNAPSHOT_STYLE = `<style data-packdex-product-snapshot-style>
  .public-snapshot__product-header{width:min(1180px,calc(100% - 32px));min-height:62px;display:flex;align-items:center;justify-content:space-between;gap:clamp(18px,3vw,42px);margin:14px auto 0;border:1px solid var(--pd-line);border-radius:20px;padding:10px 12px 10px 14px;background:var(--pd-panel);box-shadow:0 10px 28px rgba(0,0,0,.2)}
  .public-snapshot__product-header--pack-flow{width:min(720px,calc(100% - 32px))}
  .public-snapshot__product-brand{display:flex;align-items:center;gap:11px;text-decoration:none}
  .public-snapshot__product-brand img{width:40px;height:40px;border-radius:11px}
  .public-snapshot__wordmark{display:inline-flex;align-items:baseline;color:var(--pd-text);font-size:1.48rem;font-weight:700;letter-spacing:-.03em;line-height:1}
  .public-snapshot__wordmark>span:last-child{color:var(--pd-accent)}
  .public-snapshot__product-tabs{display:flex;gap:4px;border:1px solid var(--pd-line);border-radius:15px;padding:4px;background:var(--pd-surface-soft)}
  .public-snapshot__product-tabs a{min-height:38px;display:inline-flex;align-items:center;border-radius:11px;padding:0 13px;color:var(--pd-muted);font-size:.86rem;font-weight:700;text-decoration:none}
  .public-snapshot__product-tabs a:hover,.public-snapshot__product-tabs a:focus{color:var(--pd-text);background:var(--pd-accent-soft)}
  .public-snapshot__product-tabs a.is-active{color:#fff;background:var(--pd-accent);box-shadow:0 8px 18px rgba(81,43,180,.26)}
  .public-snapshot__featured-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:20px}.public-snapshot__featured-cards figure{min-width:0;margin:0}.public-snapshot__featured-cards img{width:100%;aspect-ratio:2.5/3.5;display:block;border-radius:8px;object-fit:cover}.public-snapshot__featured-cards figcaption{margin-top:5px;overflow:hidden;color:var(--pd-muted);font-size:.72rem;text-overflow:ellipsis;white-space:nowrap}.public-snapshot__special-feature{border:1px solid rgba(169,138,255,.28);border-radius:12px;padding:11px 13px;background:var(--pd-accent-soft);color:var(--pd-accent-text)!important}
  @media(max-width:560px){
    .public-snapshot__product-header{align-items:stretch;flex-direction:column;gap:8px;margin-top:10px;padding:9px}
    .public-snapshot__product-header--pack-flow{align-items:flex-start}
    .public-snapshot__product-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%}
    .public-snapshot__product-tabs a{justify-content:center;min-width:0;padding-inline:6px;text-align:center}
    .public-snapshot__featured-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
  }
</style>`;

export function renderSnapshotHtml(template, pathname, bodyMarkup) {
  let html = applySeoMetadata(template, pathname);
  if (!html.includes("data-packdex-static-snapshot-style")) {
    html = html.replace("</head>", `    ${SNAPSHOT_STYLE}\n  </head>`);
  }
  if (!html.includes("data-packdex-product-snapshot-style")) {
    html = html.replace("</head>", `    ${PRODUCT_SNAPSHOT_STYLE}\n  </head>`);
  }
  const rootPattern = /<div\s+id=["']root["']\s*><\/div>/i;
  if (!rootPattern.test(html)) throw new Error("Built desktop entry is missing an empty #root container");
  const rendered = html.replace(rootPattern, `<div id="root">${bodyMarkup}</div>`);
  return rendered
    .replace(/\r\r\n/g, "\r\n")
    .replace(/[ \t]+(?=\r?$)/gm, "");
}

export function getEmptyRootTemplate(html) {
  if (/<div\s+id=["']root["']\s*><\/div>/i.test(html)) return html;

  const rootOpening = /<div\s+id=["']root["']\s*>/i.exec(html);
  const bodyEnd = html.lastIndexOf("</body>");
  const rootClosingIndex = html.lastIndexOf("</div>", bodyEnd);
  if (!rootOpening || bodyEnd < 0 || rootClosingIndex < rootOpening.index) {
    throw new Error("Built desktop entry is missing a replaceable #root container");
  }

  const openingEnd = rootOpening.index + rootOpening[0].length;
  return `${html.slice(0, openingEnd)}</div>${html.slice(rootClosingIndex + "</div>".length)}`;
}

export function renderUtilityEntryHtml(template, pathname) {
  return applySeoMetadata(getEmptyRootTemplate(template), pathname)
    .replace(/\r\r\n/g, "\r\n")
    .replace(/[ \t]+(?=\r?$)/gm, "");
}

function snapshotDefinitions() {
  return [
    { pathname: "/", body: renderWelcomeSnapshot("/") },
    { pathname: PUBLIC_ROUTE_PATHS.welcome, body: renderWelcomeSnapshot(PUBLIC_ROUTE_PATHS.welcome) },
    { pathname: PUBLIC_ROUTE_PATHS.sets, body: renderSetsSnapshot() },
    { pathname: PUBLIC_ROUTE_PATHS.howItWorks, body: renderHowItWorksSnapshot() },
    { pathname: PUBLIC_ROUTE_PATHS.faq, body: renderFaqSnapshot() },
    { pathname: PUBLIC_ROUTE_PATHS.about, body: renderAboutSnapshot() },
    { pathname: PUBLIC_ROUTE_PATHS.privacy, body: renderLegalDocument("privacy") },
    { pathname: PUBLIC_ROUTE_PATHS.terms, body: renderLegalDocument("terms") },
    ...canonicalSetCatalog.map((entry) => ({ pathname: entry.path, body: renderSetSnapshot(entry) })),
  ];
}

export async function generatePublicSnapshots({ dist = defaultDist } = {}) {
  const rootEntry = path.join(dist, "index.html");
  const template = getEmptyRootTemplate(await fs.readFile(rootEntry, "utf8"));
  const definitions = snapshotDefinitions();

  for (const snapshot of definitions) {
    const renderedHtml = renderSnapshotHtml(template, snapshot.pathname, snapshot.body);
    if (snapshot.pathname === "/") {
      await fs.writeFile(rootEntry, renderedHtml, "utf8");
      continue;
    }

    const routePath = snapshot.pathname.replace(/^\/+|\/+$/g, "");
    // Cloudflare Pages serves `route.html` at the extensionless `/route` URL.
    // A directory index naturally represents `/route/`, so keep that only as
    // a backward-compatible trailing-slash copy with the canonical metadata.
    const canonicalOutputPath = path.join(dist, `${routePath}.html`);
    const trailingSlashOutputPath = path.join(dist, routePath, "index.html");
    await fs.mkdir(path.dirname(canonicalOutputPath), { recursive: true });
    await fs.mkdir(path.dirname(trailingSlashOutputPath), { recursive: true });
    await Promise.all([
      fs.writeFile(canonicalOutputPath, renderedHtml, "utf8"),
      fs.writeFile(trailingSlashOutputPath, renderedHtml, "utf8"),
    ]);
  }

  const utilityPaths = Object.values(UTILITY_ROUTE_PATHS);
  for (const pathname of utilityPaths) {
    const routePath = pathname.replace(/^\/+|\/+$/g, "");
    const outputPath = path.join(dist, `${routePath}.html`);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, renderUtilityEntryHtml(template, pathname), "utf8");
  }

  return Object.freeze({
    snapshotCount: definitions.length,
    setSnapshotCount: canonicalSetCatalog.length,
    utilityEntryCount: utilityPaths.length,
    dist,
  });
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const result = await generatePublicSnapshots();
  console.log(
    `Generated ${result.snapshotCount} public crawl snapshots (${result.setSnapshotCount} set pages) and ${result.utilityEntryCount} noindex utility entries in ${path.relative(repoRoot, result.dist)}.`
  );
}

export {
  FAQ_ITEMS,
  renderAboutSnapshot,
  renderFaqSnapshot,
  renderHowItWorksSnapshot,
  renderSetSnapshot,
  renderSetsSnapshot,
  renderWelcomeSnapshot,
};
