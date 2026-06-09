import { Library, PackageOpen } from "lucide-react";
import { useState } from "react";
import { getCardBackUrl, getSetLogoUrl, getSetPackArtUrl } from "../utils/assetUrls.js";

function SetLogo({ set }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = getSetLogoUrl(set);

  if (!logoUrl || logoFailed) {
    return <h1 className="brand-title">{set.name}</h1>;
  }

  return <img className="opening-logo" src={logoUrl} alt={`${set.name} logo`} onError={() => setLogoFailed(true)} />;
}

function PackOpening({ set, onOpened, onBackToSets, onViewCollection, isOpening = false }) {
  const [packArtFailed, setPackArtFailed] = useState(false);
  const cardBack = getCardBackUrl();
  const packArt = getSetPackArtUrl(set);
  const packImage = !packArtFailed && packArt ? packArt : cardBack;

  return (
    <section className="opening-screen">
      <div className="opening-title">
        <span className="set-mark">Pack Ready</span>
        <SetLogo set={set} />
      </div>
      <div className="pack-stage" aria-label={`${set.name} booster pack`}>
        <div className="pack-card pack-card-back">
          <img src={cardBack} alt="" />
        </div>
        <div className="pack-card pack-card-mid">
          <img src={cardBack} alt="" />
        </div>
        <button className="pack" onClick={onOpened} disabled={isOpening} aria-busy={isOpening}>
          <span className="pack-shine" />
          <img src={packImage} alt={`${set.name} pack`} onError={() => setPackArtFailed(true)} />
          {isOpening && <span className="pack-loading-pill">Opening your pack...</span>}
        </button>
      </div>
      <div className="screen-actions">
        <button className="secondary-button" onClick={onBackToSets} disabled={isOpening}>
          Back to Sets
        </button>
        <button className="secondary-button" onClick={() => onViewCollection(set)} disabled={isOpening}>
          <Library size={20} aria-hidden="true" />
          Collection
        </button>
        <button className="primary-button" onClick={onOpened} disabled={isOpening}>
          <PackageOpen size={20} aria-hidden="true" />
          {isOpening ? "Opening..." : "Click to Open"}
        </button>
      </div>
    </section>
  );
}

export default PackOpening;
