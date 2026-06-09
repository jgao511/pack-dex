import { Library, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { getSetLogoUrl } from "../utils/assetUrls.js";
import { canGeneratePack } from "../utils/packGenerator.js";
import { getSetCollectionProgress } from "../utils/collectionStorage.js";

const ALL_ERAS = "All Eras";
const ERA_ORDER = ["Scarlet & Violet", "Mega Evolution", "Sword & Shield", "Sun & Moon", "XY", "Other"];
const ERA_LOGO_SET_IDS = {
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
  return set.isNew || ["chaos-rising", "perfect-order"].includes(set.id) || ["Chaos Rising", "Perfect Order"].includes(set.name);
}

function getEraLogo(era, sets) {
  const baseSetId = ERA_LOGO_SET_IDS[era];
  const baseSet = sets.find((set) => set.id === baseSetId);

  return baseSet ? getSetLogoUrl(baseSet) : "";
}

function SetLogo({ set }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = getSetLogoUrl(set);

  if (!logoUrl || logoFailed) {
    return <span className="set-logo-fallback">{set.name}</span>;
  }

  return (
    <img
      src={logoUrl}
      alt={`${set.name} logo`}
      loading="lazy"
      decoding="async"
      onError={() => setLogoFailed(true)}
    />
  );
}

function SetSelect({ sets, collection, onSelectSet, onViewCollection }) {
  const [selectedEra, setSelectedEra] = useState(ALL_ERAS);
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
    <section className="set-select-screen">
      <div className="set-select-heading">
        <h1 className="brand-title">Open a Pack</h1>
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
            <section className="era-section" key={era}>
              <div className="era-section__hero">
                {getEraLogo(era, sets) && (
                  <img
                    className="era-section__logo"
                    src={getEraLogo(era, sets)}
                    alt={`${era} era logo`}
                    loading="lazy"
                    decoding="async"
                  />
                )}
                <div className="era-section__text">
                  <h2>{era} Era</h2>
                  <span>{eraSets.length} sets</span>
                </div>
              </div>
              <div className="set-grid">{eraSets.map(renderSetCard)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="set-grid">{sortedFilteredSets.map(renderSetCard)}</div>
      )}
    </section>
  );
}

export default SetSelect;
