import { useEffect, useMemo, useState } from "react";
import { getCardImageUrl, getSetLogoUrl } from "../../../src/utils/assetUrls.js";
import { getDisplayCardName, getDisplayRarity } from "../../../src/utils/packGenerator.js";
import { getCardCount, getPullableCollectionCards } from "../../../src/utils/collectionStorage.js";
import { getBinderCardKey } from "../../../src/utils/binderStorage.js";
import {
  BINDER_ERA_FILTERS,
  filterBinderSets,
  filterOwnedBinderCards,
  getOwnedBinderCards,
  sortBinderRarities,
} from "../utils/binderCatalog.js";

const OWNED_CARD_PAGE_SIZE = 48;

function cardImageUrl(card, set) {
  return getCardImageUrl({ ...card, setFolder: card?.setFolder || set?.setFolder || set?.id });
}

export function SetFilterChips({ value, onChange }) {
  return (
    <div className="binder-era-chips" aria-label="Filter by era">
      {BINDER_ERA_FILTERS.map((era) => (
        <button
          className={value === era ? "is-active" : ""}
          key={era}
          type="button"
          onClick={() => onChange(era)}
          aria-pressed={value === era}
        >
          {era}
        </button>
      ))}
    </div>
  );
}

export function SearchableSetPicker({ setList, selectedSetId, onSelect }) {
  const [query, setQuery] = useState("");
  const [era, setEra] = useState("All");
  const [order, setOrder] = useState("newest");
  const visibleSets = useMemo(
    () => filterBinderSets(setList, { query, era, order }),
    [setList, query, era, order]
  );

  return (
    <section className="searchable-set-picker">
      <label className="binder-search-field">
        <span className="sr-only">Search sets</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sets…"
          autoComplete="off"
        />
      </label>
      <div className="binder-picker-order">
        <span>{visibleSets.length} sets</span>
        <select value={order} onChange={(event) => setOrder(event.target.value)} aria-label="Set order">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>
      <SetFilterChips value={era} onChange={setEra} />
      <div className="binder-set-results" aria-label="Eligible master sets">
        {visibleSets.map((set) => {
          const total = getPullableCollectionCards(set).length;
          const releaseYear = String(set.releaseDate || "").slice(0, 4);

          return (
            <button
              className={set.id === selectedSetId ? "is-active" : ""}
              key={set.id}
              type="button"
              onClick={() => onSelect(set)}
              aria-pressed={set.id === selectedSetId}
            >
              <img src={getSetLogoUrl(set)} alt={`${set.name} logo`} loading="lazy" />
              <span>
                <strong>{set.name}</strong>
                <small>
                  {[set.era, releaseYear, total ? `${total} cards` : ""].filter(Boolean).join(" · ")}
                </small>
              </span>
            </button>
          );
        })}
        {visibleSets.length === 0 && <p className="binder-picker-empty">No sets match those filters.</p>}
      </div>
    </section>
  );
}

export function OwnedCardPicker({ collection, binder, setList, onClose, onConfirm }) {
  const [query, setQuery] = useState("");
  const [era, setEra] = useState("All");
  const [setId, setSetId] = useState("All");
  const [rarity, setRarity] = useState("All");
  const [sort, setSort] = useState("set-order");
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [visibleCount, setVisibleCount] = useState(OWNED_CARD_PAGE_SIZE);
  const existingKeys = useMemo(() => new Set((binder?.cards || []).map((item) => item.key)), [binder?.cards]);
  const ownedCards = useMemo(
    () => getOwnedBinderCards(setList, collection, getPullableCollectionCards, getCardCount, getBinderCardKey),
    [collection, setList]
  );
  const ownedSets = useMemo(
    () => filterBinderSets(
      [...new Map(ownedCards.map((item) => [item.set.id, item.set])).values()],
      { era }
    ),
    [ownedCards, era]
  );
  const rarities = useMemo(
    () => sortBinderRarities(ownedCards),
    [ownedCards]
  );
  const visibleCards = useMemo(
    () => filterOwnedBinderCards(ownedCards, { query, era, setId, rarity, sort }),
    [ownedCards, query, era, setId, rarity, sort]
  );
  const selectedCards = useMemo(
    () => ownedCards.filter((item) => selectedKeys.has(item.key) && !existingKeys.has(item.key)),
    [ownedCards, selectedKeys, existingKeys]
  );
  const displayedCards = visibleCards.slice(0, visibleCount);
  const remainingCardCount = Math.max(0, visibleCards.length - displayedCards.length);

  useEffect(() => {
    setVisibleCount(OWNED_CARD_PAGE_SIZE);
  }, [query, era, setId, rarity, sort]);

  function updateEra(nextEra) {
    setEra(nextEra);
    if (setId !== "All" && !ownedSets.some((set) => set.id === setId && (nextEra === "All" || set.era === nextEra))) {
      setSetId("All");
    }
  }

  function toggleCard(item) {
    if (existingKeys.has(item.key)) return;
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      return next;
    });
  }

  return (
    <div className="binder-fullscreen-overlay" role="dialog" aria-modal="true" aria-labelledby="owned-card-picker-title">
      <section className="owned-card-picker">
        <header className="binder-picker-header">
          <div>
            <span className="eyebrow">All Owned Cards</span>
            <h2 id="owned-card-picker-title">Add Cards</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close card picker">×</button>
        </header>
        <label className="binder-search-field">
          <span className="sr-only">Search cards you own</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search cards you own…"
            autoComplete="off"
          />
        </label>
        <SetFilterChips value={era} onChange={updateEra} />
        <div className="owned-card-filters">
          <label>
            <span>Set</span>
            <select value={setId} onChange={(event) => setSetId(event.target.value)}>
              <option value="All">All sets</option>
              {ownedSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
            </select>
          </label>
          <label>
            <span>Rarity</span>
            <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
              <option value="All">All rarities</option>
              {rarities.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="set-order">Set order</option>
              <option value="recent">Recently pulled</option>
              <option value="name">Name</option>
              <option value="rarity">Rarity</option>
            </select>
          </label>
        </div>
        <div className="owned-card-picker-grid">
          {displayedCards.map((item) => {
            const inBinder = existingKeys.has(item.key);
            const selected = selectedKeys.has(item.key);

            return (
              <article className={`owned-card-choice ${selected ? "is-selected" : ""} ${inBinder ? "is-existing" : ""}`} key={item.key}>
                <button type="button" className="owned-card-select" onClick={() => toggleCard(item)} disabled={inBinder} aria-pressed={selected}>
                  <img src={cardImageUrl(item.card, item.set)} alt={getDisplayCardName(item.card, item.set)} loading="lazy" />
                  <span className="owned-card-choice-state">{inBinder ? "In binder" : selected ? "Selected" : `×${item.quantity}`}</span>
                </button>
                <button className="owned-card-preview" type="button" onClick={() => setPreview(item)} aria-label={`Preview ${getDisplayCardName(item.card, item.set)}`}>
                  Preview
                </button>
              </article>
            );
          })}
          {visibleCards.length === 0 && (
            <div className="binder-picker-empty owned-card-empty">
              <strong>No owned cards found.</strong>
              <span>Try changing your search or filters.</span>
            </div>
          )}
          {remainingCardCount > 0 && (
            <button
              className="owned-card-load-more"
              type="button"
              onClick={() => setVisibleCount((current) => current + OWNED_CARD_PAGE_SIZE)}
            >
              Load More
              <span>{remainingCardCount} cards remaining</span>
            </button>
          )}
        </div>
        <footer className="owned-card-picker-footer">
          <strong>{selectedCards.length} selected</strong>
          <button
            className="primary-action"
            type="button"
            disabled={selectedCards.length === 0}
            onClick={() => onConfirm(selectedCards.map(({ card, set }) => ({ card, setId: set.id })))}
          >
            Add {selectedCards.length} {selectedCards.length === 1 ? "Card" : "Cards"}
          </button>
        </footer>
        {preview && (
          <div className="binder-card-preview-overlay" role="dialog" aria-modal="true" aria-label="Card preview">
            <button type="button" className="binder-preview-close" onClick={() => setPreview(null)}>‹ Back to cards</button>
            <img src={cardImageUrl(preview.card, preview.set)} alt={getDisplayCardName(preview.card, preview.set)} />
            <div>
              <strong>{getDisplayCardName(preview.card, preview.set)}</strong>
              <span>#{preview.card.number} · {getDisplayRarity(preview.card, preview.set)}</span>
              <small>{preview.set.name} · Owned ×{preview.quantity}</small>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
