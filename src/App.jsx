import { useEffect, useMemo, useRef, useState } from "react";
import PackOpening from "./components/PackOpening.jsx";
import CardReveal from "./components/CardReveal.jsx";
import CardDetailModal from "./components/CardDetailModal.jsx";
import CollectionPage from "./components/CollectionPage.jsx";
import FoilCard from "./components/FoilCard.jsx";
import PullSummary from "./components/PullSummary.jsx";
import SetSelect from "./components/SetSelect.jsx";
import { sets } from "./data/sets.js";
import { canGeneratePack, generatePack, getDisplayCardName, getDisplayRarity } from "./utils/packGenerator.js";
import {
  addCardToBinder,
  clearBinderCards,
  createBinder,
  getBinderCardKey,
  loadBinders,
  removeCardFromBinder,
  saveBinders,
} from "./utils/binderStorage.js";
import {
  getCardCollectionKey,
  getCardCount,
  getPullableCollectionCards,
  isCardCollected,
  loadCollection,
  markCardsCollected,
  saveCollection,
} from "./utils/collectionStorage.js";
import { getPokeballLoadingUrl, getSetLogoUrl } from "./utils/assetUrls.js";
import { compareCardsByRarity } from "./utils/rarityRank.js";

const TAB_LOADING_MS = 420;
const MIN_RETURN_LOADING_MS = 450;
const RETURN_LOADING_RENDER_DELAY_MS = 100;
const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();
const PACK_STATS_STORAGE_KEY = "packdex-profile-stats";
const COLLECTION_DASHBOARD_PAGE_SIZE = 60;
const BINDER_PAGE_SIZE = 9;
const ACTIVE_BINDER_STORAGE_KEY = "packdex-active-binder-id";

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

function getBinderDisplayCards(binder, collection) {
  return (binder?.cards || [])
    .map((item) => {
      const set = sets.find((candidateSet) => candidateSet.id === item.setId);

      if (!set) return null;

      const card = getPullableCollectionCards(set).find((candidateCard) => getBinderCardKey(candidateCard, set.id) === item.key);

      if (!card || !isCardCollected(collection, card, set.id)) return null;

      return {
        ...item,
        card,
        set,
        count: getCardCount(collection, card, set.id),
      };
    })
    .filter(Boolean);
}

function sortBinderCards(cards, sortMode) {
  const sorted = [...cards];

  if (sortMode === "rarity") {
    sorted.sort((a, b) => compareCardsByRarity(a.card, b.card, a.set, b.set));
    return sorted;
  }

  if (sortMode === "set") {
    sorted.sort(
      (a, b) =>
        String(a.set.name || "").localeCompare(String(b.set.name || "")) ||
        compareCardsByRarity(a.card, b.card, a.set, b.set)
    );
    return sorted;
  }

  sorted.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.addedAt || 0) - (b.addedAt || 0));
  return sorted;
}

function CollectionDashboard({ collection, binders, onAddToBinder, onRemoveFromBinder }) {
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
        if (sortMode === "rarity") return compareCardsByRarity(a.card, b.card, a.set, b.set);
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
                  <strong>{getDisplayCardName(card, set)}</strong>
                  <span>
                    {set.name} - {getDisplayRarity(card, set)}
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
          showBinderControl
          binders={binders}
          onAddToBinder={onAddToBinder}
          onRemoveFromBinder={onRemoveFromBinder}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </section>
  );
}

const BINDER_TAGS = [...new Set([
  "Favorites",
  "Pulls",
  "Trade Binder",
  "Master Set",
  "Deck Ideas",
  "Chase Cards",
  "Scarlet & Violet",
  "Sword & Shield",
  "Sun & Moon",
  "XY",
  "Full Art Collection",
  ...sets.map((set) => set.name),
])];

const BINDER_TAG_BASE_SET_IDS = {
  "Scarlet & Violet": "scarlet-violet",
  "Sword & Shield": "sword-shield",
  "Sun & Moon": "sun-moon",
  XY: "xy1",
};

function getBinderTagLogo(tag) {
  const setId = BINDER_TAG_BASE_SET_IDS[tag];
  const set = sets.find((candidateSet) => candidateSet.id === setId || candidateSet.name === tag);

  return set ? getSetLogoUrl(set) : "";
}

function loadActiveBinderId() {
  if (typeof window === "undefined") return "";

  return window.localStorage.getItem(ACTIVE_BINDER_STORAGE_KEY) || "";
}

function saveActiveBinderId(binderId) {
  if (typeof window === "undefined") return;

  if (binderId) {
    window.localStorage.setItem(ACTIVE_BINDER_STORAGE_KEY, binderId);
  } else {
    window.localStorage.removeItem(ACTIVE_BINDER_STORAGE_KEY);
  }
}

function BinderSection({ binders, collection, onCreateBinder, onClearBinder, onAddToBinder, onRemoveFromBinder }) {
  const [activeBinderId, setActiveBinderId] = useState(() => loadActiveBinderId());
  const [newBinderName, setNewBinderName] = useState("");
  const [newBinderTag, setNewBinderTag] = useState(BINDER_TAGS[0]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [nameError, setNameError] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [addEraFilter, setAddEraFilter] = useState("all");
  const [addSetFilter, setAddSetFilter] = useState("all");
  const [addRarityFilter, setAddRarityFilter] = useState("all");
  const [sortMode, setSortMode] = useState("order");
  const [page, setPage] = useState(1);
  const [selectedCard, setSelectedCard] = useState(null);
  const activeBinder = useMemo(
    () => binders.find((binder) => binder.id === activeBinderId) || null,
    [activeBinderId, binders]
  );
  const binderDisplayCards = useMemo(() => getBinderDisplayCards(activeBinder, collection), [activeBinder, collection]);
  const sortedBinderCards = useMemo(() => sortBinderCards(binderDisplayCards, sortMode), [binderDisplayCards, sortMode]);
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const addEraOptions = useMemo(
    () => ["all", ...new Set(collectedCards.map(({ set }) => set.era || "Other"))],
    [collectedCards]
  );
  const addSetOptions = useMemo(
    () => collectedCards.map(({ set }) => set).filter((set, index, allSets) => allSets.findIndex((item) => item.id === set.id) === index),
    [collectedCards]
  );
  const addRarityOptions = useMemo(
    () => ["all", ...new Set(collectedCards.map(({ card, set }) => getDisplayRarity(card, set)))],
    [collectedCards]
  );
  const addableCards = useMemo(() => {
    if (!activeBinder) return [];

    const existingKeys = new Set(activeBinder.cards.map((item) => item.key));
    const search = addQuery.toLowerCase().trim();

    return getCollectedCards(collection)
      .filter(({ card, set }) => {
        if (existingKeys.has(getBinderCardKey(card, set.id))) return false;

        const displayRarity = getDisplayRarity(card, set);
        const matchesEra = addEraFilter === "all" || (set.era || "Other") === addEraFilter;
        const matchesSet = addSetFilter === "all" || set.id === addSetFilter;
        const matchesRarity = addRarityFilter === "all" || displayRarity === addRarityFilter;

        return (
          matchesEra &&
          matchesSet &&
          matchesRarity &&
          (!search ||
            String(card.name || "").toLowerCase().includes(search) ||
            String(card.rarity || "").toLowerCase().includes(search) ||
            String(set.name || "").toLowerCase().includes(search) ||
            displayRarity.toLowerCase().includes(search))
        );
      })
      .sort((a, b) => compareCardsByRarity(a.card, b.card, a.set, b.set));
  }, [activeBinder, addEraFilter, addQuery, addRarityFilter, addSetFilter, collection]);
  const totalPages = Math.max(1, Math.ceil(sortedBinderCards.length / BINDER_PAGE_SIZE));
  const pageCards = sortedBinderCards.slice((page - 1) * BINDER_PAGE_SIZE, page * BINDER_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [sortMode, activeBinder?.id, activeBinder?.cards.length]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!activeBinderId) return;

    if (binders.some((binder) => binder.id === activeBinderId)) {
      saveActiveBinderId(activeBinderId);
    } else {
      setActiveBinderId("");
      saveActiveBinderId("");
    }
  }, [activeBinderId, binders]);

  function handleCreateBinder(event) {
    event.preventDefault();
    const trimmedName = newBinderName.trim();

    if (!trimmedName) {
      setNameError("Binder name is required.");
      return;
    }

    const binder = onCreateBinder(trimmedName, newBinderTag);

    setNewBinderName("");
    setNewBinderTag(BINDER_TAGS[0]);
    setNameError("");
    setIsCreateOpen(false);
    if (binder?.id) {
      setActiveBinderId(binder.id);
      saveActiveBinderId(binder.id);
    }
  }

  function handleClearBinder() {
    if (!activeBinder || activeBinder.cards.length === 0) return;

    if (window.confirm(`Clear ${activeBinder.name}? Your actual collection will not be deleted.`)) {
      onClearBinder(activeBinder.id);
    }
  }

  return (
    <div className="profile-panel binder-panel">
      <div className="binder-panel-header">
        <div>
          <h2>My Binders</h2>
          <p>{binders.length > 0 ? "Select one binder to view and manage." : "No binders yet!"}</p>
        </div>
        <div className="binder-controls">
          <label>
            <span>Select binder to display</span>
            <select
              value={activeBinderId}
              onChange={(event) => {
                setActiveBinderId(event.target.value);
                saveActiveBinderId(event.target.value);
              }}
              aria-label="Select binder to display"
              disabled={binders.length === 0}
            >
              <option value="">{binders.length === 0 ? "No binders yet" : "Choose a binder"}</option>
              {binders.map((binder) => (
                <option key={binder.id} value={binder.id}>
                  {binder.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button binder-create-button" type="button" onClick={() => setIsCreateOpen(true)}>
            Create Binder
          </button>
        </div>
      </div>

      {binders.length === 0 && (
        <div className="binder-empty-state">
          <strong>No binders yet!</strong>
          <span>Create your first binder to start organizing your favorite cards.</span>
        </div>
      )}

      {binders.length > 0 && !activeBinder && (
        <div className="binder-empty-state">
          <strong>Choose a binder</strong>
          <span>Choose a binder to view your saved cards.</span>
        </div>
      )}

      {activeBinder && (
        <>
          <div className="binder-view-header">
            <div>
              <h3>{activeBinder.name}</h3>
              <span className="binder-tag-badge">
                {getBinderTagLogo(activeBinder.tag) && <img src={getBinderTagLogo(activeBinder.tag)} alt="" />}
                {activeBinder.tag}
              </span>
            </div>
            <div className="binder-view-controls">
              <strong>{activeBinder.cards.length} saved cards</strong>
              <button className="primary-button binder-add-card-button" type="button" onClick={() => setIsAddOpen(true)}>
                + Add Card
              </button>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label="Sort binder cards">
                <option value="order">Binder Order</option>
                <option value="rarity">Rarity</option>
                <option value="set">Set</option>
              </select>
              <button className="secondary-button binder-clear-button" type="button" onClick={handleClearBinder} disabled={!activeBinder.cards.length}>
                Clear Binder
              </button>
            </div>
          </div>

          <div className="binder-book">
            <div className="binder-rings" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="binder-page" key={`${activeBinder.id}-${page}`}>
              {Array.from({ length: BINDER_PAGE_SIZE }).map((_, index) => {
                const item = pageCards[index];

                return (
                  <div className={`binder-slot ${item ? "is-filled" : "is-empty"}`} key={item?.key || `empty-${index}`}>
                    {item ? (
                      <>
                        <button className="binder-card-button" type="button" onClick={() => setSelectedCard(item)}>
                          <FoilCard
                            card={item.card}
                            set={item.set}
                            variant="collection"
                            enableTransform={false}
                            enableCursorBlob={false}
                            enableTiltFoil={false}
                            showFoil={false}
                          />
                          <span>{getDisplayCardName(item.card, item.set)}</span>
                        </button>
                        <button
                          className="binder-remove-card"
                          type="button"
                          onClick={() => onRemoveFromBinder(item.card, item.set, activeBinder.id)}
                          aria-label={`Remove ${getDisplayCardName(item.card, item.set)} from binder`}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <button
                        className="binder-slot-add"
                        type="button"
                        onClick={() => setIsAddOpen(true)}
                        aria-label="Add card to binder"
                      >
                        <span aria-hidden="true">+</span>
                        <strong>Add Card</strong>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {binderDisplayCards.length === 0 && (
            <div className="binder-empty-state">This binder is empty. Add cards from your Collection.</div>
          )}

          <div className="pagination-controls" aria-label="Binder pages">
            <button type="button" onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))} disabled={page === 1}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button type="button" onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))} disabled={page === totalPages}>
              Next
            </button>
          </div>
        </>
      )}

      {isCreateOpen && (
        <div className="binder-create-overlay" role="dialog" aria-modal="true" aria-label="Create binder">
          <form className="binder-create-modal" onSubmit={handleCreateBinder}>
            <div>
              <span className="set-mark">Binder</span>
              <h3>Create Binder</h3>
              <p>Name it, tag it, and start filling pages from your Collection.</p>
            </div>
            <label>
              Binder name
              <input
                value={newBinderName}
                onChange={(event) => {
                  setNewBinderName(event.target.value);
                  setNameError("");
                }}
                placeholder="Favorite Pulls"
                aria-label="Binder name"
                autoFocus
              />
            </label>
            {nameError && <div className="binder-form-error">{nameError}</div>}
            <label>
              Tag / category
              <select value={newBinderTag} onChange={(event) => setNewBinderTag(event.target.value)} aria-label="Binder tag">
                {BINDER_TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            <div className="binder-create-preview">
              {getBinderTagLogo(newBinderTag) ? <img src={getBinderTagLogo(newBinderTag)} alt="" /> : <span>{newBinderTag}</span>}
            </div>
            <div className="binder-create-actions">
              <button className="secondary-button" type="button" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Create Binder
              </button>
            </div>
          </form>
        </div>
      )}

      {isAddOpen && activeBinder && (
        <div className="binder-create-overlay" role="dialog" aria-modal="true" aria-label="Add card to binder">
          <div className="binder-add-modal">
            <div className="binder-add-header">
              <div>
                <span className="set-mark">Binder</span>
                <h3>Add Card</h3>
                <p>Add an owned card to {activeBinder.name}.</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setIsAddOpen(false)}>
                Close
              </button>
            </div>
            <label className="binder-add-search">
              <span>Search collection</span>
              <input
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="Search by card, set, or rarity"
                type="search"
              />
            </label>
            <div className="binder-add-filters" aria-label="Filter cards to add">
              <label>
                <span>Era</span>
                <select value={addEraFilter} onChange={(event) => setAddEraFilter(event.target.value)}>
                  {addEraOptions.map((era) => (
                    <option key={era} value={era}>
                      {era === "all" ? "All Eras" : era}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Set</span>
                <select value={addSetFilter} onChange={(event) => setAddSetFilter(event.target.value)}>
                  <option value="all">All Sets</option>
                  {addSetOptions.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Rarity</span>
                <select value={addRarityFilter} onChange={(event) => setAddRarityFilter(event.target.value)}>
                  {addRarityOptions.map((rarity) => (
                    <option key={rarity} value={rarity}>
                      {rarity === "all" ? "All Rarities" : rarity}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {addableCards.length === 0 ? (
              <div className="binder-empty-state">
                <strong>No cards to add</strong>
                <span>Every matching collected card is already in this binder.</span>
              </div>
            ) : (
              <div className="binder-add-grid">
                {addableCards.map(({ card, set, count }) => (
                  <button
                    className="binder-add-card"
                    key={getBinderCardKey(card, set.id)}
                    type="button"
                    onClick={() => onAddToBinder(card, set, activeBinder.id)}
                  >
                    <FoilCard
                      card={card}
                      set={set}
                      variant="collection"
                      enableTransform={false}
                      enableCursorBlob={false}
                      enableTiltFoil={false}
                      showFoil={false}
                    />
                    <span>
                      <strong>{getDisplayCardName(card, set)}</strong>
                      <em>
                        {set.name} - {getDisplayRarity(card, set)}
                        {count > 1 ? ` x${count}` : ""}
                      </em>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedCard && (
        <CardDetailModal
          card={selectedCard.card}
          set={selectedCard.set}
          collected
          count={selectedCard.count}
          showBinderControl
          binders={binders}
          onAddToBinder={onAddToBinder}
          onRemoveFromBinder={onRemoveFromBinder}
          onCreateBinder={() => setIsCreateOpen(true)}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </div>
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

function ProfilePage({ collection, profileStats, binders, onCreateBinder, onClearBinder, onAddToBinder, onRemoveFromBinder }) {
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

      <BinderSection
        binders={binders}
        collection={collection}
        onCreateBinder={onCreateBinder}
        onClearBinder={onClearBinder}
        onAddToBinder={onAddToBinder}
        onRemoveFromBinder={onRemoveFromBinder}
      />
    </section>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState("open");
  const [screen, setScreen] = useState("home");
  const [selectedSet, setSelectedSet] = useState(null);
  const [pulledCards, setPulledCards] = useState([]);
  const [collection, setCollection] = useState(() => loadCollection());
  const [binders, setBinders] = useState(() => loadBinders());
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

  function handleCreateBinder(name, tag) {
    const binder = createBinder({ name, tag });

    setBinders((currentBinders) => {
      const nextBinders = [binder, ...currentBinders];

      saveBinders(nextBinders);
      return nextBinders;
    });

    return binder;
  }

  function handleAddToBinder(card, set, binderId) {
    setBinders((currentBinders) => {
      if (!isCardCollected(collection, card, set.id)) return currentBinders;

      const targetBinderId = binderId || currentBinders[0]?.id;

      if (!targetBinderId) return currentBinders;

      const nextBinders = addCardToBinder(currentBinders, targetBinderId, card, set.id);

      saveBinders(nextBinders);
      return nextBinders;
    });
  }

  function handleRemoveFromBinder(card, set, binderId) {
    setBinders((currentBinders) => {
      const targetBinderId = binderId || currentBinders[0]?.id;

      if (!targetBinderId) return currentBinders;

      const nextBinders = removeCardFromBinder(currentBinders, targetBinderId, card, set.id);

      saveBinders(nextBinders);
      return nextBinders;
    });
  }

  function handleClearBinder(binderId) {
    setBinders((currentBinders) => {
      const nextBinders = clearBinderCards(currentBinders, binderId);

      saveBinders(nextBinders);
      return nextBinders;
    });
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
          binders={binders}
          onAddToBinder={handleAddToBinder}
          onRemoveFromBinder={handleRemoveFromBinder}
          onOpenPacks={startPackOpening}
          onBackToSets={backToSets}
        />
          )}
        </>
      )}

      {activeTab === "collection" && (
        <CollectionDashboard
          collection={collection}
          binders={binders}
          onAddToBinder={handleAddToBinder}
          onRemoveFromBinder={handleRemoveFromBinder}
        />
      )}

      {activeTab === "profile" && (
        <ProfilePage
          collection={collection}
          profileStats={profileStats}
          binders={binders}
          onCreateBinder={handleCreateBinder}
          onClearBinder={handleClearBinder}
          onAddToBinder={handleAddToBinder}
          onRemoveFromBinder={handleRemoveFromBinder}
        />
      )}

      <SiteFooter />
      {isTabLoading && <TabLoadingOverlay />}
      {isReturningToSet && <LoadingOverlay />}
    </main>
  );
}

export default App;
