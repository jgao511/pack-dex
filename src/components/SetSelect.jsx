import { Library } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getRemoteSetLogoUrl, getSetLogoUrl } from "../utils/assetUrls.js";
import { getSetCollectionProgress } from "../utils/collectionStorage.js";

const ALL_ERAS = "All Eras";
const ERA_ORDER = [
  "Mega Evolution",
  "Scarlet & Violet",
  "Sword & Shield",
  "Sun & Moon",
  "XY",
  "Black & White",
  "HeartGold & SoulSilver",
  "Platinum",
  "Diamond & Pearl",
  "EX",
  "e-Card / Late WOTC",
  "Neo",
  "Wizards Vintage",
  "Other",
];
const ERA_LOGO_SET_IDS = {
  "Mega Evolution": "mega-evolution",
  "Scarlet & Violet": "scarlet-violet",
  "Sword & Shield": "sword-shield",
  "Sun & Moon": "sun-moon",
  XY: "xy1",
  "Black & White": "black-white",
  "HeartGold & SoulSilver": "heartgold-soulsilver",
  Platinum: "platinum",
  "Diamond & Pearl": "diamond-pearl",
  EX: "ex-ruby-sapphire",
  "e-Card / Late WOTC": "expedition-base-set",
  Neo: "neo-genesis",
  "Wizards Vintage": "base-set",
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
  return Boolean(set.isNew);
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

function SetSelect({
  sets,
  collection,
  onSelectSet,
  onViewCollection,
  getSetHref = null,
  onNavigateSet = null,
  onPrefetchSet = null,
  title = "Choose a set",
  intro = "",
  footer = null,
}) {
  const [selectedEra, setSelectedEra] = useState(ALL_ERAS);
  const [activeEraBgClass, setActiveEraBgClass] = useState("era-bg-default");
  const pageRef = useRef(null);
  const prefetchedSetIdsRef = useRef(new Set());
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

  useLayoutEffect(() => {
    const navigationMark = performance.getEntriesByName?.("packdex-sets-navigation-start", "mark").at(-1);
    const bootstrapMark = performance.getEntriesByName?.("packdex-product-bootstrap-start", "mark").at(-1);
    const now = performance.now();

    window.__packdexPerformance = {
      ...(window.__packdexPerformance || {}),
      setSelectorInteractive: Number(now.toFixed(1)),
      timeline: [
        ...(window.__packdexPerformance?.timeline || []),
        { name: "setSelectorInteractive", atMs: Number(now.toFixed(1)) },
      ],
      ...(navigationMark
        ? { setsNavigationToSelectorMs: Number(Math.max(0, now - navigationMark.startTime).toFixed(1)) }
        : {}),
      ...(bootstrapMark
        ? { productBootstrapToSelectorMs: Number(Math.max(0, now - bootstrapMark.startTime).toFixed(1)) }
        : {}),
    };
    performance.clearMarks?.("packdex-sets-navigation-start");
    performance.clearMarks?.("packdex-product-bootstrap-start");
  }, []);

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

  function prefetchSet(set) {
    if (!set?.id || prefetchedSetIdsRef.current.has(set.id)) return;
    prefetchedSetIdsRef.current.add(set.id);
    onPrefetchSet?.(set);
  }

  function handleSetLinkClick(event, set, setHref) {
    if (
      !onNavigateSet ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;

    event.preventDefault();
    onNavigateSet(set, setHref);
  }

  function renderSetCard(set) {
    const progress = collectionProgress.get(set.id) || { collected: 0, total: 0 };
    const setHref = getSetHref ? getSetHref(set) : "";

    return (
      <article className="set-tile" key={set.id}>
        {setHref ? (
          <a
            aria-label={`Open ${set.name} pack`}
            className="set-card-primary-action"
            href={setHref}
            onClick={(event) => handleSetLinkClick(event, set, setHref)}
            onFocus={() => prefetchSet(set)}
            onPointerDown={() => prefetchSet(set)}
            onPointerEnter={() => prefetchSet(set)}
          />
        ) : (
          <button
            aria-label={`Open ${set.name} pack`}
            className="set-card-primary-action"
            onClick={() => onSelectSet(set)}
            onFocus={() => prefetchSet(set)}
            onPointerDown={() => prefetchSet(set)}
            onPointerEnter={() => prefetchSet(set)}
            type="button"
          />
        )}
        {isNewSet(set) && <span className="set-card__badge-new">New</span>}
        <div className="set-logo-box">
          <SetLogo set={set} />
        </div>
        <div className="set-tile-info">
          <h2>{set.name}</h2>
          <span>{progress.collected} / {progress.total} cards collected</span>
        </div>
        <button
          aria-label={`View ${set.name} collection`}
          className="set-collection-button"
          onClick={(event) => {
            event.stopPropagation();
            onViewCollection(set);
          }}
          type="button"
        >
          <Library size={17} aria-hidden="true" />
          <span>View collection</span>
        </button>
      </article>
    );
  }

  return (
    <section className={`set-select-screen open-pack-page ${openPackBgClass}`} data-packdex-real-content="sets" ref={pageRef}>
      <div className="set-select-heading">
        <div className="set-select-heading__copy">
          <span className="set-mark">Open a Pack</span>
          <h1>{title}</h1>
          {intro && <p>{intro}</p>}
        </div>
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
