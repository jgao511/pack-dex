import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import FoilCard from "./FoilCard.jsx";
import { getDisplayCardName } from "../utils/packGenerator.js";
import { isCardInBinder } from "../utils/binderStorage.js";

function CardDetailModal({
  card,
  set,
  collected = true,
  count = 0,
  onClose,
  showBinderControl = false,
  binders = [],
  onAddToBinder,
  onRemoveFromBinder,
  onCreateBinder,
}) {
  const [selectedBinderId, setSelectedBinderId] = useState("");
  const displayName = getDisplayCardName(card, set);
  const canUseBinder = showBinderControl && collected;
  const hasStatus = !collected || count > 1;
  const selectedBinder = useMemo(
    () => binders.find((binder) => binder.id === selectedBinderId) || binders[0] || null,
    [binders, selectedBinderId]
  );
  const selectedCardInBinder = selectedBinder && card ? isCardInBinder(selectedBinder, card, set.id) : false;

  useEffect(() => {
    if (!selectedBinderId && binders[0]) {
      setSelectedBinderId(binders[0].id);
    }
  }, [binders, selectedBinderId]);

  if (!card) return null;

  return (
    <div
      className="inspect-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} card inspection`}
      onClick={onClose}
    >
      <button className="inspect-close" onClick={onClose} aria-label="Close inspection">
        <X size={22} aria-hidden="true" />
      </button>

      <div className="inspect-card" onClick={(event) => event.stopPropagation()}>
        <FoilCard
          card={card}
          set={set}
          variant="detail"
          className={collected ? "" : "is-uncollected-preview"}
          enableTransform
          enableCursorBlob={false}
          enableTiltFoil
        />
        {!collected && <div className="inspect-status">Not collected yet</div>}
        {collected && count > 1 && <div className="inspect-status">Collected x{count}</div>}
        {canUseBinder && (
          <div className={`inspect-binder-control ${hasStatus ? "" : "is-primary-action"}`.trim()}>
            {binders.length > 0 ? (
              <>
                <select
                  value={selectedBinder?.id || ""}
                  onChange={(event) => setSelectedBinderId(event.target.value)}
                  aria-label="Choose binder"
                >
                  {binders.map((binder) => (
                    <option key={binder.id} value={binder.id}>
                      {binder.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedBinder) return;

                    if (selectedCardInBinder) {
                      onRemoveFromBinder?.(card, set, selectedBinder.id);
                    } else {
                      onAddToBinder?.(card, set, selectedBinder.id);
                    }
                  }}
                >
                  {selectedCardInBinder ? "Remove from Binder" : "Add to Binder"}
                </button>
              </>
            ) : (
              <>
                <span className="inspect-binder-empty">Create a binder from Profile first.</span>
                {onCreateBinder && (
                  <button type="button" onClick={() => onCreateBinder()}>
                    Create Binder
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CardDetailModal;
