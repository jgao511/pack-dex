import { Library, PackageOpen } from "lucide-react";
import { useEffect, useState } from "react";
import AccountSaveNotice from "./AccountSaveNotice.jsx";
import { getCardBackUrl, getRemoteSetLogoUrl, getSetLogoUrl, getSetPackArtUrl } from "../utils/assetUrls.js";
import { markIdleCardBackLoad, markIdleCardBackRenderStart } from "../utils/cardBackDebug.js";
import { markOpenPackClick } from "../utils/imageDebug.js";
import { pauseImageWarmup } from "../utils/imageWarmup.js";

function SetLogo({ set }) {
  const [logoSource, setLogoSource] = useState("local");
  const logoUrl = getSetLogoUrl(set);
  const remoteLogoUrl = getRemoteSetLogoUrl(set);
  const displayLogoUrl = logoSource === "remote" ? remoteLogoUrl : logoUrl;

  useEffect(() => {
    setLogoSource("local");
  }, [logoUrl]);

  if (!displayLogoUrl || logoSource === "failed") {
    return <h1 className="brand-title">{set.name}</h1>;
  }

  return (
    <img
      className="opening-logo"
      src={displayLogoUrl}
      alt={`${set.name} logo`}
      onError={() => setLogoSource(logoSource === "local" && remoteLogoUrl ? "remote" : "failed")}
    />
  );
}

function PackOpening({ set, onOpened, onBackToSets, onViewCollection, user = null, onOpenAuth, isOpening = false }) {
  const [packArtFailed, setPackArtFailed] = useState(false);
  const cardBack = getCardBackUrl();
  const packArt = getSetPackArtUrl(set);
  const packImage = !packArtFailed && packArt ? packArt : cardBack;

  useEffect(() => {
    markIdleCardBackRenderStart("idle-bobbing-back-card", cardBack);
    markIdleCardBackRenderStart("idle-bobbing-mid-card", cardBack);
  }, [cardBack]);

  const handleOpen = () => {
    pauseImageWarmup({ packOpening: true });
    markOpenPackClick(set);
    onOpened();
  };

  return (
    <section className="opening-screen">
      <div className="opening-title">
        <span className="set-mark">Pack Ready</span>
        <SetLogo set={set} />
        {set.previewNote && <p className="opening-preview-note">{set.previewNote}</p>}
      </div>
      <div className="pack-stage" aria-label={`${set.name} booster pack`}>
        <div className="pack-card pack-card-back">
          <img
            src={cardBack}
            alt=""
            decoding="async"
            fetchPriority="high"
            onLoad={(event) => markIdleCardBackLoad("idle-bobbing-back-card", event.currentTarget, true)}
            onError={(event) => markIdleCardBackLoad("idle-bobbing-back-card", event.currentTarget, false)}
          />
        </div>
        <div className="pack-card pack-card-mid">
          <img
            src={cardBack}
            alt=""
            decoding="async"
            fetchPriority="high"
            onLoad={(event) => markIdleCardBackLoad("idle-bobbing-mid-card", event.currentTarget, true)}
            onError={(event) => markIdleCardBackLoad("idle-bobbing-mid-card", event.currentTarget, false)}
          />
        </div>
        <button className="pack" onClick={handleOpen} disabled={isOpening} aria-busy={isOpening}>
          <span className="pack-shine" />
          <img src={packImage} alt={`${set.name} pack`} onError={() => setPackArtFailed(true)} />
          {isOpening && <span className="pack-loading-pill">Opening your pack...</span>}
        </button>
      </div>
      {!user && (
        <AccountSaveNotice
          className="opening-save-notice"
          onOpenAuth={onOpenAuth}
          message="before opening packs to save your pulls and progress."
        />
      )}
      <div className="screen-actions">
        <button className="secondary-button" onClick={onBackToSets} disabled={isOpening}>
          Back to Sets
        </button>
        <button className="secondary-button" onClick={() => onViewCollection(set)} disabled={isOpening}>
          <Library size={20} aria-hidden="true" />
          Collection
        </button>
        <button className="primary-button" onClick={handleOpen} disabled={isOpening}>
          <PackageOpen size={20} aria-hidden="true" />
          {isOpening ? "Opening..." : "Click to Open"}
        </button>
      </div>
    </section>
  );
}

export default PackOpening;
