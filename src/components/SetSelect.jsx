import { Library, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getRemoteSetLogoUrl, getSetLogoUrl } from "../utils/assetUrls.js";
import { canGeneratePack } from "../utils/packGenerator.js";
import { getSetCollectionProgress } from "../utils/collectionStorage.js";
import { preloadStaticOpenPackAssets } from "../utils/staticOpenPackAssets.js";

const ALL_ERAS = "All Eras";
const ERA_ORDER = ["Pokemon 30th Anniversary", "Scarlet & Violet", "Mega Evolution", "Sword & Shield", "Sun & Moon", "XY", "Other"];
const ERA_LOGO_SET_IDS = {
  "Pokemon 30th Anniversary": "30th-anniversary",
  "Scarlet & Violet": "scarlet-violet",
  "Mega Evolution": "mega-evolution",
  "Sword & Shield": "sword-shield",
  "Sun & Moon": "sun-moon",
  XY: "xy1",
};

function getReleaseTime(set) {
  const time = new Date(set.releaseDate || 0).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function sortNewestFirst(sets) {
  return [...sets].sort((a, b) => getReleaseTime(b) - getReleaseTime(a));
}

function getSetEra(set) {
  return set.era || "Other";
}

function getEraOptions(sets) {
  const presentEras = new Set(sets.map(getSetEra));
  const orderedEras = ERA_ORDER.filter((era) => presentEras.has(era));
  const remainingEras = [...presentEras].filter((era) => !ERA_ORDER.includes(era)).sort();

  return [ALL_ERAS, ...orderedEras, ...remainingEras];
}

function groupSetsByEra(sets) {
  const groups = new Map();

  sets.forEach((set) => {
    const era = getSetEra(set);
    const eraSets = groups.get(era) || [];

    eraSets.push(set);
    groups.set(era, eraSets);
  });

  return [...groups.entries()]
    .map(([era, eraSets]) => [era, sortNewestFirst(eraSets)])
    .sort(([, eraSetsA], [, eraSetsB]) => getReleaseTime(eraSetsB[0]) - getReleaseTime(eraSetsA[0]));
}

function isNewSet(set) {
  return set.isNew || set.id === "chaos-rising" || set.name === "Chaos Rising";
}

function getEraLogo(era, sets) {
  const baseSet = getEraLogoSet(era, sets);

  return baseSet ? getSetLogoUrl(baseSet) : "";
}

function getEraLogoSet(era, sets) {
  const baseSetId = ERA_LOGO_SET_IDS[era];

  return sets.find((set) => set.id === baseSetId);
}

function getEraClassName(era) {
  return `era-${getEraSlug(era)}`;
}

function getEraBgClassName(era) {
  return `era-bg-${getEraSlug(era)}`;
}

function getEraSlug(era) {
  return String(era || "default")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function SetLogoImage({ set, className, fallback }) {
  const [logoSource, setLogoSource] = useState("local");
  const logoUrl = className === "era-section__logo" && set.eraLogoPath ? set.eraLogoPath : getSetLogoUrl(set);
  const remoteLogoUrl = getRemoteSetLogoUrl(set);
  const displayLogoUrl = logoSource === "remote" ? remoteLogoUrl : logoUrl;

  useEffect(() => {
    setLogoSource("local");
  }, [logoUrl]);

  if (!displayLogoUrl || logoSource === "failed") {
    return fallback ?? null;
  }

  return (
    <img
      className={className}
      src={displayLogoUrl}
      alt={`${set.name} logo`}
      loading="lazy"
      decoding="async"
      onError={() => setLogoSource(logoSource === "local" && remoteLogoUrl ? "remote" : "failed")}
    />
  );
}

function SetLogo({ set }) {
  return <SetLogoImage set={set} fallback={<span className="set-logo-fallback">{set.name}</span>} />;
}

function SetSelect({ sets, collection, onSelectSet, onViewCollection, footer = null }) {
  const [selectedEra, setSelectedEra] = useState(ALL_ERAS);
  const [activeEraBgClass, setActiveEraBgClass] = useState("era-bg-default");
  const pageRef = useRef(null);
  const setReadiness = useMemo(() => new Map(sets.map((set) => [set.id, canGeneratePack(set)])), [sets]);
  const collectionProgress = useMemo(
    () => new Map(sets.map((set) => [set.id, getSetCollectionProgress(collection, set)])),
    [sets, collection]
  );
  const eraOptions = getEraOptions(sets);
  const filteredSets =
    selectedEra === ALL_ERAS
      ? sortNewestFirst(sets)
      : sets.filter((set) => (set.era || "Other") === selectedEra || (!set.era && selectedEra === "Other"));
  const sortedFilteredSets = sortNewestFirst(filteredSets);
  const eraGroups = groupSetsByEra(sortedFilteredSets);
  const openPackBgClass = selectedEra === ALL_ERAS ? activeEraBgClass : getEraBgClassName(selectedEra);
  const staticPreloadKey = `${selectedEra}:${sortedFilteredSets.map((set) => set.id).join("|")}`;

  useEffect(() => {
    const prioritySets =
      selectedEra === ALL_ERAS
        ? [
            ...eraGroups.map(([era]) => getEraLogoSet(era, sets)).filter(Boolean),
            ...(eraGroups[0]?.[1] || []).slice(0, 8),
          ]
        : sortedFilteredSets.slice(0, 10);

    preloadStaticOpenPackAssets(prioritySets, {
      additionalSets: sortedFilteredSets.slice(0, 24),
      immediateLogoLimit: 10,
      idleLogoLimit: 12,
    });
  }, [staticPreloadKey, eraGroups.length]);

  useEffect(() => {
    if (selectedEra !== ALL_ERAS) {
      setActiveEraBgClass(getEraBgClassName(selectedEra));
    }

    const firstEra = eraGroups[0]?.[0];

    if (selectedEra === ALL_ERAS) {
      setActiveEraBgClass(firstEra ? getEraBgClassName(firstEra) : "era-bg-default");
    }

    let eraObserver = null;
    const root = pageRef.current;

    if (!root || typeof IntersectionObserver === "undefined") return undefined;

    const setupEraObserver = () => {
      const eraSections = Array.from(root.querySelectorAll("[data-era-section]"));

      eraObserver = new IntersectionObserver(
        (entries) => {
          const activeEntry = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          const era = activeEntry?.target?.dataset?.era;

          if (era) {
            setActiveEraBgClass(`era-bg-${era}`);
          }
        },
        {
          threshold: [0.2, 0.35, 0.5, 0.65],
          rootMargin: "-30% 0px -45% 0px",
        }
      );

      if (selectedEra === ALL_ERAS) {
        eraSections.forEach((section) => eraObserver.observe(section));
      }
    };

    setupEraObserver();

    return () => {
      eraObserver?.disconnect();
    };
  }, [selectedEra, eraGroups.length, sortedFilteredSets.length]);

  function renderSetCard(set) {
    const isReady = setReadiness.get(set.id);
    const progress = collectionProgress.get(set.id) || { collected: 0, total: 0 };

    return (
      <article className="set-tile" key={set.id}>
        <button
          className={`set-tile-button ${isReady ? "" : "is-disabled"}`}
          onClick={() => isReady && onSelectSet(set)}
          disabled={!isReady}
        >
          {isNewSet(set) && <span className="set-card__badge-new">New</span>}
          <div className="set-logo-box">
            <SetLogo set={set} />
          </div>
          <div className="set-tile-info">
            <h2>{set.name}</h2>
            <span>{isReady ? `${progress.collected} / ${progress.total} cards collected` : "Pack rules unavailable"}</span>
          </div>
          <span className="set-open-pill">
            <Sparkles size={18} aria-hidden="true" />
            {isReady ? "Open Pack" : "Unavailable"}
          </span>
        </button>
        {isReady && (
          <button className="set-collection-button" onClick={() => onViewCollection(set)} type="button">
            <Library size={17} aria-hidden="true" />
            Collection
          </button>
        )}
      </article>
    );
  }

  return (
    <section className={`set-select-screen open-pack-page ${openPackBgClass}`} ref={pageRef}>
      <div className="set-select-heading">
        <h1 className="brand-title simulator-title">Pokémon TCG Pack Opening Simulator</h1>
        <h2 className="brand-title section-title">Open a Pack</h2>
        <label className="era-filter">
          <span>Era</span>
          <select value={selectedEra} onChange={(event) => setSelectedEra(event.target.value)}>
            {eraOptions.map((era) => (
              <option key={era} value={era}>
                {era}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedEra === ALL_ERAS ? (
        <div className="era-section-list">
          {eraGroups.map(([era, eraSets]) => (
            <section
              className={`home-era-section era-section ${getEraClassName(era)}`}
              data-era-section
              data-era={getEraSlug(era)}
              key={era}
            >
              <div className="era-section__hero">
                {getEraLogoSet(era, sets) && <SetLogoImage className="era-section__logo" set={getEraLogoSet(era, sets)} />}
                <div className="era-section__text">
                  <h2>{era} Era</h2>
                  <span>{eraSets.length} {eraSets.length === 1 ? "set" : "sets"}</span>
                </div>
              </div>
              <div className="set-grid">{eraSets.map(renderSetCard)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className={`set-grid era-filtered-grid ${getEraClassName(selectedEra)}`}>
          {sortedFilteredSets.map(renderSetCard)}
        </div>
      )}

      {footer && <div className="set-select-footer-slot">{footer}</div>}
    </section>
  );
}

export default SetSelect;
