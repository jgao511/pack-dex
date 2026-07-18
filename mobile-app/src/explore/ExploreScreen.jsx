import { useEffect, useMemo, useState } from "react";
import { getCardCount, getSetCollectionProgress } from "../../../src/utils/collectionStorage.js";
import { getCardImageUrl, getSetLogoUrl } from "../../../src/utils/assetUrls.js";
import { compareCardsByRarity } from "../../../src/utils/rarityRank.js";
import { getCardDisplayPrice } from "../../../src/lib/cardPrices.js";
import { supabase } from "../lib/supabaseClient.js";
import {
  cardsBySpeciesId,
  catalogCards,
  eraById,
  evolutionChainById,
  exploreEras,
  explorePokemon,
  exploreSets,
  getDailyFact,
  getDailySpotlights,
  getEraProgress,
  getSetGuide,
  getSpeciesCards,
  getSpeciesProgress,
  groupedExploreSearch,
  setById,
  speciesById,
} from "./exploreData.js";
import { buildEvolutionTree, normalizeExploreText } from "./exploreNormalization.js";
import { buildExplorePath, parseExploreRoute } from "./exploreRouting.js";
import { buildOpenRecommendations } from "./recommendations.js";
import { refreshPokemonPrices } from "./pokemonPriceRefresh.js";
import { prependRecentExploreRef, normalizeRecentExploreRefs, RECENT_EXPLORE_KEY } from "./recentExploreHistory.js";
import "./ExploreScreen.css";

const TYPE_OPTIONS = [...new Set(explorePokemon.flatMap((species) => species.types))].sort();
const GENERATION_NAMES = ["", "Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

function getEraRepresentativeSet(era) {
  return [...(era?.sets || [])]
    .filter((set) => getSetLogoUrl(set))
    .sort((a, b) => String(a.releaseDate || "9999").localeCompare(String(b.releaseDate || "9999")))[0] || era?.sets?.[0] || null;
}

function getExploreScroller() {
  return document.querySelector(".screen-content.screen-explore");
}

function loadRecentExploreRefs() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_EXPLORE_KEY) || "[]");
    return Array.isArray(parsed) ? normalizeRecentExploreRefs(parsed) : [];
  } catch {
    return [];
  }
}

function MissingImage({ label = "Image unavailable" }) {
  return <span className="explore-image-fallback" role="img" aria-label={label}>◇</span>;
}

function SafeImage({ src, alt, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <MissingImage label={`${alt || "Artwork"} unavailable`} />;
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function ProgressBar({ value, label }) {
  return <div className="explore-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={value} aria-label={label}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function PageHeader({ eyebrow = "Explore", title, onBack, children }) {
  return <header className="explore-page-header">
    {onBack && <button className="explore-back" type="button" onClick={onBack} aria-label="Back" />}
    <div><span>{eyebrow}</span><h1>{title}</h1>{children}</div>
  </header>;
}

function TypeBadges({ types = [] }) {
  return <div className="explore-types" aria-label={`Types: ${types.join(", ")}`}>{types.map((type) => <span key={type} className={`type-${type}`}>{type}</span>)}</div>;
}

function PokemonTile({ species, collection, onOpen, compact = false, contextLine = "", showProgress = true, featureLabel = "" }) {
  const progress = getSpeciesProgress(species.id, collection);
  return <button className={`explore-pokemon-tile ${compact ? "is-compact" : ""}`} type="button" onClick={() => onOpen(species)} aria-label={showProgress ? `View ${species.displayName}, ${progress.owned} of ${progress.total} cards discovered` : `View ${species.displayName}`}>
    <SafeImage src={species.artworkUrl} alt={`${species.displayName} official artwork`} />
    <span className="explore-tile-copy">{featureLabel && <span className="explore-feature-label">{featureLabel}</span>}<small>#{String(species.id).padStart(4, "0")}</small><strong>{species.displayName}</strong><TypeBadges types={species.types} />{contextLine && <span className="explore-tile-context">{contextLine}</span>}{showProgress && <em>{progress.owned} of {progress.total} discovered</em>}</span>
  </button>;
}

function SetTile({ set, collection, onOpen, compact = false, contextLine = "", featureLabel = "" }) {
  const progress = getSetCollectionProgress(collection, set);
  return <button className={`explore-set-tile ${compact ? "is-compact" : ""}`} type="button" onClick={() => onOpen(set)} aria-label={`View ${set.name}, ${progress.percent}% complete`}>
    <span className="explore-set-art"><SafeImage src={getSetLogoUrl(set)} alt={`${set.name} logo`} /></span>
    <span className="explore-tile-copy">{featureLabel && <span className="explore-feature-label">{featureLabel}</span>}<small>{set.era}</small><strong>{set.name}</strong><em>{set.releaseDate ? new Date(`${set.releaseDate}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : `${set.cards?.length || 0} cards`}</em>{contextLine && <span className="explore-tile-context">{contextLine}</span>}<ProgressBar value={progress.percent} label={`${set.name} collection completion`} /></span>
  </button>;
}

function EraTile({ era, collection, onOpen, compact = false, contextLine = "", featureLabel = "" }) {
  const progress = getEraProgress(era, collection);
  const representative = getEraRepresentativeSet(era);
  return <button className={`explore-era-tile ${compact ? "is-compact" : ""}`} type="button" onClick={() => onOpen(era)} aria-label={`View ${era.name}, ${era.sets.length} sets`}>
    <span className="explore-era-art"><SafeImage src={representative ? getSetLogoUrl(representative) : ""} alt={`${era.name} representative set logo`} /></span>
    <span className="explore-tile-copy">{featureLabel && <span className="explore-feature-label">{featureLabel}</span>}<small>{era.dateRange || "PackDex era"}</small><strong>{era.name}</strong><em>{era.sets.length} sets · {progress.percent}% collected</em>{contextLine && <span className="explore-tile-context">{contextLine}</span>}<ProgressBar value={progress.percent} label={`${era.name} collection completion`} /></span>
  </button>;
}

function CardTile({ entry, collection, wishlistKeys, onOpen }) {
  const owned = getCardCount(collection, entry.card, entry.set.id);
  const wishlisted = wishlistKeys.has(`${entry.set.id}:${entry.card.id}`);
  return <button className="explore-card-tile" type="button" onClick={() => onOpen(entry.card, entry.set)} aria-label={`View ${entry.card.name} from ${entry.set.name}. ${owned ? `Owned quantity ${owned}` : "Missing"}${wishlisted ? ", wishlisted" : ""}`}>
    <SafeImage src={getCardImageUrl(entry.card)} alt={`${entry.card.name} card`} />
    <span><strong>{entry.card.name}</strong><small>{entry.set.name} · #{entry.card.number}</small><em>{owned ? `Owned ×${owned}` : wishlisted ? "Wishlisted" : "Missing"}</em></span>
  </button>;
}

function SearchField({ value, onChange, onSubmit, onFocus, autoFocus = false }) {
  return <form className="explore-search" role="search" onSubmit={(event) => { event.preventDefault(); onSubmit?.(value); }}>
    <label className="sr-only" htmlFor="explore-search-input">Search Pokémon, sets, eras, or cards</label>
    <input id="explore-search-input" type="search" inputMode="search" enterKeyHint="search" value={value} autoFocus={autoFocus} placeholder="Search Pokémon, sets, eras, or cards" onFocus={onFocus} onChange={(event) => onChange(event.target.value)} />
    {value && <button className="explore-search-clear" type="button" aria-label="Clear search" onClick={() => onChange("")}>×</button>}
    <button type="submit" aria-label="Search">⌕</button>
  </form>;
}

function SearchGroups({ query, collection, wishlistKeys, navigate, onInspectCard }) {
  const results = useMemo(() => groupedExploreSearch(query), [query]);
  const total = Object.values(results).reduce((sum, items) => sum + items.length, 0);
  if (!normalizeExploreText(query)) return null;
  if (!total) return <div className="explore-empty"><strong>No Explore results</strong><span>Try a shorter name or remove punctuation.</span></div>;
  return <div className="explore-search-groups">
    {results.pokemon.length > 0 && <section><h2>Pokémon <span>{results.pokemon.length}</span></h2><div className="explore-list">{results.pokemon.map((species) => <PokemonTile key={species.id} species={species} collection={collection} compact onOpen={(item) => navigate({ kind: "pokemon", id: item.id })} />)}</div></section>}
    {results.sets.length > 0 && <section><h2>Sets <span>{results.sets.length}</span></h2><div className="explore-list">{results.sets.map((set) => <SetTile key={set.id} set={set} collection={collection} compact onOpen={(item) => navigate({ kind: "set", id: item.id })} />)}</div></section>}
    {results.eras.length > 0 && <section><h2>Eras <span>{results.eras.length}</span></h2><div className="explore-list">{results.eras.map((era) => <EraTile key={era.id} era={era} collection={collection} compact onOpen={(item) => navigate({ kind: "era", id: item.id })} />)}</div></section>}
    {results.cards.length > 0 && <section><h2>Pokémon Cards <span>{results.cards.length}</span></h2><div className="explore-card-grid">{results.cards.map((entry) => <CardTile key={`${entry.set.id}:${entry.card.id}`} entry={entry} collection={collection} wishlistKeys={wishlistKeys} onOpen={(card, set) => onInspectCard(card, set, { origin: "explore-search" })} />)}</div></section>}
  </div>;
}

function RecentExploreSearch({ recentRefs, onOpen }) {
  const items = recentRefs.map((item) => {
    if (item.kind === "pokemon") {
      const species = speciesById.get(Number(item.id));
      return species ? { ...item, label: species.displayName, image: species.artworkUrl, imageAlt: `${species.displayName} official artwork`, type: "Pokémon" } : null;
    }
    if (item.kind === "set") {
      const set = setById.get(item.id);
      return set ? { ...item, label: set.name, image: getSetLogoUrl(set), imageAlt: `${set.name} logo`, type: "Set" } : null;
    }
    const era = eraById.get(item.id);
    const representative = era ? getEraRepresentativeSet(era) : null;
    return era ? { ...item, label: era.name, image: representative ? getSetLogoUrl(representative) : "", imageAlt: `${era.name} representative set logo`, type: "Era" } : null;
  }).filter(Boolean);

  return <div className="search-empty-content">
    <p>Search Pokémon, sets, eras, or cards.</p>
    {items.length > 0 ? <section className="search-recent-section" aria-labelledby="recent-search-heading"><div className="explore-section-heading"><span>On this device</span><h2 id="recent-search-heading">Recently Viewed</h2></div><div className="search-recent-list">{items.map((item) => <button type="button" key={`${item.kind}:${item.id}`} onClick={() => onOpen(item)}><span className="search-recent-art"><SafeImage src={item.image} alt={item.imageAlt} /></span><span className="search-recent-copy"><small>{item.type}</small><strong>{item.label}</strong></span><em aria-hidden="true">›</em></button>)}</div></section> : <div className="explore-empty is-compact"><strong>Start with a name, set, era, or collector number.</strong><span>Your recently viewed Pokémon, sets, and eras will appear here.</span></div>}
  </div>;
}

function RecommendationCard({ item, onOpenPack, onViewSet }) {
  const set = item ? setById.get(item.setId) : null;
  if (!item || !set) return null;
  return <article className="open-recommendation-card">
    <div className="open-recommendation-art"><SafeImage src={getSetLogoUrl(set)} alt={`${set.name} logo`} /></div>
    <div className="open-recommendation-copy"><span>{item.title}</span><h3>{set.name}</h3><p>{item.reason}</p>{item.signals?.total > 0 && <small>{item.signals.owned} of {item.signals.total} unique cards discovered</small>}</div>
    <div className="explore-actions"><button type="button" onClick={() => onOpenPack(set)}>Open This Pack</button><button type="button" onClick={() => onViewSet(set)}>View Set</button></div>
  </article>;
}

function ExploreHome({ collection, wishlistEntries, query, onQueryChange, navigate, onInspectCard, onOpenPack }) {
  const [recommendationIndex, setRecommendationIndex] = useState(0);
  const [surpriseRecommendation, setSurpriseRecommendation] = useState(null);
  const spotlights = useMemo(() => getDailySpotlights(), []);
  const dailyFact = useMemo(() => getDailyFact(), []);
  const recommendations = useMemo(() => buildOpenRecommendations({ sets: exploreSets, collection, wishlistEntries }), [collection, wishlistEntries]);
  const recommendationItems = recommendations.recommendations;
  const selectedRecommendation = surpriseRecommendation || recommendationItems[recommendationIndex % Math.max(1, recommendationItems.length)] || recommendations.primary;
  const recent = useMemo(() => catalogCards
    .map((entry) => ({ ...entry, timestamp: Number(collection?.[entry.set.id]?.[entry.card.id]?.lastCollectedAt || 0) }))
    .filter((entry) => entry.timestamp && entry.speciesIds.length)
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.speciesIds[0] === entry.speciesIds[0]) === index)
    .slice(0, 4)
    .map((entry) => speciesById.get(entry.speciesIds[0])), [collection]);
  return <section className="explore-screen">
    <PageHeader title="Explore"><p>Discover Pokémon, sets, and TCG history.</p></PageHeader>
    <SearchField value={query} onChange={onQueryChange} onFocus={() => navigate({ kind: "search", query })} onSubmit={(value) => navigate({ kind: "search", query: value })} />
    {query.trim() ? <div className="explore-live-results"><SearchGroups query={query} collection={collection} wishlistKeys={new Set()} navigate={navigate} onInspectCard={onInspectCard} /></div> : <>
      <section className="explore-section"><div className="explore-section-heading"><span>Today in PackDex</span><h2>Spotlight</h2></div><div className="explore-spotlights">
        <PokemonTile species={spotlights.pokemon} collection={collection} compact featureLabel="Featured Pokémon" contextLine={`A ${spotlights.pokemon.types.join("/")}-type Pokémon introduced in Generation ${spotlights.pokemon.generation}.`} onOpen={(species) => navigate({ kind: "pokemon", id: species.id })} />
        <SetTile set={spotlights.set} collection={collection} compact featureLabel="Featured Set" contextLine={getSetGuide(spotlights.set.id)?.summary || ""} onOpen={(set) => navigate({ kind: "set", id: set.id })} />
        <EraTile era={spotlights.era} collection={collection} compact featureLabel="Featured Era" contextLine={spotlights.era.identity || spotlights.era.summary || ""} onOpen={(era) => navigate({ kind: "era", id: era.id })} />
        {dailyFact && <button className="daily-fact-card" type="button" onClick={() => navigate({ kind: dailyFact.kind, id: dailyFact.id })}><span>Fun Fact</span><strong>{dailyFact.text}</strong><em>Explore this {dailyFact.kind} ›</em></button>}
      </div></section>
      {selectedRecommendation && <section className="explore-section"><div className="explore-section-heading"><span>Personalized from your PackDex activity</span><h2>What Should I Open?</h2></div><RecommendationCard item={selectedRecommendation} onOpenPack={onOpenPack} onViewSet={(set) => navigate({ kind: "set", id: set.id })} /><div className="recommendation-switcher" aria-label="Recommendation categories">{recommendationItems.map((item, index) => <button className={!surpriseRecommendation && index === recommendationIndex ? "is-active" : ""} type="button" key={`${item.category}:${item.setId}`} onClick={() => { setSurpriseRecommendation(null); setRecommendationIndex(index); }}>{item.title}</button>)}{recommendations.surprise && <button className={surpriseRecommendation ? "is-active" : ""} type="button" onClick={() => setSurpriseRecommendation(recommendations.surprise)}>Surprise Me</button>}</div><p className="recommendation-disclaimer">Recommendations use your PackDex collection and wishlist—not real-world pull odds, value forecasts, or guarantees.</p></section>}
      <section className="explore-section"><div className="explore-section-heading"><span>Encyclopedia</span><h2>Browse</h2></div><div className="explore-category-grid">
        <button type="button" onClick={() => navigate({ kind: "pokemonBrowse" })}><span>001–1025</span><strong>Pokémon</strong><em>Species, evolutions, and your cards</em></button>
        <button type="button" onClick={() => navigate({ kind: "setBrowse" })}><span>{exploreSets.length} sets</span><strong>Sets</strong><em>Browse the complete PackDex catalog</em></button>
        <button type="button" onClick={() => navigate({ kind: "eraBrowse" })}><span>{exploreEras.length} eras</span><strong>Eras</strong><em>Explore the TCG chronologically</em></button>
      </div></section>
      {recent.length > 0 && <section className="explore-section"><div className="explore-section-heading"><span>Your recent pulls</span><h2>Pokémon to Revisit</h2></div><div className="explore-pokemon-grid is-small">{recent.map((species) => <PokemonTile key={species.id} species={species} collection={collection} onOpen={(item) => navigate({ kind: "pokemon", id: item.id })} />)}</div></section>}
    </>}
  </section>;
}

function SearchPage({ initialQuery, collection, wishlistKeys, recentRefs, navigate, goBack, onInspectCard }) {
  const [query, setQuery] = useState(initialQuery || "");
  useEffect(() => setQuery(initialQuery || ""), [initialQuery]);
  const openSearchResult = (nextRoute) => navigate(nextRoute, false, { suppressSearchAutoFocusOnReturn: true });
  const shouldAutoFocus = window.history.state?.exploreSearchAutoFocus !== false;
  return <section className="explore-screen is-search-mode"><PageHeader title="Search" onBack={goBack} /><SearchField value={query} onChange={(value) => { setQuery(value); navigate({ kind: "search", query: value }, true, { preserveScroll: true }); }} autoFocus={shouldAutoFocus} onSubmit={(value) => navigate({ kind: "search", query: value }, true, { preserveScroll: true })} />{query.trim() ? <SearchGroups query={query} collection={collection} wishlistKeys={wishlistKeys} navigate={openSearchResult} onInspectCard={onInspectCard} /> : <RecentExploreSearch recentRefs={recentRefs} onOpen={openSearchResult} />}</section>;
}

function PokemonBrowse({ collection, navigate, goBack }) {
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState("all");
  const [type, setType] = useState("all");
  const [limit, setLimit] = useState(72);
  const filtered = useMemo(() => explorePokemon.filter((species) => {
    const matchesQuery = !query || normalizeExploreText(`${species.displayName} ${species.name} ${species.id}`).includes(normalizeExploreText(query));
    return matchesQuery && (generation === "all" || species.generation === Number(generation)) && (type === "all" || species.types.includes(type));
  }), [query, generation, type]);
  useEffect(() => setLimit(72), [query, generation, type]);
  return <section className="explore-screen"><PageHeader title="Pokémon" onBack={goBack}><p>{filtered.length} species</p></PageHeader>
    <SearchField value={query} onChange={setQuery} />
    <div className="explore-filters"><label>Generation<select value={generation} onChange={(event) => setGeneration(event.target.value)}><option value="all">All</option>{GENERATION_NAMES.slice(1).map((name, index) => <option key={name} value={index + 1}>Gen {index + 1} · {name}</option>)}</select></label><label>Type<select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All</option>{TYPE_OPTIONS.map((name) => <option key={name}>{name}</option>)}</select></label></div>
    <div className="explore-pokemon-grid">{filtered.slice(0, limit).map((species) => <PokemonTile key={species.id} species={species} collection={collection} onOpen={(item) => navigate({ kind: "pokemon", id: item.id })} />)}</div>
    {limit < filtered.length && <button className="explore-more" type="button" onClick={() => setLimit((value) => value + 72)}>Show more Pokémon</button>}
    {!filtered.length && <div className="explore-empty"><strong>No matching Pokémon</strong><span>Try clearing a filter.</span></div>}
  </section>;
}

function EvolutionNode({ node, navigate }) {
  if (!node.species) return null;
  return <li><button type="button" onClick={() => navigate({ kind: "pokemon", id: node.species.id })}><SafeImage src={node.species.artworkUrl} alt="" /><span>#{String(node.species.id).padStart(4, "0")}</span><strong>{node.species.displayName}</strong></button>{node.children.length > 0 && <ul>{node.children.map((child) => <EvolutionNode key={child.species?.id} node={child} navigate={navigate} />)}</ul>}</li>;
}

function PriceHighlight({ entry, refreshState, onOpen }) {
  const isChecking = refreshState === "checking";
  const statusText = isChecking
    ? "Checking latest price…"
    : refreshState === "partial"
      ? "Some prices could not be checked."
      : refreshState === "failure"
        ? "Couldn’t check the latest prices."
        : "";

  if (entry) {
    return <button className="price-highlight-card" type="button" onClick={() => onOpen(entry.card, entry.set)}><small>Highest current listed market value</small><strong>{entry.card.name}</strong><span>{entry.set.name}</span><b>${entry.price.toFixed(2)}</b>{statusText && <em className="price-highlight-status" role="status" aria-live="polite">{statusText}</em>}</button>;
  }
  return <div className={`price-highlight-card is-empty ${isChecking ? "is-loading" : ""}`}><small>Highest current listed market value</small><strong role="status" aria-live="polite">{isChecking ? "Checking card prices…" : refreshState === "failure" ? "Couldn’t check the latest prices." : "No current market price available."}</strong><span className="price-highlight-placeholder" aria-hidden="true" /></div>;
}

function PokemonDetail({ id, collection, wishlistKeys, priceMapsBySet, navigate, goBack, onInspectCard }) {
  const species = speciesById.get(Number(id));
  const [statusFilter, setStatusFilter] = useState("all");
  const [setFilter, setSetFilter] = useState("all");
  const [refreshedPriceMaps, setRefreshedPriceMaps] = useState({});
  const [priceRefreshState, setPriceRefreshState] = useState("checking");
  const cards = species ? [...getSpeciesCards(species.id)].sort((a, b) => String(a.set.releaseDate || "").localeCompare(String(b.set.releaseDate || "")) || String(a.card.number).localeCompare(String(b.card.number), undefined, { numeric: true }) || String(a.card.id).localeCompare(String(b.card.id))) : [];
  const effectivePriceMaps = useMemo(() => {
    const setIds = new Set([...Object.keys(priceMapsBySet || {}), ...Object.keys(refreshedPriceMaps)]);
    return Object.fromEntries([...setIds].map((setId) => [setId, new Map([...(priceMapsBySet?.[setId] || []), ...(refreshedPriceMaps[setId] || [])])]));
  }, [priceMapsBySet, refreshedPriceMaps]);
  useEffect(() => {
    if (!species || cards.length === 0) return undefined;
    if (!supabase) {
      setPriceRefreshState("idle");
      return undefined;
    }
    let active = true;
    setPriceRefreshState("checking");
    refreshPokemonPrices({ speciesId: species.id, cards, collection, priceMapsBySet: effectivePriceMaps, supabaseClient: supabase })
      .then((result) => {
        if (!active) return;
        if (Object.keys(result.priceMapsBySet || {}).length > 0) {
          setRefreshedPriceMaps((current) => {
            const next = { ...current };
            Object.entries(result.priceMapsBySet).forEach(([setId, priceMap]) => {
              next[setId] = new Map([...(current[setId] || []), ...priceMap]);
            });
            return next;
          });
        }
        setPriceRefreshState(result.status === "partial_success" ? "partial" : result.status === "failure" ? "failure" : "idle");
      })
      .catch((error) => { if (active) setPriceRefreshState("failure"); console.warn("[PackDex prices] bounded Pokémon refresh failed", error); });
    return () => { active = false; };
  }, [species?.id]);
  if (!species) return <NotFound title="Pokémon unavailable" goBack={goBack} />;
  const progress = getSpeciesProgress(species.id, collection);
  const appearances = [...new Map(cards.map((entry) => [entry.set.id, entry.set])).values()].sort((a, b) => String(a.releaseDate || "").localeCompare(String(b.releaseDate || "")));
  const filteredCards = cards.filter((entry) => (setFilter === "all" || entry.set.id === setFilter) && (statusFilter === "all" || (statusFilter === "owned") === (getCardCount(collection, entry.card, entry.set.id) > 0)));
  const chain = buildEvolutionTree(evolutionChainById.get(species.evolutionChainId), speciesById);
  const dated = cards.filter((entry) => entry.set.releaseDate).sort((a, b) => a.set.releaseDate.localeCompare(b.set.releaseDate));
  const priced = cards.map((entry) => ({ ...entry, price: Number(getCardDisplayPrice(entry.card, effectivePriceMaps?.[entry.set.id], entry.set.id)?.marketPriceUsd || 0) })).filter((entry) => entry.price > 0).sort((a, b) => b.price - a.price);
  const notableOwned = [...priced, ...cards].find((entry, index, all) => all.findIndex((candidate) => candidate.set.id === entry.set.id && candidate.card.id === entry.card.id) === index && getCardCount(collection, entry.card, entry.set.id) > 0);
  const inspectPokemonCard = (card, set) => onInspectCard(card, set, { origin: "pokemon-detail", pokemonId: species.id });
  return <section className="explore-screen"><PageHeader title={species.displayName} onBack={goBack} />
    <section className="pokemon-hero"><div><span>National Pokédex</span><strong>#{String(species.id).padStart(4, "0")}</strong><TypeBadges types={species.types} /><em>Generation {species.generation} · {GENERATION_NAMES[species.generation]}</em></div><SafeImage src={species.artworkUrl} alt={`${species.displayName} official artwork`} /></section>
    {species.flavorText && <section className="explore-detail-section"><span className="eyebrow">About</span><p className="explore-description">{species.flavorText}</p></section>}
    <section className="explore-detail-section"><span className="eyebrow">Quick Facts</span><div className="quick-facts"><div><small>Category</small><strong>{species.genus || "Unknown"}</strong></div><div><small>Height</small><strong>{species.heightDm ? `${(species.heightDm / 10).toFixed(1)} m · ${Math.floor(species.heightDm * 3.937 / 12)}′ ${Math.round((species.heightDm * 3.937) % 12)}″` : "Unknown"}</strong></div><div><small>Weight</small><strong>{species.weightHg ? `${(species.weightHg / 10).toFixed(1)} kg · ${(species.weightHg * 0.220462).toFixed(1)} lb` : "Unknown"}</strong></div><div><small>Abilities</small><strong>{species.abilities.map((ability) => `${ability.name}${ability.hidden ? " (Hidden)" : ""}`).join(", ") || "Unknown"}</strong></div></div></section>
    <section className="explore-detail-section"><span className="eyebrow">Evolution Family</span>{chain.length > 1 || chain[0]?.children.length > 0 ? <ul className="evolution-tree">{chain.map((node) => <EvolutionNode key={node.species?.id} node={node} navigate={navigate} />)}</ul> : <p className="explore-description">No evolution is listed for this Pokémon.</p>}</section>
    {species.forms?.length > 0 && <section className="explore-detail-section"><span className="eyebrow">Known Forms</span><div className="mechanic-list">{species.forms.map((form) => <span key={form}>{form}</span>)}</div></section>}
    <section className="explore-detail-section"><span className="eyebrow">PackDex Card Progress</span><div className="progress-summary"><strong>{progress.percent}%</strong><span>{progress.owned} of {progress.total} unique cards discovered</span><em>{progress.missing} missing</em></div><ProgressBar value={progress.percent} label={`${species.displayName} card completion`} /></section>
    {cards.length > 0 && <section className="explore-detail-section"><span className="eyebrow">Collection Highlights</span><div className="highlight-grid">{dated[0] && <button type="button" onClick={() => inspectPokemonCard(dated[0].card, dated[0].set)}><small>Oldest supported</small><strong>{dated[0].card.name}</strong><span>{dated[0].set.name}</span></button>}{dated.at(-1) && <button type="button" onClick={() => inspectPokemonCard(dated.at(-1).card, dated.at(-1).set)}><small>Newest supported</small><strong>{dated.at(-1).card.name}</strong><span>{dated.at(-1).set.name}</span></button>}<PriceHighlight entry={priced[0]} refreshState={priceRefreshState} onOpen={inspectPokemonCard} />{notableOwned && <button type="button" onClick={() => inspectPokemonCard(notableOwned.card, notableOwned.set)}><small>Notable card you own</small><strong>{notableOwned.card.name}</strong><span>{notableOwned.set.name}</span></button>}</div></section>}
    <section className="explore-detail-section"><div className="explore-section-heading"><span>PackDex Catalog</span><h2>Cards Featuring {species.displayName}</h2></div>{cards.length ? <><div className="explore-filters"><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All</option><option value="owned">Owned</option><option value="missing">Missing</option></select></label><label>Set<select value={setFilter} onChange={(event) => setSetFilter(event.target.value)}><option value="all">All sets</option>{appearances.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label></div><div className="explore-card-grid">{filteredCards.map((entry) => <CardTile key={`${entry.set.id}:${entry.card.id}`} entry={entry} collection={collection} wishlistKeys={wishlistKeys} onOpen={inspectPokemonCard} />)}</div>{!filteredCards.length && <div className="explore-empty"><strong>No cards in this view</strong><span>Change the filters to see more.</span></div>}</> : <div className="explore-empty"><strong>No supported PackDex cards yet</strong><span>The encyclopedia information is still available.</span></div>}</section>
    {appearances.length > 0 && <section className="explore-detail-section"><div className="explore-section-heading"><span>Catalog</span><h2>Appears In</h2></div><div className="explore-horizontal">{appearances.map((set) => <SetTile key={set.id} set={set} collection={collection} compact onOpen={(item) => navigate({ kind: "set", id: item.id })} />)}</div></section>}
  </section>;
}

function SetBrowse({ collection, navigate, goBack }) {
  const [query, setQuery] = useState("");
  const [era, setEra] = useState("all");
  const filtered = exploreSets.filter((set) => (!query || normalizeExploreText(`${set.name} ${set.id}`).includes(normalizeExploreText(query))) && (era === "all" || set.era === era));
  return <section className="explore-screen"><PageHeader title="Sets" onBack={goBack}><p>{filtered.length} supported sets</p></PageHeader><SearchField value={query} onChange={setQuery} /><div className="explore-filters is-single"><label>Era<select value={era} onChange={(event) => setEra(event.target.value)}><option value="all">All eras</option>{exploreEras.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label></div><div className="explore-list">{filtered.map((set) => <SetTile key={set.id} set={set} collection={collection} onOpen={(item) => navigate({ kind: "set", id: item.id })} />)}</div>{!filtered.length && <div className="explore-empty"><strong>No matching sets</strong><span>Try another name or era.</span></div>}</section>;
}

function SetDetail({ id, collection, wishlistKeys, navigate, goBack, onInspectCard, onOpenPack, onViewSetCollection }) {
  const set = setById.get(id);
  if (!set) return <NotFound title="Set unavailable" goBack={goBack} />;
  const progress = getSetCollectionProgress(collection, set);
  const guide = getSetGuide(set.id);
  const era = exploreEras.find((entry) => entry.name === set.era);
  const related = era?.sets.filter((entry) => entry.id !== set.id) || [];
  const cardEntries = catalogCards.filter((entry) => entry.set.id === set.id);
  const species = [...cardsBySpeciesId.entries()].map(([speciesId, cards]) => ({ species: speciesById.get(speciesId), count: cards.filter((entry) => entry.set.id === set.id).length })).filter((entry) => entry.count).sort((a, b) => b.count - a.count || a.species.id - b.species.id).slice(0, 8);
  const featured = [...cardEntries].sort((a, b) => compareCardsByRarity(a.card, b.card, set, set)).slice(0, 8);
  const wishlistCount = cardEntries.filter((entry) => wishlistKeys.has(`${set.id}:${entry.card.id}`)).length;
  const inspectSetCard = (card, cardSet) => onInspectCard(card, cardSet, { origin: "set-detail", setId: set.id });
  return <section className="explore-screen"><PageHeader title={set.name} onBack={goBack} />
    <section className="set-detail-hero"><div className="set-detail-logo"><SafeImage src={getSetLogoUrl(set)} alt={`${set.name} logo`} /></div><div><span>{guide.custom ? "PackDex-created preview" : set.era}</span><strong>{set.releaseDate ? new Date(`${set.releaseDate}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "Release date unavailable"}</strong><em>{cardEntries.length} supported cards</em></div></section>
    {guide.summary && <section className="explore-detail-section"><span className="eyebrow">About This Set</span><p className="explore-description">{guide.summary}</p></section>}
    {guide.themes?.length > 0 && <section className="explore-detail-section"><span className="eyebrow">Themes</span><div className="mechanic-list">{guide.themes.map((item) => <span key={item}>{item}</span>)}</div></section>}
    {guide.mechanics?.length > 0 && <section className="explore-detail-section"><span className="eyebrow">Verified Mechanics</span><div className="mechanic-list">{guide.mechanics.map((item) => <span key={item}>{item}</span>)}</div></section>}
    {species.length > 0 && <section className="explore-detail-section"><div className="explore-section-heading"><span>Pokémon represented in this set</span><h2>Featured Pokémon</h2></div><div className="explore-pokemon-grid is-small is-set-featured">{species.map((entry) => <PokemonTile key={entry.species.id} species={entry.species} collection={collection} showProgress={false} onOpen={(item) => navigate({ kind: "pokemon", id: item.id })} />)}</div></section>}
    {featured.length > 0 && <section className="explore-detail-section"><div className="explore-section-heading"><span>Selected high-rarity cards</span><h2>Featured Cards</h2></div><div className="explore-card-grid">{featured.map((entry) => <CardTile key={entry.card.id} entry={entry} collection={collection} wishlistKeys={wishlistKeys} onOpen={inspectSetCard} />)}</div></section>}
    {guide.funFacts?.length > 0 && <section className="explore-detail-section"><span className="eyebrow">Fun Facts</span><ul className="explore-fact-list">{guide.funFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></section>}
    <section className="explore-detail-section"><span className="eyebrow">Your Collection</span><div className="progress-summary"><strong>{progress.percent}%</strong><span>{progress.collected} of {progress.total} unique cards</span><em>{wishlistCount} wishlisted</em></div><ProgressBar value={progress.percent} label={`${set.name} collection completion`} /><div className="explore-actions"><button type="button" onClick={() => onOpenPack(set)}>Open This Pack</button><button type="button" onClick={() => onViewSetCollection(set)}>View Set Collection</button></div></section>
    {era && <section className="explore-detail-section"><button className="explore-link-row" type="button" onClick={() => navigate({ kind: "era", id: era.id })}><span><small>Era</small><strong>{era.name}</strong></span><em>View era ›</em></button></section>}
    {related.length > 0 && <section className="explore-detail-section"><div className="explore-section-heading"><span>{set.era}</span><h2>Other Sets in This Era</h2></div><div className="explore-horizontal">{related.map((item) => <SetTile key={item.id} set={item} collection={collection} compact onOpen={(next) => navigate({ kind: "set", id: next.id })} />)}</div></section>}
  </section>;
}

function EraBrowse({ collection, navigate, goBack }) {
  return <section className="explore-screen"><PageHeader title="Eras" onBack={goBack}><p>Browse the PackDex catalog chronologically.</p></PageHeader><div className="explore-list">{exploreEras.map((era) => <EraTile key={era.id} era={era} collection={collection} onOpen={(item) => navigate({ kind: "era", id: item.id })} />)}</div></section>;
}

function EraDetail({ id, collection, wishlistKeys, navigate, goBack, onInspectCard }) {
  const era = eraById.get(id);
  if (!era) return <NotFound title="Era unavailable" goBack={goBack} />;
  const progress = getEraProgress(era, collection);
  const species = [...cardsBySpeciesId.entries()].map(([speciesId, cards]) => ({ species: speciesById.get(speciesId), count: cards.filter((entry) => entry.set.era === era.name).length })).filter((entry) => entry.count).sort((a, b) => b.count - a.count || a.species.id - b.species.id).slice(0, 8);
  const eraCards = catalogCards.filter((entry) => entry.set.era === era.name);
  const featuredCards = [...eraCards].sort((a, b) => compareCardsByRarity(a.card, b.card, a.set, b.set)).slice(0, 6);
  const representative = getEraRepresentativeSet(era);
  const inspectEraCard = (card, set) => onInspectCard(card, set, { origin: "era-detail", eraId: era.id });
  return <section className="explore-screen"><PageHeader title={era.name} onBack={goBack}><p>{era.dateRange} · {era.sets.length} sets</p></PageHeader>
    {representative && <section className="era-detail-hero"><SafeImage src={getSetLogoUrl(representative)} alt={`${era.name} representative set logo`} /><div><span>{era.custom ? "PackDex-created preview era" : "PackDex TCG era"}</span><strong>{era.dateRange}</strong><em>{era.identity || `${era.sets.length} supported sets`}</em></div></section>}
    {era.summary && <section className="explore-detail-section"><span className="eyebrow">About This Era</span><p className="explore-description">{era.summary}</p></section>}
    {era.changeNote && <section className="explore-detail-section"><span className="eyebrow">From the Prior Era</span><p className="explore-description">{era.changeNote}</p></section>}
    <section className="explore-detail-section"><span className="eyebrow">Era Collection Progress</span><div className="progress-summary"><strong>{progress.percent}%</strong><span>{progress.owned} of {progress.total} unique cards</span><em>{era.sets.filter((set) => getSetCollectionProgress(collection, set).collected > 0).length} sets explored</em></div><ProgressBar value={progress.percent} label={`${era.name} collection completion`} /></section>
    {era.mechanics?.length > 0 && <section className="explore-detail-section"><span className="eyebrow">Prominent Mechanics</span><div className="mechanic-list">{era.mechanics.map((item) => <span key={item}>{item}</span>)}</div></section>}
    <section className="explore-detail-section"><div className="explore-section-heading"><span>Chronological</span><h2>Sets in This Era</h2></div><div className="explore-list">{era.sets.map((set) => <SetTile key={set.id} set={set} collection={collection} onOpen={(item) => navigate({ kind: "set", id: item.id })} />)}</div></section>
    {species.length > 0 && <section className="explore-detail-section"><div className="explore-section-heading"><span>Pokémon represented in this era</span><h2>Featured Pokémon</h2></div><div className="explore-pokemon-grid is-small is-set-featured">{species.map((entry) => <PokemonTile key={entry.species.id} species={entry.species} collection={collection} showProgress={false} onOpen={(item) => navigate({ kind: "pokemon", id: item.id })} />)}</div></section>}
    {featuredCards.length > 0 && <section className="explore-detail-section"><div className="explore-section-heading"><span>Selected high-rarity cards</span><h2>Featured Cards</h2></div><div className="explore-card-grid">{featuredCards.map((entry) => <CardTile key={`${entry.set.id}:${entry.card.id}`} entry={entry} collection={collection} wishlistKeys={wishlistKeys} onOpen={inspectEraCard} />)}</div></section>}
  </section>;
}

function NotFound({ title, goBack }) {
  return <section className="explore-screen"><PageHeader title={title} onBack={goBack} /><div className="explore-empty"><strong>This Explore page is unavailable.</strong><span>The local catalog may not contain this item.</span></div></section>;
}

export default function ExploreScreen({ collection = {}, wishlistEntries = [], priceMapsBySet = {}, onInspectCard, onOpenPack, onViewSetCollection }) {
  const [route, setRoute] = useState(() => parseExploreRoute(window.location));
  const [homeQuery, setHomeQuery] = useState("");
  const [recentRefs, setRecentRefs] = useState(loadRecentExploreRefs);
  const wishlistKeys = useMemo(() => new Set(wishlistEntries.map((entry) => `${entry.setId}:${entry.cardId}`)), [wishlistEntries]);
  useEffect(() => {
    const onPopState = () => {
      setRoute(parseExploreRoute(window.location));
      const restoreTop = Number(window.history.state?.exploreScrollTop || 0);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => getExploreScroller()?.scrollTo({ top: restoreTop, behavior: "auto" })));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  function navigate(nextRoute, replace = false, { preserveScroll = false, suppressSearchAutoFocusOnReturn = false } = {}) {
    const path = buildExplorePath(nextRoute, window.location.pathname);
    const scroller = getExploreScroller();
    const currentTop = Number(scroller?.scrollTop || 0);
    if (!replace) window.history.replaceState({ ...(window.history.state || {}), packdexExplore: true, exploreScrollTop: currentTop, ...(suppressSearchAutoFocusOnReturn ? { exploreSearchAutoFocus: false } : {}) }, "", window.location.href);
    const nextState = { ...(replace ? window.history.state : {}), packdexExplore: true, exploreScrollTop: replace && preserveScroll ? currentTop : 0 };
    if (!replace && nextRoute.kind === "search") nextState.exploreSearchAutoFocus = true;
    window.history[replace ? "replaceState" : "pushState"](nextState, "", path);
    setRoute(nextRoute);
    if (!preserveScroll) window.requestAnimationFrame(() => scroller?.scrollTo({ top: 0, behavior: "auto" }));
    if (["pokemon", "set", "era"].includes(nextRoute.kind) && nextRoute.id != null) {
      setRecentRefs((current) => {
        const nextRecent = prependRecentExploreRef(current, { kind: nextRoute.kind, id: nextRoute.id });
        try { window.localStorage.setItem(RECENT_EXPLORE_KEY, JSON.stringify(nextRecent)); } catch { /* Browsing history remains optional. */ }
        return nextRecent;
      });
    }
  }
  function goBack() {
    if (window.history.state?.packdexExplore) window.history.back();
    else navigate({ kind: "home" }, true);
  }
  const shared = { collection, wishlistKeys, priceMapsBySet, recentRefs, navigate, goBack, onInspectCard };
  if (route.kind === "search") return <SearchPage {...shared} initialQuery={route.query} />;
  if (route.kind === "pokemonBrowse") return <PokemonBrowse {...shared} />;
  if (route.kind === "pokemon") return <PokemonDetail {...shared} id={route.id} />;
  if (route.kind === "setBrowse") return <SetBrowse {...shared} />;
  if (route.kind === "set") return <SetDetail {...shared} id={route.id} onOpenPack={onOpenPack} onViewSetCollection={onViewSetCollection} />;
  if (route.kind === "eraBrowse") return <EraBrowse {...shared} />;
  if (route.kind === "era") return <EraDetail {...shared} id={route.id} />;
  return <ExploreHome collection={collection} wishlistEntries={wishlistEntries} query={homeQuery} onQueryChange={setHomeQuery} navigate={navigate} onInspectCard={onInspectCard} onOpenPack={onOpenPack} />;
}
