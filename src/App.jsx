import { useEffect, useMemo, useRef, useState } from "react";
import PackOpening from "./components/PackOpening.jsx";
import CardReveal from "./components/CardReveal.jsx";
import CardDetailModal from "./components/CardDetailModal.jsx";
import CollectionPage from "./components/CollectionPage.jsx";
import FoilCard from "./components/FoilCard.jsx";
import PullSummary from "./components/PullSummary.jsx";
import SetSelect from "./components/SetSelect.jsx";
import { sets } from "./data/sets.js";
import { canGeneratePack, generatePack } from "./utils/packGenerator.js";
import {
  getCardCollectionKey,
  getCardCount,
  getPullableCollectionCards,
  isCardCollected,
  loadCollection,
  markCardsCollected,
  saveCollection,
} from "./utils/collectionStorage.js";
import { getPokeballLoadingUrl } from "./utils/assetUrls.js";

const TAB_LOADING_MS = 420;
const MIN_RETURN_LOADING_MS = 450;
const RETURN_LOADING_RENDER_DELAY_MS = 100;
const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();
const PACK_STATS_STORAGE_KEY = "packdex-profile-stats";
const COLLECTION_DASHBOARD_PAGE_SIZE = 60;

const MAIN_TABS = [
  { id: "open", label: "Open a Pack" },
  { id: "collection", label: "Collection" },
  { id: "profile", label: "Profile" },
];

function LoadingOverlay() {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-label="Returning to set">
      <img className="loading-pokeball" src={POKEBALL_LOADING_SRC} alt="" />
      <div className="loading-text">Returning to set...</div>
    </div>
  );
}

function TabLoadingOverlay() {
  return (
    <div className="tab-loading-overlay" role="status" aria-live="polite" aria-label="Loading section">
      <div className="tab-loading-card">
        <img src={POKEBALL_LOADING_SRC} alt="" />
        <span>Loading...</span>
      </div>
    </div>
  );
}

function loadProfileStats() {
  if (typeof window === "undefined") {
    return { packsOpened: 0, recentSets: [] };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(PACK_STATS_STORAGE_KEY));

    return {
      packsOpened: Number(parsed?.packsOpened || 0),
      recentSets: Array.isArray(parsed?.recentSets) ? parsed.recentSets : [],
    };
  } catch {
    return { packsOpened: 0, recentSets: [] };
  }
}

function saveProfileStats(stats) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(PACK_STATS_STORAGE_KEY, JSON.stringify(stats));
}

function updatePackOpenedStats(stats, set) {
  const recentSets = [
    { id: set.id, name: set.name, openedAt: Date.now() },
    ...(stats.recentSets || []).filter((recentSet) => recentSet.id !== set.id),
  ].slice(0, 5);

  return {
    packsOpened: (stats.packsOpened || 0) + 1,
    recentSets,
  };
}

function getCollectedCards(collection) {
  return sets.flatMap((set) =>
    getPullableCollectionCards(set)
      .filter((card) => isCardCollected(collection, card, set.id))
      .map((card) => ({
        card,
        set,
        count: getCardCount(collection, card, set.id),
      }))
  );
}

function CollectionDashboard({ collection }) {
  const [query, setQuery] = useState("");
  const [eraFilter, setEraFilter] = useState("all");
  const [setFilter, setSetFilter] = useState("all");
  const [sortMode, setSortMode] = useState("recent");
  const [page, setPage] = useState(1);
  const [selectedCard, setSelectedCard] = useState(null);
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const eraOptions = useMemo(
    () => ["all", ...new Set(collectedCards.map(({ set }) => set.era || "Other"))],
    [collectedCards]
  );
  const setOptions = useMemo(
    () => collectedCards.map(({ set }) => set).filter((set, index, allSets) => allSets.findIndex((item) => item.id === set.id) === index),
    [collectedCards]
  );
  const visibleCards = useMemo(() => {
    const search = query.toLowerCase().trim();

    return collectedCards
      .filter(({ card, set }) => {
        const matchesSearch =
          !search ||
          String(card.name || "").toLowerCase().includes(search) ||
          String(card.rarity || "").toLowerCase().includes(search) ||
          String(set.name || "").toLowerCase().includes(search);
        const matchesEra = eraFilter === "all" || (set.era || "Other") === eraFilter;
        const matchesSet = setFilter === "all" || set.id === setFilter;

        return matchesSearch && matchesEra && matchesSet;
      })
      .sort((a, b) => {
        if (sortMode === "name") return String(a.card.name || "").localeCompare(String(b.card.name || ""));
        if (sortMode === "rarity") return String(a.card.rarity || "").localeCompare(String(b.card.rarity || ""));
        if (sortMode === "set") return String(a.set.name || "").localeCompare(String(b.set.name || ""));

        const keyA = getCardCollectionKey(a.card, a.set.id);
        const keyB = getCardCollectionKey(b.card, b.set.id);

        return (collection[b.set.id]?.[keyB]?.lastCollectedAt || 0) - (collection[a.set.id]?.[keyA]?.lastCollectedAt || 0);
      });
  }, [collectedCards, collection, eraFilter, query, setFilter, sortMode]);
  const totalPages = Math.max(1, Math.ceil(visibleCards.length / COLLECTION_DASHBOARD_PAGE_SIZE));
  const pagedCards = visibleCards.slice(
    (page - 1) * COLLECTION_DASHBOARD_PAGE_SIZE,
    page * COLLECTION_DASHBOARD_PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [eraFilter, query, setFilter, sortMode]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  return (
    <section className="dashboard-screen">
      <div className="dashboard-heading">
        <span className="set-mark">Collection</span>
        <h1>Collected Cards</h1>
        <p>Your pulled cards across every set live here.</p>
      </div>

      {collectedCards.length === 0 ? (
        <div className="empty-state">
          <h2>No cards collected yet</h2>
          <p>Open a few packs first and your collection will start filling in here.</p>
        </div>
      ) : (
        <>
          <div className="collection-controls dashboard-controls">
            <label className="collection-search">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search collected cards"
              />
            </label>
            <select value={eraFilter} onChange={(event) => setEraFilter(event.target.value)} aria-label="Filter by era">
              {eraOptions.map((era) => (
                <option key={era} value={era}>
                  {era === "all" ? "All Eras" : era}
                </option>
              ))}
            </select>
            <select value={setFilter} onChange={(event) => setSetFilter(event.target.value)} aria-label="Filter by set">
              <option value="all">All Sets</option>
              {setOptions.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </select>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label="Sort collected cards">
              <option value="recent">Recently Collected</option>
              <option value="name">Name</option>
              <option value="rarity">Rarity</option>
              <option value="set">Set</option>
            </select>
          </div>

          <div className="collection-grid">
            {pagedCards.map(({ card, set, count }) => (
              <article
                className="collection-card is-collected"
                key={`${set.id}-${card.id || card.number}-${card.name}`}
                onClick={() => setSelectedCard({ card, set, count })}
              >
                <div className="collection-card-image">
                  <FoilCard
                    card={card}
                    set={set}
                    variant="collection"
                    enableTransform={false}
                    enableCursorBlob={false}
                    enableTiltFoil={false}
                    showFoil={false}
                  />
                  {count > 1 && <span className="count-badge">x{count}</span>}
                </div>
                <div className="collection-card-meta">
                  <strong>{card.name}</strong>
                  <span>
                    {set.name} - {card.rarity}
                  </span>
                </div>
              </article>
            ))}
          </div>

          {visibleCards.length > COLLECTION_DASHBOARD_PAGE_SIZE && (
            <div className="pagination-controls" aria-label="Collection pages">
              <button type="button" onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))} disabled={page === 1}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages} - {visibleCards.length} cards
              </span>
              <button
                type="button"
                onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                disabled={page === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {selectedCard && (
        <CardDetailModal
          card={selectedCard.card}
          set={selectedCard.set}
          collected
          count={selectedCard.count}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <img src="/packdex-small.png" alt="" />
        <span>PackDex</span>
      </div>
      <p>
        PackDex is a fan-made Pokémon TCG pack opening simulator. PackDex is not affiliated with, endorsed by,
        sponsored by, or associated with Nintendo, The Pokémon Company, Creatures Inc., or Game Freak. Pokémon,
        Pokémon TCG, and related names, images, and trademarks are the property of their respective owners. All card
        images and related assets are used for informational and entertainment purposes only.
      </p>
      <div className="site-footer__bottom">
        <span>© 2026 PackDex. All rights reserved.</span>
        <a href="/image-credits.html" target="_blank" rel="noopener noreferrer">
          Image Credits
        </a>
      </div>
    </footer>
  );
}

function ProfilePage({ collection, profileStats }) {
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const uniqueCards = collectedCards.length;
  const totalCards = collectedCards.reduce((sum, item) => sum + item.count, 0);
  const completedSets = sets.filter((set) => {
    const pullableCards = getPullableCollectionCards(set);

    return pullableCards.length > 0 && pullableCards.every((card) => isCardCollected(collection, card, set.id));
  }).length;

  return (
    <section className="dashboard-screen profile-screen">
      <div className="dashboard-heading">
        <span className="set-mark">Profile</span>
        <h1>Your PackDex</h1>
        <p>A local snapshot of your pack-opening journey.</p>
      </div>

      <div className="profile-stat-grid">
        <article>
          <span>Total Cards</span>
          <strong>{totalCards}</strong>
        </article>
        <article>
          <span>Unique Cards</span>
          <strong>{uniqueCards}</strong>
        </article>
        <article>
          <span>Packs Opened</span>
          <strong>{profileStats.packsOpened || 0}</strong>
        </article>
        <article>
          <span>Completed Sets</span>
          <strong>{completedSets}</strong>
        </article>
      </div>

      <div className="profile-panel">
        <h2>Recent Sets</h2>
        {profileStats.recentSets?.length ? (
          <div className="recent-set-list">
            {profileStats.recentSets.map((set) => (
              <span key={`${set.id}-${set.openedAt}`}>{set.name}</span>
            ))}
          </div>
        ) : (
          <p>Open a pack to start building your recent set history.</p>
        )}
      </div>
    </section>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState("open");
  const [screen, setScreen] = useState("home");
  const [selectedSet, setSelectedSet] = useState(null);
  const [pulledCards, setPulledCards] = useState([]);
  const [collection, setCollection] = useState(() => loadCollection());
  const [profileStats, setProfileStats] = useState(() => loadProfileStats());
  const [isTabLoading, setIsTabLoading] = useState(false);
  const [isReturningToSet, setIsReturningToSet] = useState(false);
  const returnTokenRef = useRef(0);
  const tabLoadTokenRef = useRef(0);

  function selectMainTab(tab) {
    if (tab === activeTab) return;

    const token = tabLoadTokenRef.current + 1;

    tabLoadTokenRef.current = token;
    setIsTabLoading(true);
    setIsReturningToSet(false);
    setActiveTab(tab);

    if (tab === "open") {
      setScreen("home");
      setSelectedSet(null);
      setPulledCards([]);
    } else {
      setScreen(tab);
    }

    window.setTimeout(() => {
      if (tabLoadTokenRef.current === token) {
        setIsTabLoading(false);
      }
    }, TAB_LOADING_MS);
  }

  function startPackOpening(set = selectedSet) {
    if (!set || !canGeneratePack(set)) return;

    setIsReturningToSet(false);
    setActiveTab("open");
    setSelectedSet(set);
    setPulledCards([]);
    setScreen("opening");
    setIsTabLoading(false);
  }

  function revealPack() {
    if (!selectedSet) return;

    setPulledCards(generatePack(selectedSet));
    setProfileStats((currentStats) => {
      const nextStats = updatePackOpenedStats(currentStats, selectedSet);

      saveProfileStats(nextStats);
      return nextStats;
    });
    setScreen("reveal");
  }

  function viewCollection(set = selectedSet) {
    if (!set) return;

    setActiveTab("open");
    setSelectedSet(set);
    setScreen("setCollection");
    setIsTabLoading(false);
  }

  function handleCardsRevealed(cards) {
    if (!selectedSet || !cards.length) return;

    const currentCollection = loadCollection();
    const nextCollection = markCardsCollected(currentCollection, cards, selectedSet.id);

    saveCollection(nextCollection);
    setCollection(nextCollection);
  }

  function backToSets() {
    const token = returnTokenRef.current + 1;
    const start = performance.now();

    returnTokenRef.current = token;
    setIsReturningToSet(true);

    window.setTimeout(() => {
      if (returnTokenRef.current !== token) return;

      setPulledCards([]);
      setSelectedSet(null);
      setActiveTab("open");
      setScreen("home");

      const elapsed = performance.now() - start;
      const remaining = Math.max(0, MIN_RETURN_LOADING_MS - elapsed);

      window.setTimeout(() => {
        if (returnTokenRef.current === token) {
          setIsReturningToSet(false);
        }
      }, remaining);
    }, RETURN_LOADING_RENDER_DELAY_MS);
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="site-brand">
          <img className="site-brand__icon" src="/packdex-small.png" alt="" />
          <span>PackDex</span>
        </div>
        <nav className="main-tabs" aria-label="Main navigation">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "is-active" : ""}
              type="button"
              onClick={() => selectMainTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === "open" && screen === "home" && (
        <section className="home-brand-hero" aria-label="PackDex">
          <img className="site-logo" src="/packdex-large.png" alt="PackDex" />
          <h1>PackDex: Pokemon TCG Pack Opening Simulator</h1>
        </section>
      )}

      {activeTab === "open" && (
        <>
          {screen === "home" && (
            <SetSelect sets={sets} collection={collection} onSelectSet={startPackOpening} onViewCollection={viewCollection} />
          )}

          {screen === "opening" && selectedSet && (
            <PackOpening
              set={selectedSet}
              onOpened={revealPack}
              onBackToSets={backToSets}
              onViewCollection={viewCollection}
            />
          )}

          {screen === "reveal" && selectedSet && (
            <CardReveal
              cards={pulledCards}
              set={selectedSet}
              onCardsRevealed={handleCardsRevealed}
              onComplete={() => setScreen("summary")}
              onBackToSets={backToSets}
            />
          )}

          {screen === "summary" && selectedSet && (
            <PullSummary
              cards={pulledCards}
              set={selectedSet}
              collection={collection}
              onOpenAnother={() => startPackOpening(selectedSet)}
              onBackToSets={backToSets}
              onViewCollection={viewCollection}
            />
          )}

          {screen === "setCollection" && selectedSet && (
            <CollectionPage
              set={selectedSet}
              collection={collection}
              onOpenPacks={startPackOpening}
              onBackToSets={backToSets}
            />
          )}
        </>
      )}

      {activeTab === "collection" && <CollectionDashboard collection={collection} />}

      {activeTab === "profile" && <ProfilePage collection={collection} profileStats={profileStats} />}

      <SiteFooter />
      {isTabLoading && <TabLoadingOverlay />}
      {isReturningToSet && <LoadingOverlay />}
    </main>
  );
}

export default App;
