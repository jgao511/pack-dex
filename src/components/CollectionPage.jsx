import { BookOpen, ChevronLeft, ChevronRight, PackageOpen, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import CardDetailModal from "./CardDetailModal.jsx";
import FoilCard from "./FoilCard.jsx";
import { getRemoteSetLogoUrl, getSetLogoUrl } from "../utils/assetUrls.js";
import {
  getCardCount,
  getPullableCollectionCards,
  getSetCollectionProgress,
  isCardCollected,
} from "../utils/collectionStorage.js";
import { getDisplayCardName, getDisplayRarity } from "../utils/packGenerator.js";
import { compareCardsByRarity } from "../utils/rarityRank.js";

const COLLECTION_PAGE_SIZE = 60;
const MASTER_BINDER_PAGE_SIZE = 9;
const MASTER_BINDER_COLORS_KEY = "packdex-master-binder-cover-colors";
const MASTER_BINDER_COLOR_OPTIONS = [
  { id: "midnight", label: "Midnight", value: "#18213f" },
  { id: "royal", label: "Royal", value: "#2557b8" },
  { id: "crimson", label: "Crimson", value: "#9f283d" },
  { id: "forest", label: "Forest", value: "#1d6b4f" },
  { id: "gold", label: "Gold", value: "#c58a21" },
];

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function numberValue(card) {
  const number = String(card.number || "");
  const parsed = Number.parseInt(number, 10);

  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function sortCards(cards, sortMode, set) {
  const sorted = [...cards];

  if (sortMode === "name") {
    sorted.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return sorted;
  }

  if (sortMode === "rarity") {
    sorted.sort(
      (a, b) =>
        compareCardsByRarity(a, b, set, set) ||
        numberValue(a) - numberValue(b) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );
    return sorted;
  }

  sorted.sort(
    (a, b) =>
      numberValue(a) - numberValue(b) ||
      String(a.number || "").localeCompare(String(b.number || "")) ||
      String(a.name || "").localeCompare(String(b.name || ""))
  );
  return sorted;
}

function chunkCards(cards, size) {
  const chunks = [];

  for (let index = 0; index < cards.length; index += size) {
    chunks.push(cards.slice(index, index + size));
  }

  return chunks;
}

function safeParseCoverColors(value) {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadMasterBinderCoverColor(setId) {
  if (typeof window === "undefined") return MASTER_BINDER_COLOR_OPTIONS[0].id;

  const savedColors = safeParseCoverColors(window.localStorage.getItem(MASTER_BINDER_COLORS_KEY));

  return savedColors[setId] || MASTER_BINDER_COLOR_OPTIONS[0].id;
}

function saveMasterBinderCoverColor(setId, colorId) {
  if (typeof window === "undefined") return;

  const savedColors = safeParseCoverColors(window.localStorage.getItem(MASTER_BINDER_COLORS_KEY));

  window.localStorage.setItem(
    MASTER_BINDER_COLORS_KEY,
    JSON.stringify({
      ...savedColors,
      [setId]: colorId,
    })
  );
}

function useIsMobileBinder() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 720px)").matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const handleChange = () => setIsMobile(mediaQuery.matches);

    handleChange();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener?.(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener?.(handleChange);
      }
    };
  }, []);

  return isMobile;
}

function SetLogo({ set }) {
  const [logoSource, setLogoSource] = useState("local");
  const logoUrl = getSetLogoUrl(set);
  const remoteLogoUrl = getRemoteSetLogoUrl(set);
  const displayLogoUrl = logoSource === "remote" ? remoteLogoUrl : logoUrl;

  useEffect(() => {
    setLogoSource("local");
  }, [logoUrl]);

  if (!displayLogoUrl || logoSource === "failed") return <h1 className="brand-title">{set.name}</h1>;

  return (
    <img
      className="collection-logo"
      src={displayLogoUrl}
      alt={`${set.name} logo`}
      onError={() => setLogoSource(logoSource === "local" && remoteLogoUrl ? "remote" : "failed")}
    />
  );
}

function CollectionPage({
  set,
  collection,
  binders = [],
  user,
  onAddToBinder,
  onRemoveFromBinder,
  onOpenAuth,
  onOpenPacks,
  onBackToSets,
}) {
  const [filter, setFilter] = useState("all");
  const [sortMode, setSortMode] = useState("number");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedCard, setSelectedCard] = useState(null);
  const [viewMode, setViewMode] = useState("grid");
  const [isMasterBinderOpen, setIsMasterBinderOpen] = useState(false);
  const [masterBinderPage, setMasterBinderPage] = useState(0);
  const [coverColorId, setCoverColorId] = useState(() => loadMasterBinderCoverColor(set.id));
  const isMobileBinder = useIsMobileBinder();
  const progress = getSetCollectionProgress(collection, set);
  const cards = useMemo(() => getPullableCollectionCards(set), [set]);
  const masterCards = useMemo(() => sortCards(cards, "number", set), [cards, set]);
  const masterPages = useMemo(() => chunkCards(masterCards, MASTER_BINDER_PAGE_SIZE), [masterCards]);
  const masterPageCount = Math.max(1, masterPages.length);
  const masterMissingCount = Math.max(0, progress.total - progress.collected);
  const coverColor =
    MASTER_BINDER_COLOR_OPTIONS.find((option) => option.id === coverColorId) || MASTER_BINDER_COLOR_OPTIONS[0];
  const binderPagesPerView = isMobileBinder || masterBinderPage === 0 ? 1 : 2;
  const visibleMasterPages = masterPages.slice(masterBinderPage, masterBinderPage + binderPagesPerView);
  const visibleMasterPageNumbers =
    visibleMasterPages.length > 1
      ? `${masterBinderPage + 1}-${masterBinderPage + visibleMasterPages.length}`
      : `${masterBinderPage + 1}`;
  const visibleCards = useMemo(() => {
    const search = normalizeText(query);

    return sortCards(
      cards.filter((card) => {
        const collected = isCardCollected(collection, card, set.id);
        const matchesFilter =
          filter === "all" || (filter === "collected" && collected) || (filter === "missing" && !collected);
        const matchesSearch =
          !search ||
          normalizeText(card.name).includes(search) ||
          normalizeText(card.number).includes(search) ||
          normalizeText(card.rarity).includes(search);

        return matchesFilter && matchesSearch;
      }),
      sortMode,
      set
    );
  }, [cards, collection, filter, query, set.id, sortMode]);
  const totalPages = Math.max(1, Math.ceil(visibleCards.length / COLLECTION_PAGE_SIZE));
  const pagedCards = visibleCards.slice((page - 1) * COLLECTION_PAGE_SIZE, page * COLLECTION_PAGE_SIZE);
  const selectedCollected = selectedCard ? isCardCollected(collection, selectedCard, set.id) : false;
  const selectedCount = selectedCard ? getCardCount(collection, selectedCard, set.id) : 0;

  useEffect(() => {
    setPage(1);
  }, [filter, query, sortMode, set.id]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setViewMode("grid");
    setIsMasterBinderOpen(false);
    setMasterBinderPage(0);
    setCoverColorId(loadMasterBinderCoverColor(set.id));
  }, [set.id]);

  useEffect(() => {
    saveMasterBinderCoverColor(set.id, coverColorId);
  }, [coverColorId, set.id]);

  useEffect(() => {
    setMasterBinderPage((currentPage) => Math.min(currentPage, masterPageCount - 1));
  }, [masterPageCount]);

  function openMasterBinderCover() {
    setViewMode("masterBinder");
    setIsMasterBinderOpen(false);
    setMasterBinderPage(0);
  }

  function showCollectionGrid() {
    setViewMode("grid");
    setIsMasterBinderOpen(false);
  }

  function goToPreviousBinderPage() {
    setMasterBinderPage((currentPage) => {
      if (currentPage <= 1) return 0;

      return Math.max(1, currentPage - (isMobileBinder ? 1 : 2));
    });
  }

  function goToNextBinderPage() {
    setMasterBinderPage((currentPage) => Math.min(masterPageCount - 1, currentPage + binderPagesPerView));
  }

  function renderMasterBinderSlot(card, slotIndex) {
    if (!card) {
      return <div className="master-binder-slot is-empty" key={`empty-${slotIndex}`} aria-hidden="true" />;
    }

    const collected = isCardCollected(collection, card, set.id);
    const count = getCardCount(collection, card, set.id);

    return (
      <button
        className={`master-binder-slot ${collected ? "is-collected" : "is-missing"}`}
        key={card.id || `${set.id}-${card.number}-${card.name}`}
        onClick={() => setSelectedCard(card)}
        type="button"
      >
        <FoilCard
          card={card}
          set={set}
          variant="collection"
          className={collected ? "" : "is-uncollected-preview"}
          enableTransform={false}
          enableCursorBlob={false}
          enableTiltFoil={false}
          showFoil={false}
        />
        <span className="master-binder-card-meta">
          <strong>#{card.number}</strong>
          <em>{collected ? getDisplayRarity(card, set) : "Not collected yet"}</em>
        </span>
        {!collected && <span className="missing-badge">Missing</span>}
        {count > 1 && <span className="count-badge">x{count}</span>}
      </button>
    );
  }

  return (
    <section className="collection-screen">
      <header className="collection-header">
        <div className="collection-title">
          <span className="set-mark">Collection</span>
          <SetLogo set={set} />
          <h1>{set.name}</h1>
        </div>

        <div className="collection-progress-panel">
          <div className="collection-progress-copy">
            <strong>
              {progress.collected} / {progress.total}
            </strong>
            <span>{progress.percent}% complete</span>
          </div>
          <div className="collection-progress-bar" aria-hidden="true">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="collection-actions">
            <button className="secondary-button" onClick={onBackToSets}>
              Return to Sets
            </button>
            <button className="secondary-button" onClick={openMasterBinderCover} type="button">
              <BookOpen size={20} aria-hidden="true" />
              View Master Set Binder
            </button>
            <button className="primary-button" onClick={() => onOpenPacks(set)}>
              <PackageOpen size={20} aria-hidden="true" />
              Open Packs
            </button>
          </div>
        </div>
      </header>

      {!user && (
        <div className="auth-save-notice">
          <button type="button" onClick={onOpenAuth}>
            Log in
          </button>{" "}
          or{" "}
          <button type="button" onClick={onOpenAuth}>
            create an account
          </button>{" "}
          to save your pulls across devices.
        </div>
      )}

      {viewMode === "masterBinder" ? (
        <section className="master-binder-view">
          {!isMasterBinderOpen ? (
            <div className="master-binder-cover-stage">
              <div className="master-binder-cover" style={{ "--master-cover": coverColor.value }}>
                <div className="master-binder-cover__spine" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="master-binder-cover__content">
                  <span className="set-mark">Master Set Binder</span>
                  <SetLogo set={set} />
                  <h2>{set.name}</h2>
                  <div className="master-binder-progress">
                    <div className="collection-progress-copy">
                      <strong>
                        {progress.collected} / {progress.total}
                      </strong>
                      <span>{progress.percent}% complete</span>
                    </div>
                    <div className="collection-progress-bar" aria-hidden="true">
                      <span style={{ width: `${progress.percent}%` }} />
                    </div>
                    <p>{masterMissingCount} cards still missing from this master set.</p>
                  </div>
                  <div className="master-binder-color-picker" aria-label="Binder cover color">
                    {MASTER_BINDER_COLOR_OPTIONS.map((option) => (
                      <button
                        className={coverColorId === option.id ? "is-active" : ""}
                        key={option.id}
                        onClick={() => setCoverColorId(option.id)}
                        style={{ "--swatch": option.value }}
                        type="button"
                      >
                        <span aria-hidden="true" />
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="master-binder-cover-actions">
                    <button className="secondary-button" onClick={showCollectionGrid} type="button">
                      Back to Collection
                    </button>
                    <button className="primary-button" onClick={() => setIsMasterBinderOpen(true)} type="button">
                      <BookOpen size={20} aria-hidden="true" />
                      Open Binder
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="master-binder-pages">
              <div className="master-binder-toolbar">
                <div>
                  <span className="set-mark">Master Set Binder</span>
                  <strong>
                    Page {visibleMasterPageNumbers} of {masterPageCount}
                  </strong>
                  <em>{masterMissingCount} missing cards</em>
                </div>
                <button className="secondary-button" onClick={() => setIsMasterBinderOpen(false)} type="button">
                  Binder Cover
                </button>
              </div>

              <div className="master-binder-page-progress">
                <div className="collection-progress-copy">
                  <strong>
                    {progress.collected} / {progress.total}
                  </strong>
                  <span>{progress.percent}% complete</span>
                </div>
                <div className="collection-progress-bar" aria-hidden="true">
                  <span style={{ width: `${progress.percent}%` }} />
                </div>
              </div>

              <div className={`master-binder-spread ${visibleMasterPages.length > 1 ? "is-spread" : "is-single"}`}>
                {(visibleMasterPages.length > 0 ? visibleMasterPages : [[]]).map((pageCards, spreadIndex) => {
                  const pageNumber = masterBinderPage + spreadIndex + 1;
                  const slots = Array.from({ length: MASTER_BINDER_PAGE_SIZE }, (_, slotIndex) => pageCards[slotIndex]);

                  return (
                    <div className="master-binder-page" key={`master-page-${pageNumber}`}>
                      <div className="master-binder-page__label">Page {pageNumber}</div>
                      <div className="master-binder-pocket-grid">
                        {slots.map((card, slotIndex) => renderMasterBinderSlot(card, `${pageNumber}-${slotIndex}`))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="master-binder-nav" aria-label="Master binder pages">
                <button type="button" onClick={goToPreviousBinderPage} disabled={masterBinderPage === 0}>
                  <ChevronLeft size={18} aria-hidden="true" />
                  Previous Page
                </button>
                <span>
                  {progress.percent}% complete - {masterMissingCount} missing
                </span>
                <button
                  type="button"
                  onClick={goToNextBinderPage}
                  disabled={masterBinderPage + binderPagesPerView >= masterPageCount}
                >
                  Next Page
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="collection-controls">
            <label className="collection-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search cards"
              />
            </label>

            <div className="collection-segments" aria-label="Collection filter">
              {["all", "collected", "missing"].map((mode) => (
                <button
                  className={filter === mode ? "is-active" : ""}
                  key={mode}
                  onClick={() => setFilter(mode)}
                  type="button"
                >
                  {mode}
                </button>
              ))}
            </div>

            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label="Sort cards">
              <option value="number">Set Number</option>
              <option value="rarity">Rarity</option>
              <option value="name">Name</option>
            </select>
          </div>

          <div className="collection-grid">
            {pagedCards.map((card) => {
              const collected = isCardCollected(collection, card, set.id);
              const count = getCardCount(collection, card, set.id);

              return (
                <article
                  className={`collection-card ${collected ? "is-collected" : "is-missing"}`}
                  key={card.id || `${set.id}-${card.number}-${card.name}`}
                  onClick={() => setSelectedCard(card)}
                >
                  <div className="collection-card-image">
                    <FoilCard
                      card={card}
                      set={set}
                      variant="collection"
                      className={collected ? "" : "is-uncollected-preview"}
                      enableTransform={false}
                      enableCursorBlob={false}
                      enableTiltFoil={false}
                      showFoil={false}
                    />
                    {!collected && <span className="missing-badge">Missing</span>}
                    {count > 1 && <span className="count-badge">x{count}</span>}
                  </div>
                  <div className="collection-card-meta">
                    <strong>{getDisplayCardName(card, set)}</strong>
                    <span>
                      #{card.number} - {getDisplayRarity(card, set)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {visibleCards.length > COLLECTION_PAGE_SIZE && (
            <div className="pagination-controls" aria-label="Collection pages">
              <button
                type="button"
                onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                disabled={page === 1}
              >
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
          card={selectedCard}
          set={set}
          collected={selectedCollected}
          count={selectedCount}
          showBinderControl={selectedCollected}
          binders={binders}
          onAddToBinder={onAddToBinder}
          onRemoveFromBinder={onRemoveFromBinder}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </section>
  );
}

export default CollectionPage;
