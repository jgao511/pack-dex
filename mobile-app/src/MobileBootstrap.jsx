import { useEffect, useMemo, useState } from "react";
import { setCatalogMetadata } from "../../src/lib/setRouteCatalog.js";
import { welcomeHeroGroups } from "../../src/data/welcomeHeroGroups.js";
import {
  claimMobileBootstrapSetIntent,
  setPendingMobileBootstrapCollectionSetId,
  setPendingMobileBootstrapOpenRequested,
  setPendingMobileBootstrapOnboardingAction,
  setPendingMobileBootstrapSetId,
  setPendingMobileBootstrapTab,
} from "./lib/mobileBootstrapIntent.js";
import { writeMobileOnboardingBootstrapState } from "./lib/mobileOnboardingBootstrap.js";
import { loadRevealStyle, saveRevealStyle } from "./lib/revealStyle.js";
import PackDexStartupAnimation from "./components/PackDexStartupAnimation.jsx";
import "./components/MobileOnboarding.css";

const ERA_ORDER = ["Mega Evolution", "Scarlet & Violet", "Sword & Shield", "Sun & Moon", "XY", "Vintage"];

function sortSetsByEra(setList) {
  return [...setList].sort((left, right) => {
    const releaseOrder = String(right.releaseDate || "").localeCompare(String(left.releaseDate || ""));
    if (releaseOrder) return releaseOrder;
    const leftEra = ERA_ORDER.indexOf(left.era);
    const rightEra = ERA_ORDER.indexOf(right.era);
    if (leftEra !== rightEra) return (leftEra < 0 ? 99 : leftEra) - (rightEra < 0 ? 99 : rightEra);
    return left.name.localeCompare(right.name);
  });
}

function groupSetsByEra(setList) {
  return setList.reduce((groups, set) => {
    const era = set.era || "Other";
    (groups[era] ||= []).push(set);
    return groups;
  }, {});
}

function BootstrapBrand() {
  return (
    <header className="mobile-brand-header" aria-label="PackDex mobile app">
      <img src="/packdex-icon-192.png" alt="" />
      <span className="mobile-wordmark"><span>Pack</span><span>Dex</span></span>
    </header>
  );
}

function claimBootstrapSetIntent(set) {
  return claimMobileBootstrapSetIntent(set?.id);
}

function BootstrapTabs({ activeTab = "open", onNeedApp }) {
  return (
    <nav className="bottom-tabs" aria-label="Mobile app sections">
      {[
        ["open", "Open"],
        ["collection", "Collection"],
        ["explore", "Explore"],
        ["profile", "Profile"],
      ].map(([id, label]) => (
        <button
          className={id === activeTab ? "is-active" : ""}
          key={id}
          type="button"
          onPointerDown={(event) => {
            if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
            onNeedApp(id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onNeedApp(id);
          }}
          onClick={() => onNeedApp(id)}
        >
          <span className={`mobile-icon mobile-icon-${id === "open" ? "pack" : id === "collection" ? "book" : id}`} aria-hidden="true"><i /><i /><i /></span>
          {label}
        </button>
      ))}
    </nav>
  );
}

function MobileTabBootstrap({ tab }) {
  return (
    <main className="mobile-app theme-dark" data-packdex-mobile-loading-fallback>
      <section className="phone-shell" aria-label="PackDex mobile app">
        <div className={`screen-content screen-${tab}`}>
          <PackDexStartupAnimation delayed />
        </div>
      </section>
    </main>
  );
}

function MobilePackReadyBootstrap({ set, onBack, onNeedApp }) {
  const [revealStyle, setRevealStyle] = useState(loadRevealStyle);
  const [openRequested, setOpenRequested] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const readyAt = performance.now();
      window.__packdexPerformance = {
        ...(window.__packdexPerformance || {}),
        mobileBootstrapPackReadyShell: readyAt,
      };
      document.documentElement.dataset.packdexMobileBootstrapPackReadyShell = String(readyAt);
      performance.mark?.("packdex-mobile-bootstrap-pack-ready-shell");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [set.id]);

  const queueCollection = () => {
    setPendingMobileBootstrapCollectionSetId(set.id);
    setPendingMobileBootstrapTab("collection");
    onNeedApp("collection");
  };
  const queueOpen = () => {
    setPendingMobileBootstrapOpenRequested(true);
    setOpenRequested(true);
    onNeedApp("open");
  };
  const back = () => onBack();

  return (
    <section className="pack-stage is-ready mobile-bootstrap-pack-ready" aria-label={`${set.name} Pack Ready`}>
      <div className="pack-ready-artwork">
        <span className="eyebrow">Pack Ready</span>
        <img className="pack-logo" src={`/set-logos/${set.setFolder || set.id}.png`} alt={`${set.name} logo`} loading="eager" fetchPriority="high" decoding="async" />
        <div className="card-stack is-floating" aria-hidden="true">
          <div><img src="/card-back.webp" alt="" decoding="async" /></div>
          <div><img src="/card-back.webp" alt="" decoding="async" /></div>
          <div><img src="/card-back.webp" alt="" decoding="async" /></div>
        </div>
      </div>
      <div className="pack-ready-actions">
        <p className="account-notice is-skeleton" role="status" aria-label="Loading account status">
          <span className="mobile-skeleton-block is-account-line" aria-hidden="true" />
          <span className="mobile-skeleton-block is-account-line-short" aria-hidden="true" />
        </p>
        <select
          className="pack-ready-reveal-select"
          aria-label="Reveal Style"
          title="Reveal Style"
          value={revealStyle}
          onChange={(event) => {
            const next = saveRevealStyle(event.target.value);
            setRevealStyle(next);
          }}
        >
          <option value="automatic">Automatic</option>
          <option value="tap">Tap</option>
          <option value="swipe">Swipe</option>
        </select>
        <div className="pack-actions">
          <button
            className="secondary-action"
            type="button"
            onPointerDown={(event) => {
              if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
              back();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") back();
            }}
            onClick={back}
          >Back to Sets</button>
          <button
            className="secondary-action"
            type="button"
            onPointerDown={(event) => {
              if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
              queueCollection();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") queueCollection();
            }}
            onClick={queueCollection}
          >View Collection</button>
          <button
            className="primary-action"
            type="button"
            disabled={openRequested}
            onPointerDown={(event) => {
              if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
              queueOpen();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") queueOpen();
            }}
            onClick={queueOpen}
          >{openRequested ? "Preparing Pack" : "Click to Open"}</button>
        </div>
      </div>
    </section>
  );
}

function getTutorialMetadata() {
  const today = new Date().toISOString().slice(0, 10);
  const newest = [...setCatalogMetadata]
    .filter((set) => String(set.releaseDate || "") <= today)
    .sort((left, right) => String(right.releaseDate || "").localeCompare(String(left.releaseDate || "")))[0];
  return [...new Set([newest?.id, "151", "prismatic-evolutions"].filter(Boolean))]
    .map((id) => setCatalogMetadata.find((set) => set.id === id))
    .filter(Boolean);
}

function BootstrapHeroCards() {
  const [index, setIndex] = useState(0);
  const group = welcomeHeroGroups[index];
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % welcomeHeroGroups.length), 8500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="onboarding-card-showcase onboarding-enter enter-cards" aria-label={`Featured cards from ${group.name}`}>
      <div className="onboarding-card-fan" key={group.id}>
        {group.cards.slice(0, 3).map((card, cardIndex) => <img key={card.name} className={`card-${cardIndex + 1}`} src={card.src} alt={`${card.name} card`} />)}
      </div>
      <div className="onboarding-set-meta onboarding-enter enter-set-meta">
        <img className="onboarding-featured-logo" src={group.logo} alt={group.logoAlt} />
        <div className="onboarding-dots" aria-hidden="true">
          {welcomeHeroGroups.map((item, dotIndex) => <i className={dotIndex === index ? "is-active" : ""} key={item.id} />)}
        </div>
      </div>
    </div>
  );
}

function MobileOnboardingBootstrap({ onNeedApp }) {
  const tutorialSets = useMemo(getTutorialMetadata, []);
  const [step, setStep] = useState("welcome");
  const [selectedSetId, setSelectedSetId] = useState(tutorialSets[0]?.id || "");

  const writeChoiceState = (setId = selectedSetId) => writeMobileOnboardingBootstrapState({
    step: "choose-set",
    setId,
    cardIds: [],
    pokemon: null,
  });
  const queueAction = (action, setId = selectedSetId) => {
    setPendingMobileBootstrapOnboardingAction(action, setId);
    onNeedApp("open");
  };
  const start = (event) => {
    event?.preventDefault?.();
    writeChoiceState();
    setStep("choose-set");
    queueAction("start", selectedSetId);
  };
  const open = (event) => {
    event?.preventDefault?.();
    writeChoiceState();
    queueAction("open", selectedSetId);
  };
  const skip = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    queueAction("skip", selectedSetId);
  };

  return (
    <main className="mobile-app theme-dark" data-packdex-real-mobile-screen data-packdex-onboarding-bootstrap>
      <section className="phone-shell" aria-label="PackDex mobile onboarding">
        <div className="onboarding-layer">
          {step === "welcome" ? (
            <section className="onboarding-page onboarding-welcome">
              <header className="onboarding-header onboarding-enter enter-brand"><span className="onboarding-brand"><img src="/packdex-icon-192.png" alt="" /><strong>Pack<span>Dex</span></strong></span></header>
              <BootstrapHeroCards />
              <div className="onboarding-copy">
                <span className="eyebrow onboarding-enter enter-eyebrow">Open. Collect. Explore.</span>
                <h1 className="onboarding-enter enter-headline">Open packs. Build your collection. Chase every card.</h1>
                <p className="onboarding-enter enter-support">Start with a pack, discover your favorites, and build your collection.</p>
                <button className="primary-action onboarding-enter enter-action" type="button" onPointerDown={start} onClick={start}>Get Started</button>
                <button className="onboarding-text-button onboarding-enter enter-action" type="button" onPointerDown={skip} onClick={skip}>Skip</button>
              </div>
            </section>
          ) : (
            <section className="onboarding-page onboarding-set-choice">
              <header className="onboarding-header"><span className="onboarding-brand"><img src="/packdex-icon-192.png" alt="" /><strong>Pack<span>Dex</span></strong></span><button type="button" onPointerDown={skip} onClick={skip}>Skip</button></header>
              <div className="onboarding-title"><span className="eyebrow">Your first pull</span><h1>Choose your first pack</h1><p>Every collection starts somewhere. Choose a set to begin yours.</p></div>
              <div className="onboarding-pack-options">
                {tutorialSets.map((set, index) => {
                  const showcase = welcomeHeroGroups.find((group) => group.id === set.id)?.cards || [];
                  return (
                    <button
                      className={`${selectedSetId === set.id ? "is-selected" : ""} onboarding-option-enter option-${index + 1}`}
                      type="button"
                      key={set.id}
                      onPointerDown={() => { setSelectedSetId(set.id); writeChoiceState(set.id); }}
                      onClick={() => { setSelectedSetId(set.id); writeChoiceState(set.id); }}
                    >
                      <span className="onboarding-pack-art"><img className="onboarding-pack-logo-fallback" src={`/set-logos/${set.setFolder || set.id}.png`} alt="" /></span>
                      <span className="onboarding-pack-label"><em>{index === 0 ? "Newest set" : index === 1 ? "Classic favorite" : "Collector favorite"}</em><strong>{set.name}</strong></span>
                      <span className="onboarding-set-showcase" aria-hidden="true">{showcase.slice(0, 3).map((card) => <img key={card.name} src={card.src} alt="" />)}</span>
                      <i aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <button className="primary-action onboarding-sticky-action" type="button" disabled={!selectedSetId} onPointerDown={open} onClick={open}>Open This Pack</button>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

export default function MobileBootstrap({ mode = "selector", onNeedApp }) {
  const [eraFilter, setEraFilter] = useState("All Eras");
  const [bootstrapSelectedSet, setBootstrapSelectedSet] = useState(null);
  const orderedSets = useMemo(() => sortSetsByEra(setCatalogMetadata), []);
  const eras = useMemo(() => ["All Eras", ...new Set(orderedSets.map((set) => set.era).filter(Boolean))], [orderedSets]);
  const visibleSets = eraFilter === "All Eras" ? orderedSets : orderedSets.filter((set) => set.era === eraFilter);
  const groupedSets = groupSetsByEra(visibleSets);

  useEffect(() => {
    if (!["selector", "onboarding"].includes(mode)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (!document.querySelector("[data-packdex-real-mobile-screen] button")) return;
      const readyAt = performance.now();
      window.__packdexPerformance = {
        ...(window.__packdexPerformance || {}),
        mobileBootstrapRealScreen: readyAt,
        mobileInteractionReady: readyAt,
      };
      document.documentElement.dataset.packdexMobileBootstrapRealScreen = String(readyAt);
      document.documentElement.dataset.packdexMobileInteractionReady = String(readyAt);
      performance.mark?.("packdex-mobile-bootstrap-real-screen");
      window.dispatchEvent(new CustomEvent("packdex:mobile-real-screen"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  if (mode === "onboarding") return <MobileOnboardingBootstrap onNeedApp={onNeedApp} />;
  if (["collection", "explore", "profile"].includes(mode)) {
    return <MobileTabBootstrap tab={mode} onNeedApp={onNeedApp} />;
  }

  const requestTab = (tab) => {
    if (tab !== "open") {
      setBootstrapSelectedSet(null);
      setPendingMobileBootstrapSetId("");
      setPendingMobileBootstrapCollectionSetId("");
      setPendingMobileBootstrapOpenRequested(false);
    }
    onNeedApp(tab);
  };

  const chooseBootstrapSet = (set) => {
    claimBootstrapSetIntent(set);
    setBootstrapSelectedSet(set);
    onNeedApp("open");
  };

  return (
    <main className="mobile-app theme-dark" data-packdex-real-mobile-screen data-packdex-real-mobile-selector>
      <section className="phone-shell" aria-label="PackDex mobile app">
        <div className="screen-content screen-open">
          <BootstrapBrand />
          {bootstrapSelectedSet ? (
            <MobilePackReadyBootstrap
              set={bootstrapSelectedSet}
              onNeedApp={onNeedApp}
              onBack={() => {
                setPendingMobileBootstrapSetId("");
                setPendingMobileBootstrapOpenRequested(false);
                setBootstrapSelectedSet(null);
              }}
            />
          ) : <section className="open-set-selector">
            <div className="mobile-screen-title"><span>Open a Pack</span><h1>Choose a set</h1></div>
            <label className="mobile-filter-pill">
              <span>Era</span>
              <select value={eraFilter} onChange={(event) => setEraFilter(event.target.value)}>
                {eras.map((era) => <option key={era}>{era}</option>)}
              </select>
            </label>
            <div className="mobile-era-list">
              {Object.entries(groupedSets).map(([era, eraSets]) => (
                <section className="mobile-era-section" key={era}>
                  <div className="mobile-era-heading"><h2>{era} Era</h2><span>{eraSets.length === 1 ? "1 set" : `${eraSets.length} sets`}</span></div>
                  <div className="mobile-set-list">
                    {eraSets.map((set) => (
                      <article className="mobile-set-row" key={set.id}>
                        <button
                          className="mobile-set-main"
                          type="button"
                          onPointerDown={(event) => {
                            if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
                            chooseBootstrapSet(set);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") chooseBootstrapSet(set);
                          }}
                          onClick={() => {
                            chooseBootstrapSet(set);
                          }}
                        >
                          <img className="mobile-set-row-logo" src={`/set-logos/${set.setFolder || set.id}.png`} alt={`${set.name} logo`} loading="lazy" decoding="async" />
                          <div>
                            <strong>{set.name}</strong>
                            {set.isNew && <small className="mobile-set-new-badge">New</small>}
                            <span className="mobile-set-count-skeleton" aria-hidden="true" />
                          </div>
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>}
        </div>
        <BootstrapTabs activeTab="open" onNeedApp={requestTab} />
      </section>
    </main>
  );
}
