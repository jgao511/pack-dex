import { X } from "lucide-react";
import FoilCard from "./FoilCard.jsx";

function CardDetailModal({ card, set, collected = true, count = 0, onClose }) {
  if (!card) return null;

  return (
    <div
      className="inspect-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${card.name} card inspection`}
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
      </div>
    </div>
  );
}

export default CardDetailModal;
