import { useMemo } from "react";
import { ArrowRight, Check, CircleHelp, Heart, Layers3, PackageOpen, Search } from "lucide-react";
import PublicLayout from "./public/PublicLayout.jsx";
import { getStaticPublicSeoDescriptor } from "./lib/staticPublicSeo.js";
import useSeoMetadata from "./lib/useSeoMetadata.js";
import { LEGAL_DOCUMENTS, LEGAL_LAST_UPDATED, PACKDEX_SUPPORT_EMAIL } from "./content/legalDocuments.js";
import { AdSlot, AD_PLACEMENTS } from "./ads/index.js";
import "./public.css";

export const PACKDEX_FAQS = [
  {
    question: "Is PackDex free to play?",
    answer: "Yes. PackDex is 100% free to play. You can open virtual packs and explore the platform without purchasing physical cards or virtual currency. Cards obtained through PackDex exist only within the simulator and have no redeemable cash value.",
  },
  {
    question: "Are the cards I pull real?",
    answer: "No. Every PackDex opening is virtual. Cards pulled on PackDex cannot be shipped, redeemed, exchanged for money, converted into prizes, or sold through PackDex.",
  },
  {
    question: "Do I need an account?",
    answer: "No. You can explore PackDex and open packs as a guest. Creating an account lets PackDex maintain a persistent collection and supported account features across devices. Guest data remains on the browser or device where it was created unless you sign in and synchronize it.",
  },
  {
    question: "Are PackDex openings the same as physical Pokémon TCG packs?",
    answer: "No. PackDex is an independent simulator designed to recreate the fun of opening and collecting cards digitally. Virtual results should not be interpreted as a guarantee or prediction of what a particular physical Pokémon TCG pack will contain.",
  },
  {
    question: "How do I track my collection?",
    answer: "Cards you pull can be added to your PackDex collection and organized by set. You can see what you have collected, what you are still missing, and your progress toward completing individual sets.",
  },
  {
    question: "What is the PackDex wishlist?",
    answer: "The wishlist gives you a separate place to keep track of cards you still want to find. Save missing favorites and use the wishlist as your personal chase list while exploring different sets.",
  },
  {
    question: "What do the card values mean?",
    answer: "PackDex may display estimated market information for supported cards when pricing data is available. These values are provided for informational and collection-tracking purposes and can change over time. PackDex does not buy or sell the cards displayed in the app.",
  },
  {
    question: "Can I complete an entire set?",
    answer: "Yes. PackDex lets you track progress through individual sets so you can keep opening virtual packs, revisit your collection, and see which cards you still need.",
  },
  {
    question: "Is PackDex an official Pokémon product?",
    answer: "No. PackDex is an unofficial, fan-made project and is not affiliated with, endorsed by, or sponsored by Nintendo, Creatures, GAME FREAK, The Pokémon Company, or any official Pokémon TCG partner. Pokémon names, imagery, card data, and related trademarks belong to their respective owners.",
  },
];

const HOW_STEPS = [
  {
    number: "01",
    icon: Search,
    title: "Choose a Set",
    paragraphs: [
      "Browse the English Pokémon TCG catalog across different eras and choose a set to explore. Move between generations, revisit old favorites, or discover cards you may have missed.",
      "Each public set page combines factual set highlights, featured cards and Pokémon where available, a card checklist, and your own collection progress.",
    ],
  },
  {
    number: "02",
    icon: PackageOpen,
    title: "Open a Virtual Pack",
    paragraphs: [
      "Start an opening and reveal the cards using the opening style available on your device. PackDex uses its existing set-specific pack configuration to assemble each digital opening.",
      "Some sets use different pack sizes, rarity positions, subset handling, or special simulator formats. The notes on each set page explain those implemented differences without presenting PackDex rules as official physical pull rates.",
    ],
  },
  {
    number: "03",
    icon: Layers3,
    title: "Build Your Collection",
    paragraphs: [
      "Cards you pull are added to the PackDex collection on your current browser or account. Track completion by set, filter collected and missing cards, and revisit card details as the collection grows.",
      "Guests can explore and collect locally. Signing in supports persistent account-based collection features and synchronization across supported devices.",
    ],
  },
  {
    number: "04",
    icon: Heart,
    title: "Find Your Next Chase",
    paragraphs: [
      "Use the wishlist to remember cards you want to find, then return to the sets that contain them. When PackDex has pricing information, displayed values are changing third-party estimates for reference—not an offer to buy or sell.",
      "All PackDex cards remain virtual. They cannot be shipped, redeemed, converted to prizes, or exchanged for cash.",
    ],
  },
];

function PageIntro({ eyebrow, title, children }) {
  return (
    <header className="public-page-intro public-shell public-reading-width">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      {children}
    </header>
  );
}

function FaqPage({ pathname }) {
  return (
    <PublicLayout>
      <PageIntro eyebrow="Questions, answered" title="PackDex FAQ">
        <p>Clear answers about virtual packs, collections, accounts, card values, and what PackDex is—and is not.</p>
      </PageIntro>
      <section className="public-shell public-reading-width public-faq" aria-label="Frequently asked questions">
        {PACKDEX_FAQS.map((faq, index) => (
          <div key={faq.question}>
            <details open={index === 0}>
              <summary><span>{String(index + 1).padStart(2, "0")}</span>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
            {index === 3 && (
              <AdSlot placement={AD_PLACEMENTS.CONTENT} pathname={pathname} context={{ contentReady: true, screen: "faq" }} />
            )}
          </div>
        ))}
      </section>
    </PublicLayout>
  );
}

function AboutPage({ pathname }) {
  return (
    <PublicLayout>
      <PageIntro eyebrow="An independent fan project" title="About PackDex">
        <p>Hi, my name is Jonathan. I grew up loving collecting Pokémon cards. As I got older and tried to return to the hobby, I realized how much harder it had become to find packs and casually enjoy collecting the way I remembered.</p>
      </PageIntro>
      <article className="public-shell public-reading-width public-prose">
        <h2>Built around the collecting experience</h2>
        <p>PackDex started as a simple project built around a simple idea: recreate some of the excitement of opening Pokémon cards while giving collectors a way to explore sets and keep track of everything they discover along the way.</p>
        <p>What began as a virtual pack-opening experiment grew into a larger collector companion with set tracking, wishlists, collection progress, card information, multiple opening styles, and support for Pokémon TCG sets across different eras.</p>
        <p>PackDex is built and maintained as an independent fan project. The focus is not on buying or selling cards, but on the collecting experience itself: discovering new cards, filling empty spots in a collection, learning more about different sets, and chasing a favorite card.</p>
        <AdSlot placement={AD_PLACEMENTS.CONTENT} pathname={pathname} context={{ contentReady: true, screen: "about" }} />
        <h2>Still evolving</h2>
        <p>PackDex continues to evolve through experimentation and feedback from the people who use it. New features, interface improvements, set support, and collection tools are added with the goal of making the virtual collecting experience more useful and enjoyable.</p>
        <p>PackDex is not affiliated with or endorsed by Nintendo, Creatures, GAME FREAK, The Pokémon Company, or any official Pokémon TCG partner. Pokémon names, imagery, card data, and related trademarks belong to their respective owners.</p>
      </article>
    </PublicLayout>
  );
}

function HowItWorksPage({ pathname }) {
  return (
    <PublicLayout>
      <PageIntro eyebrow="The PackDex loop" title="How PackDex Works">
        <p>PackDex combines virtual openings with a set browser, collection checklist, wishlists, and card information. Here is what happens from choosing a set to finding the next card you want to chase.</p>
      </PageIntro>
      <div className="public-shell public-reading-width public-how-list">
        {HOW_STEPS.map(({ number, icon: Icon, title, paragraphs }, index) => (
          <div key={title}>
            <section>
              <div className="public-how-list__icon"><Icon aria-hidden="true" /><span>{number}</span></div>
              <div><h2>{title}</h2>{paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
            </section>
            {index === 1 && (
              <AdSlot placement={AD_PLACEMENTS.CONTENT} pathname={pathname} context={{ contentReady: true, screen: "how-it-works" }} />
            )}
          </div>
        ))}
        <aside className="public-simulation-note">
          <Check aria-hidden="true" />
          <div><h2>What a simulation represents</h2><p>PackDex is a simulator and collector companion, not a prediction of what will appear in a physical Pokémon TCG product. Virtual results exist only within PackDex.</p></div>
        </aside>
      </div>
    </PublicLayout>
  );
}

function LegalPage({ page }) {
  const document = LEGAL_DOCUMENTS[page];
  return (
    <PublicLayout>
      <PageIntro eyebrow="PackDex legal" title={document.title}>
        {document.introduction.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <p className="public-page-note">Last updated {LEGAL_LAST_UPDATED}</p>
      </PageIntro>
      <article className="public-shell public-reading-width public-legal">
        {document.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
            {section.contact && <p>{section.contact} <a href={`mailto:${PACKDEX_SUPPORT_EMAIL}`}>{PACKDEX_SUPPORT_EMAIL}</a>.</p>}
            {page === "privacy" && section.title === "Advertising and Cookies" && (
              <p>For more information, see <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">Google's advertising privacy information</a>.</p>
            )}
          </section>
        ))}
      </article>
    </PublicLayout>
  );
}

function NotFoundPage() {
  return (
    <PublicLayout>
      <section className="public-shell public-reading-width public-not-found">
        <CircleHelp aria-hidden="true" />
        <span>404</span>
        <h1>That PackDex page was not found</h1>
        <p>The link may be outdated, or the set slug may not match a supported English set.</p>
        <div><a className="public-primary-link" href="/sets">Explore all sets <ArrowRight size={17} aria-hidden="true" /></a><a href="/">Return home</a></div>
      </section>
    </PublicLayout>
  );
}

export default function PublicPages({ pathname = window.location.pathname, page }) {
  const descriptor = useMemo(() => getStaticPublicSeoDescriptor(pathname), [pathname]);
  useSeoMetadata(descriptor);

  if (page === "faq") return <FaqPage pathname={pathname} />;
  if (page === "about") return <AboutPage pathname={pathname} />;
  if (page === "howItWorks") return <HowItWorksPage pathname={pathname} />;
  if (page === "privacy" || page === "terms") return <LegalPage page={page} />;
  return <NotFoundPage />;
}
