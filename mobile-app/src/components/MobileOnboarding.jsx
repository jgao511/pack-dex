import { useEffect, useMemo, useRef, useState } from "react";
import { welcomeHeroGroups } from "../../../src/data/welcomeHeroGroups.js";
import { useAnimatedCount } from "../../../src/hooks/useAnimatedCount.js";
import { getCardImageUrl, getSetLogoUrl, getSetPackArtUrl } from "../../../src/utils/assetUrls.js";
import { getSetCollectionProgress, markCardsCollected } from "../../../src/utils/collectionStorage.js";
import { formatPublicStat } from "../../../src/lib/publicPackDexStats.js";
import {
  getCommunityStatItems,
  getOnboardingConveyorCards,
  getTutorialShowcaseCards,
} from "../lib/mobileOnboarding.js";
import "./MobileOnboarding.css";

const HERO_ROTATION_MS = 8500;
const STAT_ROTATION_MS = 6500;
const STAT_SLIDE_INDEX = { packs: 0, cards: 1, popular: 2 };
const FEATURED_POKEMON_IDS = [6, 25, 384];
const WALKTHROUGH = [
  { anchor: "summary", title: "", copy: "View Pokédex information, type, generation, abilities, and details about your favorite Pokémon." },
  { anchor: "cards", title: "The complete card catalog", copy: "Browse every supported card featuring this Pokémon." },
  { anchor: "sets", title: "Find every set", copy: "See which sets each card comes from." },
];

function useReducedMotion(forced = false) {
  const [systemReduced, setSystemReduced] = useState(
    () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false
  );
  useEffect(() => {
    const media = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(Boolean(media?.matches));
    media?.addEventListener?.("change", update);
    return () => media?.removeEventListener?.("change", update);
  }, []);
  return forced || systemReduced;
}

function DeferredOnboardingImage({ src, delayMs = 0, className = "", ...props }) {
  const [resolvedSrc, setResolvedSrc] = useState(() => delayMs ? "" : src);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!delayMs) {
      setResolvedSrc(src);
      return undefined;
    }
    setLoaded(false);
    setResolvedSrc("");
    const timer = window.setTimeout(() => setResolvedSrc(src), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, src]);
  return (
    <img
      {...props}
      className={`${className} ${loaded ? "is-image-ready" : "is-image-pending"}`.trim()}
      src={resolvedSrc || undefined}
      onLoad={() => setLoaded(true)}
    />
  );
}

function OnboardingHeader({ allowSkip, onSkip, entrance = false }) {
  return (
    <header className={`onboarding-header ${entrance ? "onboarding-enter enter-brand" : ""}`}>
      <span className="onboarding-brand"><img src="/packdex-icon-192.png" alt="" /><strong>Pack<span>Dex</span></strong></span>
      {allowSkip && <button type="button" onClick={onSkip}>Skip</button>}
    </header>
  );
}

function HeroCards({ reducedMotion = false, entrance = false }) {
  const [index, setIndex] = useState(0);
  const group = welcomeHeroGroups[index];
  useEffect(() => {
    if (reducedMotion) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % welcomeHeroGroups.length), HERO_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);
  return (
    <div className={`onboarding-card-showcase ${entrance ? "onboarding-enter enter-cards" : ""}`} aria-label={`Featured cards from ${group.name}`}>
      <div className="onboarding-card-fan" key={group.id}>
        {group.cards.slice(0, 3).map((card, cardIndex) => (
          <img key={card.name} className={`card-${cardIndex + 1}`} src={card.src} alt={`${card.name} card`} />
        ))}
      </div>
      <div className={`onboarding-set-meta ${entrance ? "onboarding-enter enter-set-meta" : ""}`}>
        <img className="onboarding-featured-logo" src={group.logo} alt={group.logoAlt} />
        <div className="onboarding-dots" aria-hidden="true">
          {welcomeHeroGroups.map((item, dotIndex) => <i className={dotIndex === index ? "is-active" : ""} key={item.id} />)}
        </div>
      </div>
    </div>
  );
}

function WelcomeStep({ onStart, onSkip, devScenario }) {
  const reduced = useReducedMotion(devScenario?.reducedMotion);
  return (
    <section className={`onboarding-page onboarding-welcome ${reduced ? "is-reduced-motion" : ""}`}>
      <OnboardingHeader entrance />
      <HeroCards reducedMotion={reduced} entrance />
      <div className="onboarding-copy">
        <span className="eyebrow onboarding-enter enter-eyebrow">Open. Collect. Explore.</span>
        <h1 className="onboarding-enter enter-headline">Open packs. Build your collection. Chase every card.</h1>
        <p className="onboarding-enter enter-support">Start with a pack, discover your favorites, and build your collection.</p>
        <button className="primary-action onboarding-enter enter-action" type="button" onClick={onStart}>Get Started</button>
        <button className="onboarding-text-button onboarding-enter enter-action" type="button" onClick={onSkip}>Skip</button>
      </div>
    </section>
  );
}

function SetCardShowcase({ set, reducedMotion }) {
  const cards = useMemo(() => getTutorialShowcaseCards(set), [set]);
  return (
    <span className={`onboarding-set-showcase ${reducedMotion ? "is-static" : ""}`} aria-hidden="true">
      {cards.map((card, index) => (
        <img
          key={card.id}
          style={{ "--showcase-index": index }}
          src={getCardImageUrl(card)}
          alt=""
          loading="eager"
          decoding="async"
        />
      ))}
    </span>
  );
}

function SetChoiceStep({ tutorialSets, selectedSetId, onSelect, onOpen, onSkip, devScenario }) {
  const reduced = useReducedMotion(devScenario?.reducedMotion);
  return (
    <section className={`onboarding-page onboarding-set-choice ${reduced ? "is-reduced-motion" : ""}`}>
      <OnboardingHeader allowSkip onSkip={onSkip} />
      <div className="onboarding-title">
        <span className="eyebrow">Your first pull</span>
        <h1>Choose your first pack</h1>
        <p>Every collection starts somewhere. Choose a set to begin yours.</p>
      </div>
      <div className="onboarding-pack-options">
        {tutorialSets.map((set, index) => (
          <button
            className={`${selectedSetId === set.id ? "is-selected" : ""} onboarding-option-enter option-${index + 1}`}
            type="button"
            key={set.id}
            onClick={() => onSelect(set.id)}
          >
            <span className="onboarding-pack-art">
              <img className="onboarding-pack-logo-fallback" src={getSetLogoUrl(set)} alt="" />
              <img className="onboarding-pack-image" src={getSetPackArtUrl(set)} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
            </span>
            <span className="onboarding-pack-label">
              <em>{index === 0 ? "Newest set" : index === 1 ? "Classic favorite" : "Collector favorite"}</em>
              <strong>{set.name}</strong>
            </span>
            <SetCardShowcase set={set} reducedMotion={reduced} />
            <i aria-hidden="true" />
          </button>
        ))}
      </div>
      <button className="primary-action onboarding-sticky-action" type="button" disabled={!selectedSetId} onClick={onOpen}>Open This Pack</button>
    </section>
  );
}

function TutorialCollectionConveyor({ set, cards, reducedMotion, isCardDetailOpen, onInspectCard }) {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const trackCards = reducedMotion ? cards : [...cards, ...cards];
  return (
    <div className={`onboarding-tutorial-conveyor ${reducedMotion ? "is-static" : ""} ${visible && !isCardDetailOpen ? "" : "is-paused"}`} aria-label="Cards in your tutorial pack">
      <div className="onboarding-tutorial-conveyor-track">
        {trackCards.map((card, index) => {
          const isDuplicate = index >= cards.length;
          return (
            <button
              type="button"
              className="onboarding-tutorial-conveyor-card"
              key={`${card.id}-${index}`}
              onClick={() => !isDuplicate && onInspectCard?.(card, set, { origin: "onboarding-collection" })}
              tabIndex={isDuplicate ? -1 : undefined}
              aria-hidden={isDuplicate || undefined}
              aria-label={isDuplicate ? undefined : `Inspect ${card.name}`}
            >
              <img src={getCardImageUrl(card)} alt={isDuplicate ? "" : card.name} loading="eager" decoding="async" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CollectionStep({ set, cards, onContinue, onInspectCard, isCardDetailOpen, devScenario }) {
  const reduced = useReducedMotion(devScenario?.reducedMotion);
  const temporary = useMemo(() => markCardsCollected({}, cards, set.id, Date.now()), [cards, set.id]);
  const progress = getSetCollectionProgress(temporary, set);
  return (
    <section className="onboarding-page onboarding-collection">
      <OnboardingHeader />
      <div className="onboarding-title">
        <span className="eyebrow">Collect</span>
        <h1>Your pulls become part of your collection</h1>
        <p>Track every card you pull and complete your favorite sets.</p>
      </div>
      <section className="onboarding-collection-card">
        <header><img src={getSetLogoUrl(set)} alt="" /><span><strong>{set.name}</strong><small>{progress.collected} of {progress.total} cards</small></span><b>{progress.percent}%</b></header>
        <div className="onboarding-progress"><i style={{ width: `${progress.percent}%` }} /></div>
        <TutorialCollectionConveyor set={set} cards={cards} reducedMotion={reduced} isCardDetailOpen={isCardDetailOpen} onInspectCard={onInspectCard} />
      </section>
      <button className="primary-action onboarding-sticky-action" type="button" onClick={onContinue}>Discover Your Favorites</button>
    </section>
  );
}

function PokemonStep({ onSelect, devScenario }) {
  const reduced = useReducedMotion(devScenario?.reducedMotion);
  const [query, setQuery] = useState("");
  const [exploreCatalog, setExploreCatalog] = useState({ featured: [], search: null });
  useEffect(() => {
    let active = true;
    import("../explore/exploreData.js").then(({ groupedExploreSearch, speciesById }) => {
      if (!active) return;
      setExploreCatalog({
        featured: FEATURED_POKEMON_IDS.map((id) => speciesById.get(id)).filter(Boolean),
        search: groupedExploreSearch,
      });
    });
    return () => { active = false; };
  }, []);
  const results = useMemo(
    () => query.trim() && exploreCatalog.search ? exploreCatalog.search(query).pokemon.slice(0, 6) : [],
    [exploreCatalog.search, query]
  );
  return (
    <section className={`onboarding-page onboarding-pokemon is-entered ${reduced ? "is-reduced-motion" : ""}`}>
      <OnboardingHeader entrance />
      <div className="onboarding-title">
        <span className="eyebrow onboarding-pokemon-enter enter-pokemon-eyebrow">Explore</span>
        <h1 className="onboarding-pokemon-enter enter-pokemon-heading">Choose a Pokémon to explore</h1>
        <p className="onboarding-pokemon-enter enter-pokemon-support">See every card, set, and rarity featuring your favorites.</p>
      </div>
      <div className="onboarding-pokemon-grid">
        {FEATURED_POKEMON_IDS.map((id, index) => {
          const pokemon = exploreCatalog.featured.find((item) => item.id === id);
          return (
            <button className={`onboarding-pokemon-enter enter-pokemon-card-${index + 1} ${pokemon ? "" : "is-loading"}`} type="button" key={id} disabled={!pokemon} onClick={() => pokemon && onSelect(pokemon)}>
              <DeferredOnboardingImage
                src={pokemon?.artworkUrl || ""}
                delayMs={devScenario?.slowImages && pokemon ? 1500 + index * 350 : 0}
                alt=""
              />
              <strong>{pokemon?.displayName || <i aria-hidden="true" />}</strong>
              <span>{pokemon ? "Explore cards" : "Loading…"}</span>
            </button>
          );
        })}
      </div>
      <div className="onboarding-pokemon-search onboarding-pokemon-enter enter-pokemon-search">
        <label htmlFor="onboarding-pokemon-query">Or search for your favorite Pokémon</label>
        <input
          id="onboarding-pokemon-query"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Search Pokémon"
          value={query}
          disabled={!exploreCatalog.search}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.trim() && (
          <div className="onboarding-pokemon-results" role="listbox" aria-label="Pokémon search results">
            {results.length ? results.map((pokemon) => (
              <button type="button" key={pokemon.id} onClick={() => onSelect(pokemon)}>
                <img src={pokemon.artworkUrl} alt="" />
                <span><strong>{pokemon.displayName}</strong><small>#{String(pokemon.id).padStart(4, "0")}</small></span>
              </button>
            )) : <p>No matching Pokémon found.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function getTourTargetTop(root, target, stepIndex) {
  if (stepIndex === 0) return 0;
  const rootRect = root.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTop = root.scrollTop + targetRect.top - rootRect.top;
  const targetBottom = targetTop + targetRect.height;
  const safeTop = 12;
  const callout = root.parentElement?.querySelector(".onboarding-explore-callout");
  const calloutHeight = callout?.offsetHeight || 160;
  const safeBottom = root.scrollTop + root.clientHeight - calloutHeight - 20;

  if (stepIndex === 2) {
    const desiredTop = Math.max(safeTop, root.clientHeight - calloutHeight - targetRect.height - 30);
    return Math.max(0, targetTop - desiredTop);
  }

  if (targetTop < root.scrollTop + safeTop || targetBottom > safeBottom) {
    return Math.max(0, targetTop - safeTop);
  }
  return root.scrollTop;
}

function ExploreStep({ pokemon, children, onContinue, devScenario }) {
  const reduced = useReducedMotion(devScenario?.reducedMotion);
  const [index, setIndex] = useState(() => Math.max(0, Math.min(WALKTHROUGH.length - 1, Number(devScenario?.tourStep || 1) - 1)));
  const current = WALKTHROUGH[index];
  useEffect(() => {
    const root = document.querySelector(".onboarding-real-explore");
    if (!root) return undefined;
    let active = null;
    const focus = () => {
      active?.classList.remove("is-onboarding-spotlight");
      active = root.querySelector(`[data-onboarding-anchor="${current.anchor}"]`);
      if (!active) return false;
      active.classList.add("is-onboarding-spotlight");
      if (index === 2) {
        active.querySelector(".appears-in-conveyor")?.scrollTo({ left: 0, behavior: "auto" });
      }
      root.scrollTo({ top: getTourTargetTop(root, active, index), behavior: "auto" });
      return true;
    };
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    const frame = window.requestAnimationFrame(() => {
      if (focus()) observer.disconnect();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      active?.classList.remove("is-onboarding-spotlight");
      document.body.classList.remove("onboarding-tour-active");
      document.documentElement.classList.remove("onboarding-tour-active");
    };
  }, [current.anchor, index, reduced]);
  const advance = () => index === WALKTHROUGH.length - 1 ? onContinue() : setIndex((value) => value + 1);
  const title = index === 0 ? `Meet ${pokemon?.displayName || pokemon?.name || "this Pokémon"}` : current.title;
  return (
    <section className={`onboarding-page onboarding-explore ${reduced ? "is-reduced-motion" : ""}`} data-tour-step={index + 1}>
      <div className="onboarding-real-explore">{children}</div>
      <div className="onboarding-tour-dimmer" aria-hidden="true" />
      <aside className="onboarding-explore-callout" role="dialog" aria-label={`Explore walkthrough step ${index + 1} of ${WALKTHROUGH.length}`}>
        <span className="onboarding-tour-count">{index + 1} / {WALKTHROUGH.length}</span>
        <strong>{title}</strong>
        <p>{current.copy}</p>
        <div>
          <button className="onboarding-tour-skip" type="button" onClick={onContinue}>Skip Tour</button>
          <button type="button" onClick={advance}>{index === WALKTHROUGH.length - 1 ? "Continue" : "Next"}</button>
        </div>
      </aside>
    </section>
  );
}

function CardConveyor({ reducedMotion, slowImages = false }) {
  const cards = useMemo(() => getOnboardingConveyorCards(), []);
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const groups = reducedMotion ? [cards] : [cards, cards];
  return (
    <div className={`onboarding-conveyor ${reducedMotion ? "is-static" : ""} ${visible ? "" : "is-paused"}`} aria-label="Featured cards across PackDex eras">
      <div className="onboarding-conveyor-track">
        {groups.map((group, groupIndex) => (
          <div className="onboarding-conveyor-set" key={`group-${groupIndex}`} aria-hidden={groupIndex > 0 || undefined}>
            {group.map(({ set, card }, index) => (
              <DeferredOnboardingImage
                key={`${set.id}:${card.id}`}
                className={`card-composition-${(index % 5) + 1}`}
                src={getCardImageUrl(card)}
                delayMs={slowImages ? 1400 + (index % 4) * 260 : 0}
                alt={groupIndex === 0 ? `${card.name} from ${set.name}` : ""}
                loading="eager"
                decoding="async"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RotatingStat({ item, index, reducedMotion }) {
  const numeric = typeof item.rawValue === "number";
  const animated = useAnimatedCount(numeric ? item.rawValue : 0, {
    enabled: numeric,
    reducedMotion,
    animationKey: `${index}:${item.rawValue}`,
  });
  return (
    <div className={`onboarding-stat-value ${numeric ? "" : "is-text"}`} key={`${index}:${item.label}`}>
      <strong>{numeric ? formatPublicStat(animated) : item.value}</strong>
      <span>{item.label}</span>
    </div>
  );
}

function CommunityStep({ stats, isStatsLoading, user, isFinishing, error, onSignup, onLogin, onGuest, onFinishAccount, devScenario }) {
  const reduced = useReducedMotion(devScenario?.reducedMotion);
  const fixedStatIndex = STAT_SLIDE_INDEX[devScenario?.statSlide];
  const [index, setIndex] = useState(Number.isInteger(fixedStatIndex) ? fixedStatIndex : 0);
  const pageRef = useRef(null);
  const items = getCommunityStatItems(stats);
  useEffect(() => {
    if (reduced || Number.isInteger(fixedStatIndex) || items.length < 2) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % items.length), STAT_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [fixedStatIndex, items.length, reduced]);
  useEffect(() => {
    const reset = () => {
      if (pageRef.current) pageRef.current.scrollTop = 0;
      const screen = pageRef.current?.closest(".screen-content");
      if (screen) screen.scrollTop = 0;
      window.scrollTo?.(0, 0);
    };
    reset();
    const frame = window.requestAnimationFrame(reset);
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const safeIndex = items.length ? (Number.isInteger(fixedStatIndex) ? fixedStatIndex : index) % items.length : 0;
  return (
    <section ref={pageRef} className={`onboarding-page onboarding-community ${reduced ? "is-reduced-motion" : ""} ${devScenario?.shortViewport ? "is-dev-short-viewport" : ""}`}>
      <OnboardingHeader />
      <CardConveyor reducedMotion={reduced} slowImages={devScenario?.slowImages} />
      <div className={`onboarding-community-copy ${!isStatsLoading && !items.length ? "has-no-stat" : ""}`}>
        <div className="onboarding-community-intro">
          <span className="eyebrow">The PackDex community</span>
          <h1>Join hundreds of collectors on PackDex</h1>
        </div>
        {isStatsLoading ? (
          <div className="onboarding-stat is-loading" role="status" aria-label="Loading community activity"><i className="onboarding-stat-skeleton" aria-hidden="true" /></div>
        ) : items.length ? (
          <div className="onboarding-stat" aria-live="polite">
            <RotatingStat item={items[safeIndex]} index={safeIndex} reducedMotion={reduced} />
          </div>
        ) : (
          <div className="onboarding-stat is-empty" aria-hidden="true" />
        )}
        <div className="onboarding-community-account">
        <h2>{user ? "Save your tutorial pack" : "Create an account to save your progress"}</h2>
        <p>New members can unlock a free God Pack after opening 50 packs.</p>
        {error && <p className="onboarding-error">{error}</p>}
        {user ? (
          <button className="primary-action" type="button" disabled={isFinishing} onClick={onFinishAccount}>{isFinishing ? "Saving…" : "Save & Finish"}</button>
        ) : (
          <>
            <button className="primary-action" type="button" disabled={isFinishing} onClick={onSignup}>Create Account</button>
            <button className="secondary-action" type="button" disabled={isFinishing} onClick={onLogin}>Log In</button>
            <button className="onboarding-guest-link" type="button" disabled={isFinishing} onClick={onGuest}>Continue as guest</button>
          </>
        )}
        </div>
      </div>
    </section>
  );
}

export default function MobileOnboarding({ step, ...props }) {
  if (step === "welcome") return <WelcomeStep {...props} />;
  if (step === "choose-set") return <SetChoiceStep {...props} />;
  if (step === "collection") return <CollectionStep {...props} />;
  if (step === "pokemon") return <PokemonStep {...props} onSelect={props.onSelectPokemon} />;
  if (step === "explore") return <ExploreStep {...props} onContinue={props.onExploreContinue} />;
  if (step === "community") return <CommunityStep {...props} />;
  return null;
}
