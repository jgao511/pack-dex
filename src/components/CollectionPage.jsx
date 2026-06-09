import { PackageOpen, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import CardDetailModal from "./CardDetailModal.jsx";
import FoilCard from "./FoilCard.jsx";
import { getSetLogoUrl } from "../utils/assetUrls.js";
import {
  getCardCount,
  getPullableCollectionCards,
  getSetCollectionProgress,
  isCardCollected,
} from "../utils/collectionStorage.js";
import { getDisplayCardName, getDisplayRarity } from "../utils/packGenerator.js";
import { compareCardsByRarity } from "../utils/rarityRank.js";

const COLLECTION_PAGE_SIZE = 60;

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

function SetLogo({ set }) {
  const logoUrl = getSetLogoUrl(set);

  if (!logoUrl) return <h1 className="brand-title">{set.name}</h1>;

  return <img className="collection-logo" src={logoUrl} alt={`${set.name} logo`} />;
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
  const progress = getSetCollectionProgress(collection, set);
  const cards = useMemo(() => getPullableCollectionCards(set), [set]);
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
            <button className="primary-button" onClick={() => onOpenPacks(set)}>
              <PackageOpen size={20} aria-hidden="true" />
              Open Packs
            </button>
          </div>
        </div>
      </header>

      {user ? (
        <div className="cloud-save-badge">Account saving enabled</div>
      ) : (
        <div className="auth-save-notice">
          <button type="button" onClick={onOpenAuth}>
            Log in
          </button>{" "}
          or{" "}
          <button type="button" onClick={onOpenAuth}>
            create an account
          </button>{" "}
          to save new pulls to your account.
        </div>
      )}

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
