import { useEffect, useRef, useState } from "react";
import "./landing.css";
import { ArrowRight, BookOpen, Layers3, Mail, PackageOpen, Search, Sparkles } from "lucide-react";
import PrivacyChoicesDialog from "./components/PrivacyChoicesDialog.jsx";
import { LEGAL_ROUTES, PACKDEX_SUPPORT_EMAIL } from "./content/legalDocuments.js";
import { openPrivacyChoices } from "./lib/privacyChoices.js";
import {
  formatPublicStat,
  getPublicPackDexStats,
  readCachedPublicPackDexStats,
} from "./lib/publicPackDexStats.js";
import { useAnimatedCount } from "./hooks/useAnimatedCount.js";
import { getSetAssetUrl } from "./utils/assetUrls.js";
import { markWelcomeSeen } from "./welcomeEntry.js";
import { BUY_ME_A_COFFEE_URL, isBuyMeACoffeeEnabled } from "./config/support.js";
import { AdSlot, AD_PLACEMENTS } from "./ads/index.js";
import { applySeoMetadata } from "./lib/useSeoMetadata.js";

const APP_PATH = "/mobile-app/";
const DESKTOP_APP_PATH = "/sets";
const HERO_ROTATION_MS = 8500;
const SITE_ORIGIN = "https://www.pack-dex.com";

function getLandingMetadata(pathname = "/") {
  const canonicalPath = pathname === "/welcome" ? "/welcome" : "/";
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;
  const title = "PackDex — Free Pokémon TCG Pack Opening & Collection";
  const description = "Open virtual Pokémon TCG packs, explore English-language sets, and track a digital collection with PackDex, a free fan-made collector companion.";
  const image = `${SITE_ORIGIN}/packdex-icon-192.png`;

  return {
    title,
    description,
    robots: "index, follow",
    canonicalUrl,
    openGraph: { type: "website", siteName: "PackDex", title, description, url: canonicalUrl, image },
    twitter: { card: "summary", title, description, image },
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebSite", name: "PackDex", url: `${SITE_ORIGIN}/`, description },
      { "@context": "https://schema.org", "@type": "WebApplication", name: "PackDex", url: `${SITE_ORIGIN}/`, applicationCategory: "GameApplication", operatingSystem: "Any modern web browser", description },
    ],
  };
}

const card = (name, path) => ({ name, src: getSetAssetUrl(path) });

const heroGroups = [
  {
    id: "151",
    name: "Scarlet & Violet—151",
    logo: "/set-logos/151.png",
    logoAlt: "Pokémon 151 set logo",
    cards: [
      card("Venusaur ex", "151/cards/198_Venusaur_ex_Special_Illustration_Rare.png"),
      card("Charizard ex", "151/cards/199_Charizard_ex_Special_Illustration_Rare.png"),
      card("Blastoise ex", "151/cards/200_Blastoise_ex_Special_Illustration_Rare.png"),
    ],
  },
  {
    id: "crown-zenith",
    name: "Crown Zenith",
    logo: "/set-logos/crown-zenith.png",
    logoAlt: "Crown Zenith set logo",
    cards: [
      card("Arceus VSTAR", "crown-zenith/cards/GG70_Arceus_VSTAR_Rare_Secret_swsh12pt5gg-gg70.png"),
      card("Giratina VSTAR", "crown-zenith/cards/GG69_Giratina_VSTAR_Rare_Secret_swsh12pt5gg-gg69.png"),
      card("Origin Forme Dialga VSTAR", "crown-zenith/cards/GG68_Origin_Forme_Dialga_VSTAR_Rare_Secret_swsh12pt5gg-gg68.png"),
      card("Origin Forme Palkia VSTAR", "crown-zenith/cards/GG67_Origin_Forme_Palkia_VSTAR_Rare_Secret_swsh12pt5gg-gg67.png"),
    ],
  },
  {
    id: "prismatic-evolutions",
    name: "Scarlet & Violet—Prismatic Evolutions",
    logo: "/set-logos/prismatic-evolutions.png",
    logoAlt: "Prismatic Evolutions set logo",
    cards: [
      card("Umbreon ex", "prismatic-evolutions/cards/161_Umbreon_ex_Special_Illustration_Rare.png"),
      card("Sylveon ex", "prismatic-evolutions/cards/156_Sylveon_ex_Special_Illustration_Rare.png"),
      card("Espeon ex", "prismatic-evolutions/cards/155_Espeon_ex_Special_Illustration_Rare.png"),
    ],
  },
  {
    id: "pitch-black",
    name: "Mega Evolution—Pitch Black",
    logo: "/set-logos/pitch-black.png",
    logoAlt: "Pitch Black set logo",
    cards: [
      card("Mega Zeraora ex", "pitch-black/cards/114_Mega_Zeraora_ex_Special_Illustration_Rare.png"),
      card("Mega Darkrai ex", "pitch-black/cards/116_Mega_Darkrai_ex_Special_Illustration_Rare.png"),
      card("Mega Chandelure ex", "pitch-black/cards/115_Mega_Chandelure_ex_Special_Illustration_Rare.png"),
    ],
  },
];

const collectionCards = [
  card("Eevee ex", "prismatic-evolutions/cards/167_Eevee_ex_Special_Illustration_Rare.png"),
  card("Umbreon ex", "prismatic-evolutions/cards/161_Umbreon_ex_Special_Illustration_Rare.png"),
  card("Charizard ex", "151/cards/199_Charizard_ex_Special_Illustration_Rare.png"),
  card("Giratina VSTAR", "crown-zenith/cards/GG69_Giratina_VSTAR_Rare_Secret_swsh12pt5gg-gg69.png"),
  card("Mega Gengar ex", "ascended-heroes/cards/284_Mega_Gengar_ex_Special_Illustration_Rare.png"),
  card("Mega Dragonite ex", "ascended-heroes/cards/290_Mega_Dragonite_ex_Special_Illustration_Rare.png"),
  card("Mega Darkrai ex", "pitch-black/cards/116_Mega_Darkrai_ex_Special_Illustration_Rare.png"),
  card("Pikachu", "151/cards/173_Pikachu_Illustration_Rare.png"),
  card("Sylveon ex", "prismatic-evolutions/cards/156_Sylveon_ex_Special_Illustration_Rare.png"),
  card("Origin Forme Dialga VSTAR", "crown-zenith/cards/GG68_Origin_Forme_Dialga_VSTAR_Rare_Secret_swsh12pt5gg-gg68.png"),
];

const featureCards = [
  {
    icon: PackageOpen,
    eyebrow: "Open",
    title: "Open virtual packs",
    description: "Choose from every English Pokémon TCG set, then reveal each card through PackDex’s interactive pack-opening experience.",
  },
  {
    icon: Layers3,
    eyebrow: "Collect",
    title: "Track your collection",
    description: "Save every pull, see what you own, and keep your cards organized by set.",
  },
  {
    icon: Search,
    eyebrow: "Explore",
    title: "Explore every era",
    description: "Browse Pokémon, cards, and English sets from across the history of the TCG.",
  },
  {
    icon: Sparkles,
    eyebrow: "Chase",
    title: "Pull your dream card",
    description: "Build your wishlist, chase the cards you love, and celebrate the pulls you have been waiting for.",
  },
];

const featuredSets = [
  {
    id: "pitch-black",
    name: "Pitch Black",
    meta: "Mega Evolution",
    badge: "New",
    logo: "/set-logos/pitch-black.png",
    href: "/set/pitch-black",
  },
  {
    id: "151",
    name: "151",
    meta: "Scarlet & Violet",
    badge: "Popular",
    logo: "/set-logos/151.png",
    href: "/set/pokemon-151",
  },
  {
    id: "prismatic-evolutions",
    name: "Prismatic Evolutions",
    meta: "Scarlet & Violet",
    badge: "Fan favorite",
    logo: "/set-logos/prismatic-evolutions.png",
    href: "/set/prismatic-evolutions",
  },
];

const howItWorksSteps = [
  {
    title: "Choose a Set",
    description:
      "Browse every English Pokémon TCG set across different eras and choose the one you want to explore. Move between generations, revisit old favorites, or discover sets you may have missed.",
  },
  {
    title: "Open a Virtual Pack",
    description:
      "Start an opening and reveal your cards one at a time. PackDex uses set-specific pack configurations to create a virtual opening experience while keeping every result entirely digital.",
  },
  {
    title: "Build Your Collection",
    description:
      "Cards you pull are added directly to your PackDex collection. Track progress by set, revisit cards you have already discovered, and see what you are still missing as you work toward your own collection goals.",
  },
  {
    title: "Find Your Next Chase",
    description:
      "Use your wishlist to keep track of cards you want to find, explore card information and available market estimates, and return to your favorite sets as your collection grows.",
  },
];

const faqPreview = [
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
];

function isNativeCapacitorRuntime() {
  try {
    return globalThis.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return prefersReducedMotion;
}

function Brand({ footer = false }) {
  return (
    <a className={`landing-brand${footer ? " landing-brand--footer" : ""}`} href="/welcome" aria-label="PackDex welcome page">
      <img src="/packdex-icon-192.png" width="38" height="38" alt="" />
      <span>
        Pack<span>Dex</span>
      </span>
    </a>
  );
}

function EntryButton({ mobile, compact = false }) {
  const href = DESKTOP_APP_PATH;
  const label = mobile ? "Open PackDex" : "Play PackDex on Desktop";

  return (
    <a
      className={`landing-button ${compact ? "landing-button--compact" : "landing-button--primary"}`}
      href={href}
      onClick={() => markWelcomeSeen(window)}
    >
      <span className="landing-button__wide-label">{label}</span>
      <span className="landing-button__short-label">{mobile ? "Open" : "Play"}</span>
      <ArrowRight size={compact ? 17 : 18} aria-hidden="true" />
    </a>
  );
}

function PublicActivityCounter({ reducedMotion }) {
  const [stats, setStats] = useState(
    () => readCachedPublicPackDexStats()?.stats || null
  );
  const [isLoading, setIsLoading] = useState(!stats);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const counterRef = useRef(null);
  const displayedCards = useAnimatedCount(stats?.cardsPulled || 0, {
    enabled: Boolean(stats && hasEnteredViewport),
    reducedMotion,
  });

  useEffect(() => {
    let isCurrent = true;

    getPublicPackDexStats()
      .then((nextStats) => {
        if (!isCurrent) return;
        setStats(nextStats);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isCurrent) return;
        setStats((current) => current || null);
        setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    const node = counterRef.current;
    if (!node) return undefined;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      setHasEnteredViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setHasEnteredViewport(true);
        observer.disconnect();
      },
      { threshold: 0.35 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);

  if (!stats && !isLoading) return null;

  return (
    <aside
      className={`landing-activity${stats ? " is-ready" : " is-loading"}`}
      ref={counterRef}
      aria-label="PackDex community activity"
      aria-busy={isLoading}
    >
      {stats ? (
        <>
          <strong className="landing-activity__number">
            {formatPublicStat(displayedCards)}
          </strong>
          <span className="landing-activity__label">cards pulled on PackDex</span>
          {stats.packsOpened != null && (
            <small>across {formatPublicStat(stats.packsOpened)} packs</small>
          )}
        </>
      ) : (
        <div className="landing-activity__skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </aside>
  );
}

function HeroShowcase({ reducedMotion }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const preloadedRef = useRef(new Set());
  const activeGroup = heroGroups[activeIndex];
  const isPaused = reducedMotion || hovered || focused || touched;

  useEffect(() => {
    const nextGroup = heroGroups[(activeIndex + 1) % heroGroups.length];
    nextGroup.cards.forEach(({ src }) => {
      if (preloadedRef.current.has(src)) return;
      const image = new Image();
      image.src = src;
      preloadedRef.current.add(src);
    });
    if (!preloadedRef.current.has(nextGroup.logo)) {
      const image = new Image();
      image.src = nextGroup.logo;
      preloadedRef.current.add(nextGroup.logo);
    }
  }, [activeIndex]);

  useEffect(() => {
    if (isPaused) return undefined;
    const intervalId = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % heroGroups.length);
    }, HERO_ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [isPaused]);

  return (
    <div
      className="landing-preview"
      aria-label="Curated PackDex card collection preview"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") setTouched(true);
      }}
      onPointerUp={() => setTouched(false)}
      onPointerCancel={() => setTouched(false)}
    >
      <div className="landing-preview__header">
        <div aria-live="polite">
          <span>Featured set</span>
          <strong>{activeGroup.name}</strong>
        </div>
        <img key={activeGroup.logo} src={activeGroup.logo} width="148" height="64" alt={activeGroup.logoAlt} />
      </div>
      <div
        className={`landing-card-fan landing-card-fan--${activeGroup.cards.length}`}
        key={activeGroup.id}
      >
        {activeGroup.cards.map((item, index) => (
          <img
            key={item.name}
            className={`landing-card-fan__card landing-card-fan__card--${index + 1}`}
            src={item.src}
            width="734"
            height="1024"
            alt={`${item.name} card artwork`}
            loading={activeIndex === 0 ? "eager" : "lazy"}
            fetchPriority={activeIndex === 0 && index === 1 ? "high" : "auto"}
          />
        ))}
      </div>
      <div className="landing-preview__controls" aria-label="Choose a featured card group">
        {heroGroups.map((group, index) => (
          <button
            className={index === activeIndex ? "is-active" : ""}
            type="button"
            key={group.id}
            onClick={() => setActiveIndex(index)}
            aria-label={`Show ${group.name}`}
            aria-pressed={index === activeIndex}
          />
        ))}
      </div>
    </div>
  );
}

function CollectionShowcase({ reducedMotion }) {
  const [touchPaused, setTouchPaused] = useState(false);
  const resumeTimerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(resumeTimerRef.current), []);

  function pauseForTouch() {
    setTouchPaused(true);
    window.clearTimeout(resumeTimerRef.current);
  }

  function resumeAfterTouch() {
    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => setTouchPaused(false), 2400);
  }

  return (
    <div className="landing-collection__showcase" aria-label="Example PackDex collection cards">
      <div className="landing-collection__toolbar">
        <div>
          <span>My collection</span>
          <strong>Recent highlights</strong>
        </div>
        <BookOpen size={21} aria-hidden="true" />
      </div>
      <div
        className={`landing-collection__cards${touchPaused ? " is-paused" : ""}`}
        tabIndex="0"
        aria-label={reducedMotion ? "Scrollable curated card highlights" : "Moving display case of curated card highlights"}
        onTouchStart={pauseForTouch}
        onTouchEnd={resumeAfterTouch}
        onTouchCancel={resumeAfterTouch}
      >
        <div className="landing-collection__track">
          {[...collectionCards, ...collectionCards].map((item, index) => {
            const duplicate = index >= collectionCards.length;
            return (
              <figure key={`${item.name}-${index}`} aria-hidden={duplicate || undefined}>
                <img
                  src={item.src}
                  width="734"
                  height="1024"
                  alt={duplicate ? "" : `${item.name} card artwork`}
                  loading="lazy"
                />
                <figcaption>{item.name}</figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <PrivacyChoicesDialog />
      <div className="landing-container landing-footer__grid">
        <div className="landing-footer__intro">
          <Brand footer />
          <p>A fan-made Pokémon TCG pack-opening and collection experience built for collectors.</p>
          <div className="landing-footer__support-actions">
            {isBuyMeACoffeeEnabled() && (
              <a
                className="landing-footer__support"
                href={BUY_ME_A_COFFEE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Buy Me a Coffee to support PackDex (opens in a new tab)"
                data-support-source="footer"
              >
                Buy Me a Coffee
              </a>
            )}
            <a className="landing-footer__support" href={`mailto:${PACKDEX_SUPPORT_EMAIL}`}>
              <Mail size={16} aria-hidden="true" />
              <span>Contact Support · {PACKDEX_SUPPORT_EMAIL}</span>
            </a>
          </div>
        </div>

        <nav className="landing-footer__links" aria-label="Product links">
          <strong>PackDex</strong>
          <a href={DESKTOP_APP_PATH} onClick={() => markWelcomeSeen(window)}>Play on desktop</a>
          <a href={APP_PATH} onClick={() => markWelcomeSeen(window)}>Open mobile app</a>
          <a href="/sets">Sets</a>
          <a href="/how-it-works">How It Works</a>
          <a href="/faq">FAQ</a>
          <a href="/about">About</a>
        </nav>

        <nav className="landing-footer__links" aria-label="Legal links">
          <strong>Legal</strong>
          <a href={LEGAL_ROUTES.privacy}>Privacy</a>
          <a href={LEGAL_ROUTES.terms}>Terms</a>
          <button type="button" onClick={(event) => openPrivacyChoices(event.currentTarget)}>
            Privacy Choices
          </button>
          <a href="/image-credits.html" target="_blank" rel="noopener noreferrer">Image Credits</a>
        </nav>

        <nav className="landing-footer__links" aria-label="Social links">
          <strong>Follow</strong>
          <a href="https://www.youtube.com/@pack-dex" target="_blank" rel="noopener noreferrer">YouTube</a>
          <a href="https://www.instagram.com/pack.dex/" target="_blank" rel="noopener noreferrer">Instagram</a>
        </nav>
      </div>

      <div className="landing-container landing-footer__bottom">
        <p>
          Fan-made Pokémon TCG pack-opening simulator. Not affiliated with Nintendo, Creatures, GAME FREAK, or The
          Pokémon Company. Simulated openings do not award physical cards, money, prizes, or redeemable items.
        </p>
        <span>© 2026 PackDex. All rights reserved.</span>
      </div>
    </footer>
  );
}

export default function LandingPage({ isMobileVisitor = false }) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    applySeoMetadata(getLandingMetadata(window.location.pathname));
  }, []);

  return (
    <div className="landing-site">
      <a className="landing-skip-link" href="#main-content">Skip to content</a>

      <header className="landing-header">
        <div className="landing-container landing-header__inner">
          <Brand />
          <nav className="landing-nav" aria-label="Main navigation">
            <a href="/sets">Sets</a>
            <a href="/how-it-works">How It Works</a>
            <a href="/faq">FAQ</a>
            <a href="/about">About</a>
          </nav>
          <EntryButton mobile={isMobileVisitor} compact />
        </div>
      </header>

      <main id="main-content">
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-container landing-hero__grid">
            <div className="landing-hero__copy">
              <span className="landing-eyebrow">Open. Collect. Discover.</span>
              <h1 id="landing-hero-title">Open packs. Build your collection.</h1>
              <p>
                Open virtual Pokémon TCG packs from every English set, chase your favorite cards, and watch your
                collection grow—all for free.
              </p>
              <div className="landing-free-row">
                <strong>100% free</strong>
                <span>No purchase needed</span>
              </div>
              <div className="landing-hero__actions">
                <EntryButton mobile={isMobileVisitor} />
                <a className="landing-button landing-button--secondary" href={APP_PATH} onClick={() => markWelcomeSeen(window)}>
                  Open the Mobile App
                </a>
              </div>
              <PublicActivityCounter reducedMotion={reducedMotion} />
            </div>

            <HeroShowcase reducedMotion={reducedMotion} />
          </div>
        </section>

        <section className="landing-section" id="experience" aria-labelledby="experience-title">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span className="landing-eyebrow">Made for the chase</span>
              <h2 id="experience-title">The full PackDex experience.</h2>
              <p>Open packs, pull your dream cards, and watch your collection grow.</p>
            </div>
            <div className="landing-feature-grid">
              {featureCards.map(({ icon: Icon, eyebrow, title, description }) => (
                <article className="landing-feature-card" key={title}>
                  <div className="landing-feature-card__icon" aria-hidden="true"><Icon size={22} /></div>
                  <span>{eyebrow}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--about" id="what-is-packdex" aria-labelledby="what-is-packdex-title">
          <div className="landing-container landing-about">
            <div className="landing-about__heading">
              <span className="landing-eyebrow">A collector companion</span>
              <h2 id="what-is-packdex-title">What is PackDex?</h2>
            </div>

            <div className="landing-about__copy">
              <p>
                PackDex is an unofficial, fan-made Pokémon TCG pack-opening simulator and collector companion built for
                fans who want to explore the franchise, learn more about different sets, and enjoy the collecting
                experience online.
              </p>
              <p>
                Anyone who has tried to get back into Pokémon cards lately knows how hard it can be to find packs in
                stores. PackDex gives you another way to explore the hobby: choose an English Pokémon TCG set and open a
                virtual pack directly in your browser.
              </p>
              <p>
                Each opening adds cards to your PackDex collection, where you can revisit your pulls, track progress
                toward completing sets, build a wishlist, and see which cards you are still missing.
              </p>
              <p>
                PackDex is designed as a collecting experience and companion rather than a marketplace or gambling
                platform. Virtual cards have no cash value, cannot be redeemed for physical cards or prizes, and cannot
                be bought or sold through PackDex.
              </p>
              <p className="landing-about__closing">
                Whether you want to revisit an older era, learn more about a set you never opened, or simply enjoy
                chasing a favorite card, PackDex gives you a free way to explore the Pokémon TCG and build a virtual
                collection at your own pace.
              </p>
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--collection" id="collection" aria-labelledby="collection-title">
          <div className="landing-container landing-collection">
            <CollectionShowcase reducedMotion={reducedMotion} />

            <div className="landing-collection__copy">
              <span className="landing-eyebrow">Your pulls, organized</span>
              <h2 id="collection-title">Watch your collection grow.</h2>
              <p>
                Every pack adds something new. Revisit your pulls, see what you own, track what is missing, and save the
                cards you still want to chase.
              </p>
              <ul>
                <li>Collection totals and set progress</li>
                <li>Personal and master-set binders</li>
                <li>Wishlist and collection-value tracking</li>
                <li>Sync across supported devices</li>
              </ul>
              <a className="landing-inline-link" href={DESKTOP_APP_PATH} onClick={() => markWelcomeSeen(window)}>
                Start your collection <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--process" id="how-it-works" aria-labelledby="how-it-works-title">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span className="landing-eyebrow">From set to collection</span>
              <h2 id="how-it-works-title">How PackDex Works</h2>
              <p>Choose what to explore, enjoy the reveal, and keep building a collection that is yours.</p>
            </div>

            <ol className="landing-process-grid">
              {howItWorksSteps.map((step, index) => (
                <li className="landing-process-card" key={step.title}>
                  <span className="landing-process-card__number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </li>
              ))}
            </ol>

            <div className="landing-process-note">
              <p>
                PackDex is a simulator and collector companion, not a prediction of what will appear in a physical
                Pokémon TCG product. Virtual results exist only within PackDex.
              </p>
              <a className="landing-inline-link" href="/how-it-works">
                Learn more about how PackDex works <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <AdSlot
          className="landing-container landing-ad-zone"
          placement={AD_PLACEMENTS.CONTENT}
          context={{ contentReady: true, screen: "welcome-content" }}
          isNative={isNativeCapacitorRuntime()}
        />

        <section className="landing-section" id="explore" aria-labelledby="explore-title">
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading--explore">
              <span className="landing-eyebrow">Explore the catalog</span>
              <h2 id="explore-title">Explore the Pokémon TCG Across Eras</h2>
              <div className="landing-explore-copy">
                <p>
                  Pokémon cards have changed significantly across generations, and part of the fun of PackDex is moving
                  between them. Explore sets from different eras, compare their cards and rarities, and build separate
                  collection progress for the sets you care about most.
                </p>
                <p>
                  Jump into a familiar favorite or discover cards from an era you may have missed. Each set gives you
                  another collection to work toward, giving you a reason to revisit older releases even after you begin
                  exploring newer ones.
                </p>
                <p>
                  PackDex brings English-language sets together in one collection experience so your virtual collection
                  can grow across generations.
                </p>
              </div>
              <a className="landing-inline-link landing-inline-link--catalog" href="/sets">
                Explore All Sets <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>

            <div className="landing-set-grid">
              {featuredSets.map((set) => (
                <a className="landing-set-card" href={set.href} key={set.id}>
                  <div className="landing-set-card__logo">
                    <span className="landing-set-card__badge">{set.badge}</span>
                    <img src={set.logo} width="200" height="92" alt={`${set.name} set logo`} loading="lazy" />
                  </div>
                  <div>
                    <span>{set.meta}</span>
                    <strong>{set.name}</strong>
                  </div>
                  <ArrowRight size={19} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--faq" id="faq-preview" aria-labelledby="faq-preview-title">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span className="landing-eyebrow">Questions, answered</span>
              <h2 id="faq-preview-title">PackDex FAQ</h2>
              <p>The essentials about virtual cards, accounts, and what a PackDex opening represents.</p>
            </div>

            <div className="landing-faq-grid">
              {faqPreview.map((item) => (
                <article className="landing-faq-card" key={item.question}>
                  <h3>{item.question}</h3>
                  <p>{item.answer}</p>
                </article>
              ))}
            </div>

            <a className="landing-inline-link landing-inline-link--faq" href="/faq">
              View All FAQs <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="landing-cta" aria-labelledby="landing-cta-title">
          <div className="landing-container landing-cta__inner">
            <img src="/packdex-icon-192.png" width="74" height="74" alt="" />
            <div>
              <span className="landing-eyebrow">Ready for your next pull?</span>
              <h2 id="landing-cta-title">Your PackDex is ready.</h2>
              <p>Play fully on desktop, or open the mobile app for the newest features first.</p>
            </div>
            <EntryButton mobile={isMobileVisitor} />
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
