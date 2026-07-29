import { useEffect, useMemo, useRef, useState } from "react";
import { activeSets, sets } from "../../data/sets.js";
import { getCardImageUrl, getSetLogoUrl } from "../../utils/assetUrls.js";
import { addCardsToBinder } from "../../utils/binderStorage.js";
import { getCardCount, getPullableCollectionCards, getSetCollectionProgress } from "../../utils/collectionStorage.js";
import { getDisplayCardName } from "../../utils/packGenerator.js";
import { OwnedCardPicker, SearchableSetPicker } from "./BinderPickers.jsx";
import "./BinderSystem.css";

const BINDER_PAGE_SIZE = 9;

export const BINDER_THEME_OPTIONS = [
  { id: "midnight", label: "Midnight", value: "#25245a" },
  { id: "royal", label: "Royal", value: "#3439a5" },
  { id: "violet", label: "Violet", value: "#6425d6" },
  { id: "forest", label: "Forest", value: "#1d6548" },
  { id: "crimson", label: "Crimson", value: "#8a2539" },
  { id: "gold", label: "Gold", value: "#846f20" },
];

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2" />
    </svg>
  );
}

function SetLogo({ set, className = "" }) {
  return <img className={className} src={getSetLogoUrl(set)} alt={`${set.name} logo`} loading="lazy" />;
}

function BinderCardImage({ card, set }) {
  const imageUrl = getCardImageUrl({ ...card, setFolder: card?.setFolder || set?.setFolder || set?.id });

  function preventBrowserAction(event) {
    event.preventDefault();
  }

  return (
    <span className="mobile-card-image-shell" onContextMenu={preventBrowserAction} onDragStart={preventBrowserAction}>
      <img
        src={imageUrl}
        alt={getDisplayCardName(card, set)}
        loading="lazy"
        decoding="async"
        draggable={false}
        onContextMenu={preventBrowserAction}
        onDragStart={preventBrowserAction}
      />
    </span>
  );
}

export function BinderThemeSelector({ value, onChange }) {
  return (
    <div className="binder-theme-picker" aria-label="Binder color">
      {BINDER_THEME_OPTIONS.map((theme) => (
        <button
          className={value === theme.id ? "is-active" : ""}
          key={theme.id}
          type="button"
          style={{ "--swatch": theme.value }}
          onClick={() => onChange(theme.id)}
          aria-label={theme.label}
          aria-pressed={value === theme.id}
        >
          <span />
        </button>
      ))}
    </div>
  );
}

export function getBinderSlots(binder) {
  const set = binder?.setId ? sets.find((candidate) => candidate.id === binder.setId) : null;
  const masterCards = set ? getPullableCollectionCards(set).map((card) => ({ set, card })) : [];
  const customCards = !set
    ? [...(binder?.cards || [])]
        .sort((left, right) => left.order - right.order)
        .map((item) => {
          const itemSet = sets.find((candidate) => candidate.id === item.setId);
          const card = itemSet?.cards?.find(
            (candidate) =>
              String(candidate.id) === String(item.cardId) ||
              String(candidate.number) === String(item.cardNumber)
          );

          return { set: itemSet, card, binderCard: item };
        })
        .filter((item) => item.set && item.card)
    : [];

  return set ? masterCards : customCards;
}

export function CustomBinderView({ binder, collection, onBack, onInspectCard, onAddCards, onReplaceCards }) {
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftCards, setDraftCards] = useState(() => binder.cards || []);
  const slots = getBinderSlots(editing ? { ...binder, cards: draftCards } : binder);

  useEffect(() => {
    if (!editing) setDraftCards(binder.cards || []);
  }, [binder.cards, editing]);

  function startEditing() {
    setDraftCards(binder.cards || []);
    setEditing(true);
  }

  function cancelEditing() {
    setDraftCards(binder.cards || []);
    setEditing(false);
    setPickerOpen(false);
  }

  function moveCard(index, direction) {
    setDraftCards((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next.map((item, order) => ({ ...item, order }));
    });
  }

  function addSelectedCards(selections) {
    if (editing) {
      const nextBinder = addCardsToBinder([{ ...binder, cards: draftCards }], binder.id, selections)[0];
      setDraftCards(nextBinder.cards);
    } else {
      onAddCards?.(binder.id, selections);
    }
    setPickerOpen(false);
  }

  function saveEditing() {
    onReplaceCards?.(binder.id, draftCards);
    setEditing(false);
  }

  return (
    <section className="binder-reader-mobile custom-binder-reader">
      <button className="binder-back-link" type="button" onClick={onBack}>‹ My Binders</button>
      <header className="binder-reader-heading">
        <div>
          <span className="eyebrow">Binder</span>
          <h2>{binder.name}</h2>
          <p>{slots.length} cards</p>
        </div>
      </header>
      <div className="binder-compact-actions">
        {!editing ? (
          <>
            <button className="primary-action" type="button" onClick={() => setPickerOpen(true)}>+ Add Cards</button>
            <button className="secondary-action" type="button" onClick={startEditing}>Edit</button>
          </>
        ) : (
          <>
            <button className="primary-action" type="button" onClick={saveEditing}>Save</button>
            <button className="secondary-action" type="button" onClick={cancelEditing}>Cancel</button>
          </>
        )}
      </div>

      {slots.length === 0 && !editing ? (
        <div className="custom-binder-empty" role="status">
          <strong>Your binder is empty</strong>
          <span>Add cards from your collection to build a custom display.</span>
          <button className="primary-action" type="button" onClick={() => setPickerOpen(true)}>Add your first card</button>
        </div>
      ) : (
        <div className="custom-binder-grid" aria-label={`${binder.name} cards`}>
          {slots.map((item, index) => (
            <article className="custom-binder-card" key={item.binderCard.key}>
              <button type="button" className="custom-binder-card-image" onClick={() => onInspectCard?.(item.card, item.set)}>
                <BinderCardImage card={item.card} set={item.set} />
              </button>
              {editing && (
                <div className="custom-binder-edit-controls">
                  <button type="button" onClick={() => moveCard(index, -1)} disabled={index === 0} aria-label={`Move ${item.card.name} earlier`}>‹</button>
                  <button
                    className="custom-binder-remove-card"
                    type="button"
                    onClick={() =>
                      setDraftCards((current) =>
                        current
                          .filter((card) => card.key !== item.binderCard.key)
                          .map((card, order) => ({ ...card, order }))
                      )
                    }
                    aria-label={`Remove ${item.card.name}`}
                  >
                    ×
                  </button>
                  <button type="button" onClick={() => moveCard(index, 1)} disabled={index === slots.length - 1} aria-label={`Move ${item.card.name} later`}>›</button>
                </div>
              )}
            </article>
          ))}
          {editing && (
            <button className="custom-binder-add-slot" type="button" onClick={() => setPickerOpen(true)}>
              <strong>+</strong>
              <span>Add cards</span>
            </button>
          )}
        </div>
      )}
      {pickerOpen && (
        <OwnedCardPicker
          collection={collection}
          binder={editing ? { ...binder, cards: draftCards } : binder}
          setList={sets}
          onClose={() => setPickerOpen(false)}
          onConfirm={addSelectedCards}
        />
      )}
    </section>
  );
}

export function MasterSetBinderView({ binder, collection, onBack, onInspectCard }) {
  const [pageIndex, setPageIndex] = useState(0);
  const touchStartX = useRef(null);
  const slots = getBinderSlots(binder);
  const totalPages = Math.max(1, Math.ceil(slots.length / BINDER_PAGE_SIZE));
  const pageSlots = slots.slice(pageIndex * BINDER_PAGE_SIZE, pageIndex * BINDER_PAGE_SIZE + BINDER_PAGE_SIZE);
  const ownedCount = slots.filter((item) => getCardCount(collection, item.card, item.set.id) > 0).length;

  useEffect(() => {
    setPageIndex((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  function changePage(direction) {
    setPageIndex((current) => Math.max(0, Math.min(totalPages - 1, current + direction)));
  }

  function finishSwipe(event) {
    if (touchStartX.current === null) return;
    const distance = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 46) return;
    changePage(distance < 0 ? 1 : -1);
  }

  return (
    <section className="binder-reader-mobile master-binder-reader">
      <button className="binder-back-link" type="button" onClick={onBack}>‹ My Binders</button>
      <header className="binder-reader-heading">
        <div>
          <span className="eyebrow">Master Set Binder</span>
          <h2>{binder.name}</h2>
          <p>{ownedCount} of {slots.length} cards</p>
        </div>
      </header>
      <div
        className="master-binder-page-mobile"
        onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }}
        onTouchEnd={finishSwipe}
      >
        <div className="master-binder-page-label">Page {pageIndex + 1}</div>
        {slots.length === 0 && (
          <div className="binder-reader-empty" role="status">
            <strong>This binder has no available cards.</strong>
            <span>The linked set is unavailable. Return to My Binders and choose another set.</span>
          </div>
        )}
        <div className="master-binder-grid-mobile">
          {Array.from({ length: BINDER_PAGE_SIZE }).map((_, index) => {
            const item = pageSlots[index];
            if (!item?.card) return <div className="master-binder-slot-mobile is-empty" key={`empty-${index}`} aria-hidden="true" />;
            const quantity = getCardCount(collection, item.card, item.set.id);
            const collected = quantity > 0;

            return (
              <button
                className={`master-binder-slot-mobile ${collected ? "is-owned" : "is-missing"}`}
                type="button"
                key={`${item.set.id}-${item.card.id || item.card.number}`}
                onClick={() => onInspectCard?.(item.card, item.set)}
                aria-label={`${getDisplayCardName(item.card, item.set)}, card ${item.card.number}, ${collected ? "owned" : "missing from collection"}`}
              >
                {collected ? (
                  <BinderCardImage card={item.card} set={item.set} />
                ) : (
                  <span className="master-missing-card-copy">
                    <strong>#{item.card.number}</strong>
                    <b>{getDisplayCardName(item.card, item.set)}</b>
                    <small>Missing</small>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="binder-page-controls" aria-label="Master set binder pages">
        <button className="secondary-action" type="button" disabled={pageIndex === 0} onClick={() => changePage(-1)}>Previous</button>
        <span>Page {pageIndex + 1} of {totalPages}</span>
        <button className="primary-action" type="button" disabled={pageIndex >= totalPages - 1} onClick={() => changePage(1)}>Next</button>
      </div>
    </section>
  );
}

export function BinderView(props) {
  return props.binder.type === "master_set"
    ? <MasterSetBinderView {...props} />
    : <CustomBinderView {...props} />;
}

export default function BinderSystem({
  collection,
  binders,
  requestedBinderId = "",
  binderHomeRequest = 0,
  onBinderRequestHandled,
  onImportMasterSet,
  onCreateBinder,
  onInspectCard,
  onAddCards,
  onReplaceCards,
  onDeleteBinder,
  desktopSurface = false,
}) {
  const [openBinderId, setOpenBinderId] = useState("");
  const [activeModal, setActiveModal] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteSuccess, setDeleteSuccess] = useState("");
  const [customBinderName, setCustomBinderName] = useState("");
  const [customBinderTheme, setCustomBinderTheme] = useState("midnight");
  const eligibleSets = useMemo(
    () =>
      activeSets
        .filter((set) => !binders.some((binder) => binder.id === `master-set-${set.id}`))
        .sort((left, right) => String(right.releaseDate || "").localeCompare(String(left.releaseDate || ""))),
    [binders]
  );
  const [importSetId, setImportSetId] = useState(eligibleSets[0]?.id || "");
  const selectedImportSet = eligibleSets.find((set) => set.id === importSetId) || eligibleSets[0] || null;
  const [importBinderName, setImportBinderName] = useState(selectedImportSet ? `${selectedImportSet.name} Master Set` : "");
  const [importBinderTheme, setImportBinderTheme] = useState("midnight");
  const openBinder = binders.find((binder) => binder.id === openBinderId);

  useEffect(() => {
    if (!selectedImportSet) return;
    setImportBinderName((current) => current.trim() || `${selectedImportSet.name} Master Set`);
  }, [selectedImportSet?.id]);

  useEffect(() => {
    if (!requestedBinderId || !binders.some((binder) => binder.id === requestedBinderId)) return;
    setOpenBinderId(requestedBinderId);
    onBinderRequestHandled?.();
  }, [binders, onBinderRequestHandled, requestedBinderId]);

  useEffect(() => {
    if (!binderHomeRequest) return;
    setOpenBinderId("");
    setActiveModal("");
  }, [binderHomeRequest]);

  useEffect(() => {
    if (openBinderId && !openBinder) setOpenBinderId("");
  }, [openBinder, openBinderId]);

  function openCreateModal() {
    setDeleteSuccess("");
    setCustomBinderName("");
    setCustomBinderTheme("midnight");
    setActiveModal("create");
  }

  function openImportModal() {
    setDeleteSuccess("");
    const nextSet = selectedImportSet || eligibleSets[0] || null;
    setImportSetId(nextSet?.id || "");
    setImportBinderName(nextSet ? `${nextSet.name} Master Set` : "");
    setImportBinderTheme("midnight");
    setActiveModal("import");
  }

  function handleCreateBinder(event) {
    event.preventDefault();
    const name = customBinderName.trim();
    if (!name) return;
    onCreateBinder?.(name, customBinderTheme);
    setCustomBinderName("");
    setActiveModal("");
  }

  function handleImportBinder(event) {
    event.preventDefault();
    if (!selectedImportSet) return;
    const name = importBinderName.trim() || `${selectedImportSet.name} Master Set`;
    onImportMasterSet?.(selectedImportSet, name, importBinderTheme);
    setActiveModal("");
  }

  function requestDeleteBinder(binder) {
    setActiveModal("");
    setDeleteError("");
    setDeleteSuccess("");
    setDeleteTarget(binder);
  }

  function closeDeleteConfirmation() {
    if (deletePending) return;
    setDeleteTarget(null);
    setDeleteError("");
  }

  async function confirmDeleteBinder() {
    if (!deleteTarget || deletePending || !onDeleteBinder) return;

    setDeletePending(true);
    setDeleteError("");

    try {
      await onDeleteBinder(deleteTarget.id);
      if (openBinderId === deleteTarget.id) setOpenBinderId("");
      setDeleteTarget(null);
      setDeleteSuccess(`${deleteTarget.name} was deleted. Your Collection cards were not changed.`);
    } catch (error) {
      console.warn("Unable to delete binder", error);
      setDeleteError("This binder could not be deleted. Please try again.");
    } finally {
      setDeletePending(false);
    }
  }

  if (openBinder) {
    return (
      <div className={`shared-binder-system is-reader${desktopSurface ? " is-desktop-surface" : ""}`}>
        <BinderView
          binder={openBinder}
          collection={collection}
          onBack={() => setOpenBinderId("")}
          onInspectCard={onInspectCard}
          onAddCards={onAddCards}
          onReplaceCards={onReplaceCards}
        />
      </div>
    );
  }

  return (
    <div className={`shared-binder-system is-library${desktopSurface ? " is-desktop-surface" : ""}`}>
      {deleteSuccess && <div className="binder-action-status" role="status">{deleteSuccess}</div>}
      <section className={`binder-actions ${binders.length === 0 ? "is-empty" : ""}`}>
        <div className="binder-actions-heading">
          <div>
            <span className="eyebrow">My Binders</span>
            <h2>{binders.length} binders</h2>
          </div>
          {binders.length > 0 && (
            <div className="binder-quick-actions">
              <button className="secondary-action" type="button" onClick={openCreateModal}>+ Create</button>
              <button className="secondary-action" type="button" onClick={openImportModal} disabled={eligibleSets.length === 0}>Import</button>
            </div>
          )}
        </div>

        {binders.length === 0 && (
          <div className="binder-empty-state">
            <strong>No binders yet.</strong>
            <p>Create a binder or import a master set to get started.</p>
            <button className="primary-action" type="button" onClick={openCreateModal}>Create Binder</button>
            <button className="inline-auth-link" type="button" onClick={openImportModal} disabled={eligibleSets.length === 0}>Import Master Set</button>
          </div>
        )}
      </section>

      {binders.length > 0 && (
        <section className="binder-list-mobile">
          {binders.map((binder) => {
            const set = binder.setId ? sets.find((candidate) => candidate.id === binder.setId) : null;
            const progress = set ? getSetCollectionProgress(collection, set) : null;

            return (
              <article className={`binder-card-mobile is-${binder.theme || "midnight"}`} key={binder.id}>
                <div className="binder-spine" aria-hidden="true"><span /><span /><span /></div>
                <div className="binder-card-body">
                  {set && (
                    <div className="binder-cover-logo">
                      <SetLogo set={set} className="binder-logo" />
                    </div>
                  )}
                  <strong>{binder.name}</strong>
                  <em>{binder.tag}</em>
                  <small>{set ? `${progress.collected}/${progress.total} cards` : `${binder.cards?.length || 0} cards`}</small>
                  <div className="binder-card-actions">
                    <button className="secondary-action" type="button" onClick={() => setOpenBinderId(binder.id)}>
                      Open Binder
                    </button>
                    <button
                      className="binder-delete-trigger"
                      type="button"
                      onClick={() => requestDeleteBinder(binder)}
                      aria-label={`Delete ${binder.name}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {activeModal === "create" && (
        <div className="binder-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-binder-title" onClick={() => setActiveModal("")}>
          <section className="binder-sheet" onClick={(event) => event.stopPropagation()}>
            <button className="binder-modal-close" type="button" onClick={() => setActiveModal("")} aria-label="Close create binder"><CloseIcon /></button>
            <div className="binder-modal-heading"><span className="eyebrow">My Binders</span><h2 id="create-binder-title">Create Binder</h2></div>
            <form className="custom-binder-form" onSubmit={handleCreateBinder}>
              <label><span>Binder name</span><input type="text" value={customBinderName} onChange={(event) => setCustomBinderName(event.target.value)} placeholder="Binder name" maxLength={48} autoFocus /></label>
              <label><span>Color</span><BinderThemeSelector value={customBinderTheme} onChange={setCustomBinderTheme} /></label>
              <button className="primary-action" type="submit" disabled={!customBinderName.trim()}>Create Binder</button>
            </form>
          </section>
        </div>
      )}

      {activeModal === "import" && (
        <div className="binder-fullscreen-overlay import-binder-overlay" role="dialog" aria-modal="true" aria-labelledby="import-binder-title">
          <section className="import-binder-sheet">
            <button className="binder-modal-close" type="button" onClick={() => setActiveModal("")} aria-label="Close import binder"><CloseIcon /></button>
            <div className="binder-modal-heading"><span className="eyebrow">My Binders</span><h2 id="import-binder-title">Import Master Set</h2></div>
            <form className="custom-binder-form" onSubmit={handleImportBinder}>
              <SearchableSetPicker
                setList={eligibleSets}
                selectedSetId={selectedImportSet?.id || ""}
                onSelect={(set) => {
                  setImportSetId(set.id);
                  setImportBinderName(`${set.name} Master Set`);
                }}
              />
              <label><span>Binder name</span><input type="text" value={importBinderName} onChange={(event) => setImportBinderName(event.target.value)} placeholder="Binder name" maxLength={64} /></label>
              <label><span>Color</span><BinderThemeSelector value={importBinderTheme} onChange={setImportBinderTheme} /></label>
              <button className="primary-action" type="submit" disabled={!selectedImportSet}>Import Binder</button>
            </form>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div
          className="binder-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-binder-title"
          onClick={closeDeleteConfirmation}
        >
          <section className="binder-sheet binder-delete-sheet" onClick={(event) => event.stopPropagation()}>
            <button
              className="binder-modal-close"
              type="button"
              onClick={closeDeleteConfirmation}
              aria-label="Close delete binder confirmation"
              disabled={deletePending}
            >
              <CloseIcon />
            </button>
            <div className="binder-modal-heading">
              <span className="eyebrow">My Binders</span>
              <h2 id="delete-binder-title">Delete Binder?</h2>
            </div>
            <p className="binder-delete-copy">
              Delete <strong>{deleteTarget.name}</strong>? This removes only the binder. Cards in your Collection will stay unchanged.
            </p>
            {deleteError && <div className="binder-delete-error" role="alert">{deleteError}</div>}
            <div className="binder-delete-actions">
              <button className="secondary-action" type="button" onClick={closeDeleteConfirmation} disabled={deletePending}>
                Cancel
              </button>
              <button className="danger-action" type="button" onClick={confirmDeleteBinder} disabled={deletePending}>
                {deletePending ? "Deleting…" : "Delete Binder"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
