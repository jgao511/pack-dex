import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Layers3, Mail, PackageOpen, Search, Sparkles } from "lucide-react";
import PrivacyChoicesDialog from "./components/PrivacyChoicesDialog.jsx";
import { LEGAL_ROUTES, PACKDEX_SUPPORT_EMAIL } from "./content/legalDocuments.js";
import { openPrivacyChoices } from "./lib/privacyChoices.js";
import { getSetAssetUrl } from "./utils/assetUrls.js";
import { markWelcomeSeen } from "./welcomeEntry.js";

const APP_PATH = "/mobile-app/";
const DESKTOP_APP_PATH = "/?desktop=1";
const HERO_ROTATION_MS = 8500;

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
  { name: "Pitch Black", meta: "Mega Evolution", badge: "New", logo: "/set-logos/pitch-black.png" },
  { name: "151", meta: "Scarlet & Violet", badge: "Popular", logo: "/set-logos/151.png" },
  { name: "Prismatic Evolutions", meta: "Scarlet & Violet", badge: "Fan favorite", logo: "/set-logos/prismatic-evolutions.png" },
];

function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

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
  const href = mobile ? APP_PATH : DESKTOP_APP_PATH;
  const label = mobile ? "Open PackDex" : "Play PackDex on Desktop";

  return (
    <a
      className={`landing-button ${compact ? "landing-button--compact" : "landing-button--primary"}`}
      href={href}
      onClick={() => markWelcomeSeen(window)}
    >
      <span className="landing-button__wide-label">{label}</span>
      <span className="landing-button__short-label">{mobile ? "Open app" : "Play"}</span>
      <ArrowRight size={compact ? 17 : 18} aria-hidden="true" />
    </a>
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
          <a className="landing-footer__support" href={`mailto:${PACKDEX_SUPPORT_EMAIL}`}>
            <Mail size={16} aria-hidden="true" />
            {PACKDEX_SUPPORT_EMAIL}
          </a>
        </div>

        <nav className="landing-footer__links" aria-label="Product links">
          <strong>PackDex</strong>
          <a href={DESKTOP_APP_PATH} onClick={() => markWelcomeSeen(window)}>Play on desktop</a>
          <a href={APP_PATH} onClick={() => markWelcomeSeen(window)}>Open mobile app</a>
          <a href="/welcome">About PackDex</a>
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

  return (
    <div className="landing-site">
      <a className="landing-skip-link" href="#main-content">Skip to content</a>

      <header className="landing-header">
        <div className="landing-container landing-header__inner">
          <Brand />
          <nav className="landing-nav" aria-label="Main navigation">
            <a href="#experience">Experience</a>
            <a href="#collection">Collection</a>
            <a href="#explore">Explore</a>
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
                {!isMobileVisitor && (
                  <a className="landing-button landing-button--secondary" href={APP_PATH} onClick={() => markWelcomeSeen(window)}>
                    Open the Mobile App
                  </a>
                )}
              </div>
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
              <a className="landing-inline-link" href={isMobileVisitor ? APP_PATH : DESKTOP_APP_PATH} onClick={() => markWelcomeSeen(window)}>
                Start your collection <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="landing-section" id="explore" aria-labelledby="explore-title">
          <div className="landing-container">
            <div className="landing-section-heading landing-section-heading--split">
              <div>
                <span className="landing-eyebrow">Explore the catalog</span>
                <h2 id="explore-title">Move through eras, sets, and favorites.</h2>
              </div>
              <p>Browse every English Pokémon TCG set, from classic eras to the newest releases.</p>
            </div>

            <div className="landing-set-grid">
              {featuredSets.map((set) => (
                <a className="landing-set-card" href={isMobileVisitor ? APP_PATH : DESKTOP_APP_PATH} onClick={() => markWelcomeSeen(window)} key={set.name}>
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
