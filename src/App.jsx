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
import {
  getCardImageUrl,
  getPokeballLoadingUrl,
} from "./utils/assetUrls.js";

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

function preloadImages(urls) {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve) => {
          if (!url) {
            resolve();
            return;
          }

          const img = new Image();
          img.decoding = "async";

          img.onload = async () => {
            try {
              if (img.decode) {
                await img.decode();
              }
            } catch {
              // Continue even if decoding fails.
            }

            resolve();
          };

          img.onerror = resolve;
          img.src = url;
        })
    )
  );
}

function LoadingOverlay() {
  return (
    <div className="loading-overlay">
      <img src={POKEBALL_LOADING_SRC} alt="" />
      <span>Returning to set...</span>
    </div>
  );
}

function TabLoadingOverlay() {
  return (
    <div className="loading-overlay">
      <img src={POKEBALL_LOADING_SRC} alt="" />
      <span>Loading...</span>
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
    () =>
      collectedCards
        .map(({ set }) => set)
        .filter(
          (set, index, allSets) =>
            allSets.findIndex((item) => item.id === set.id) === index
        ),
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
        if (sortMode === "name") {
          return String(a.card.name || "").localeCompare(String(b.card.name || ""));
        }

        if (sortMode === "rarity") {
          return String(a.card.rarity || "").localeCompare(String(b.card.rarity || ""));
        }

        if (sortMode === "set") {
          return String(a.set.name || "").localeCompare(String(b.set.name || ""));
        }

        const keyA = getCardCollectionKey(a.card, a.set.id);
        const keyB = getCardCollectionKey(b.card, b.set.id);

        return (
          (collection[b.set.id]?.[keyB]?.lastCollectedAt || 0) -
          (collection[a.set.id]?.[keyA]?.lastCollectedAt || 0)
        );
      });
  }, [collectedCards, collection, eraFilter, query, setFilter, sortMode]);

  const totalPages = Math.max(
    1,
    Math.ceil(visibleCards.length / COLLECTION_DASHBOARD_PAGE_SIZE)
  );

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
    <section className="dashboard-page">
      <span className="reveal-status">Collection</span>

      <h1 className="brand-title">Collected Cards</h1>

      <p>Your pulled cards across every set live here.</p>

      {collectedCards.length === 0 ? (
        <div className="empty-state-card">
          <h2>No cards collected yet</h2>
          <p>Open a few packs first and your collection will start filling in here.</p>
        </div>
      ) : (
        <>
          <div className="collection-controls">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search collected cards"
            />

            <select
              value={eraFilter}
              onChange={(event) => setEraFilter(event.target.value)}
              aria-label="Filter by era"
            >
              {eraOptions.map((era) => (
                <option key={era} value={era}>
                  {era === "all" ? "All Eras" : era}
                </option>
              ))}
            </select>

            <select
              value={setFilter}
              onChange={(event) => setSetFilter(event.target.value)}
              aria-label="Filter by set"
            >
              <option value="all">All Sets</option>
              {setOptions.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </select>

            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value)}
              aria-label="Sort collected cards"
            >
              <option value="recent">Recently Collected</option>
              <option value="name">Name</option>
              <option value="rarity">Rarity</option>
              <option value="set">Set</option>
            </select>
          </div>

          <div className="collection-card-grid">
            {pagedCards.map(({ card, set, count }) => (
              <button
                className="collection-card-button"
                key={`${set.id}-${getCardCollectionKey(card, set.id)}`}
                onClick={() => setSelectedCard({ card, set, count })}
              >
                <FoilCard card={card} set={set} variant="collection" />

                {count > 1 && <span className="card-count-badge">x{count}</span>}

                <span className="collection-card-name">{card.name}</span>
                <span className="collection-card-meta">
                  {set.name} - {card.rarity}
                </span>
              </button>
            ))}
          </div>

          {visibleCards.length > COLLECTION_DASHBOARD_PAGE_SIZE && (
            <div className="pagination-controls">
              <button
                className="secondary-button"
                onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                disabled={page === 1}
              >
                Previous
              </button>

              <span>
                Page {page} of {totalPages} - {visibleCards.length} cards
              </span>

              <button
                className="secondary-button"
                onClick={() =>
                  setPage((currentPage) => Math.min(totalPages, currentPage + 1))
                }
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
      <div className="footer-brand">
        <img src="/packdex-logo.png" alt="" />
        <span>PackDex</span>
      </div>

      <p>
        PackDex is a fan-made Pokémon TCG pack opening simulator. PackDex is not
        affiliated with, endorsed by, sponsored by, or associated with Nintendo, The
        Pokémon Company, Creatures Inc., or Game Freak. Pokémon, Pokémon TCG, and
        related names, images, and trademarks are the property of their respective owners.
        All card images and related assets are used for informational and entertainment
        purposes only.
      </p>

      <p>
        © 2026 PackDex. All rights reserved.{" "}
        <a href="/credits" target="_blank" rel="noreferrer">
          Image Credits
        </a>
      </p>
    </footer>
  );
}

function ProfilePage({ collection, profileStats }) {
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const uniqueCards = collectedCards.length;
  const totalCards = collectedCards.reduce((sum, item) => sum + item.count, 0);

  const completedSets = sets.filter((set) => {
    const pullableCards = getPullableCollectionCards(set);

    return (
      pullableCards.length > 0 &&
      pullableCards.every((card) => isCardCollected(collection, card, set.id))
    );
  }).length;

  return (
    <section className="dashboard-page">
      <span className="reveal-status">Profile</span>

      <h1 className="brand-title">Your PackDex</h1>

      <p>A local snapshot of your pack-opening journey.</p>

      <div className="profile-stat-grid">
        <div>
          <span>Total Cards</span>
          <strong>{totalCards}</strong>
        </div>

        <div>
          <span>Unique Cards</span>
          <strong>{uniqueCards}</strong>
        </div>

        <div>
          <span>Packs Opened</span>
          <strong>{profileStats.packsOpened || 0}</strong>
        </div>

        <div>
          <span>Completed Sets</span>
          <strong>{completedSets}</strong>
        </div>
      </div>

      <h2>Recent Sets</h2>

      {profileStats.recentSets?.length ? (
        <ul className="recent-set-list">
          {profileStats.recentSets.map((set) => (
            <li key={`${set.id}-${set.openedAt}`}>{set.name}</li>
          ))}
        </ul>
      ) : (
        <p>Open a pack to start building your recent set history.</p>
      )}
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
  const [isPackPreloading, setIsPackPreloading] = useState(false);

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

  async function revealPack() {
    if (!selectedSet || isPackPreloading) return;

    setIsPackPreloading(true);

    const nextPulledCards = generatePack(selectedSet);
    const imageUrls = nextPulledCards.map((card) => getCardImageUrl(card));

    await preloadImages(imageUrls);

    setPulledCards(nextPulledCards);

    setProfileStats((currentStats) => {
      const nextStats = updatePackOpenedStats(currentStats, selectedSet);
      saveProfileStats(nextStats);
      return nextStats;
    });

    setIsPackPreloading(false);
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
    <>
      <header className="site-header">
        <button className="site-logo" onClick={() => selectMainTab("open")}>
          <img src="/packdex-logo.png" alt="" />
          <span>PackDex</span>
        </button>

        <nav className="main-tabs" aria-label="Main navigation">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "is-active" : ""}
              onClick={() => selectMainTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-shell">
        {activeTab === "open" && screen === "home" && (
          <section className="hero-section">
            <img className="hero-logo" src="/packdex-logo.png" alt="PackDex" />
            <h1 className="brand-title">PackDex: Pokemon TCG Pack Opening Simulator</h1>
          </section>
        )}

        {activeTab === "open" && (
          <>
            {screen === "home" && <SetSelect sets={sets} onSelect={startPackOpening} />}

            {screen === "opening" && selectedSet && (
              <PackOpening
                set={selectedSet}
                onOpened={revealPack}
                onBackToSets={backToSets}
                onViewCollection={viewCollection}
                isPreloading={isPackPreloading}
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
                onOpenAnother={() => startPackOpening(selectedSet)}
                onBackToSets={backToSets}
                onViewCollection={viewCollection}
              />
            )}

            {screen === "setCollection" && selectedSet && (
              <CollectionPage
                set={selectedSet}
                collection={collection}
                onBackToPack={() => startPackOpening(selectedSet)}
                onBackToSets={backToSets}
              />
            )}
          </>
        )}

        {activeTab === "collection" && <CollectionDashboard collection={collection} />}

        {activeTab === "profile" && (
          <ProfilePage collection={collection} profileStats={profileStats} />
        )}
      </main>

      <SiteFooter />

      {isTabLoading && <TabLoadingOverlay />}
      {isReturningToSet && <LoadingOverlay />}
    </>
  );
}

export default App;
