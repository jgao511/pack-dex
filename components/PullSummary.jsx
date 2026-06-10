import { useEffect, useState } from "react";
import { Library, RotateCcw } from "lucide-react";
import CardDetailModal from "./CardDetailModal.jsx";
import FoilCard from "./FoilCard.jsx";
import { getCardCount } from "../utils/collectionStorage.js";
import { getDisplayCardName, getDisplayRarity } from "../utils/packGenerator.js";

function PullSummary({ cards, set, collection, onOpenAnother, onBackToSets, onViewCollection, isOpeningAnother = false }) {
  const [inspectedCard, setInspectedCard] = useState(null);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && inspectedCard) {
        setInspectedCard(null);
        return;
      }

      if ((event.code === "Space" || event.key === " ") && !inspectedCard && !isOpeningAnother) {
        event.preventDefault();
        onOpenAnother();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [inspectedCard, isOpeningAnother, onOpenAnother]);

  function closeInspect() {
    setInspectedCard(null);
  }

  return (
    <section className="summary-screen">
      <div className="summary-header">
        <div>
          <span className="set-mark">Pack Complete</span>
          <h1 className="brand-title">Your {set.name} Pulls</h1>
        </div>
        <div className="summary-actions">
          <button className="secondary-button" onClick={onBackToSets} disabled={isOpeningAnother}>
            Back to Sets
          </button>
          <button className="secondary-button" onClick={() => onViewCollection(set)} disabled={isOpeningAnother}>
            <Library size={20} aria-hidden="true" />
            Collection
          </button>
          <button className="primary-button" onClick={onOpenAnother} disabled={isOpeningAnother}>
            <RotateCcw size={20} aria-hidden="true" />
            {isOpeningAnother ? "Opening..." : "Open Another Pack"}
          </button>
        </div>
      </div>

      <div className="pull-grid">
        {cards.map((card) => (
          <article className="pull-card" key={`${card.id}-${card.number}`} onClick={() => setInspectedCard(card)}>
            <div className="pull-card-image">
              <FoilCard
                card={card}
                set={set}
                variant="summary"
                enableTransform
                enableCursorBlob={false}
                enableTiltFoil
              />
              {getCardCount(collection, card, set.id) === 1 && <span className="new-badge">New</span>}
              {getCardCount(collection, card, set.id) > 1 && (
                <span className="count-badge">x{getCardCount(collection, card, set.id)}</span>
              )}
            </div>
            <div className="pull-card-info">
              <h2>{getDisplayCardName(card, set)}</h2>
              <p>
                {getDisplayRarity(card, set)} - #{card.number}
              </p>
            </div>
          </article>
        ))}
      </div>

      {inspectedCard && (
        <CardDetailModal
          card={inspectedCard}
          set={set}
          collected
          count={getCardCount(collection, inspectedCard, set.id)}
          onClose={closeInspect}
        />
      )}
    </section>
  );
}

export default PullSummary;
