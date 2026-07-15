import { useEffect, useRef, useState } from "react";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";
import { captureCardImage } from "../../src/lib/cardScanner/captureCardImage.js";
import { fuseCardMatches } from "../../src/lib/cardScanner/fuseCardMatches.js";
import { recognizeCardText } from "../../src/lib/cardScanner/recognizeCardText.js";
import { confirmTrustedCandidate, releaseTemporaryImage } from "../../src/lib/cardScanner/scannerSession.js";
import { nativeCameraAdapter, nativeOcrAdapter } from "./lib/nativeScannerAdapters.js";

const tips = [
  "Keep the entire card inside the frame.",
  "Move close enough for the card text to be readable.",
  "Avoid glare and harsh reflections.",
  "Hold your phone steady.",
];

function chooseBrowserFile(options) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    if (options.capture) input.capture = options.capture;
    input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
    input.click();
  });
}

function ScannerCandidate({ candidate, isSelected, onSelect }) {
  return (
    <button className={`scanner-beta-candidate ${isSelected ? "is-selected" : ""}`} type="button" onClick={() => onSelect(candidate.cardId)}>
      <img src={getCardImageUrl(candidate.card)} alt="" />
      <span>
        <strong>{candidate.card?.name || "Unknown card"}</strong>
        <small>{candidate.setName}</small>
        {candidate.card?.number && <small>#{candidate.card.number}</small>}
      </span>
    </button>
  );
}

export default function MobileScannerPage({ onInspectCard }) {
  const imageRef = useRef(null);
  const [stage, setStage] = useState("landing");
  const [match, setMatch] = useState(null);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [confirmed, setConfirmed] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => () => {
    releaseTemporaryImage(imageRef.current);
    imageRef.current = null;
    nativeCameraAdapter.stopPreview().catch(() => {});
  }, []);

  function reset() {
    releaseTemporaryImage(imageRef.current);
    imageRef.current = null;
    setStage("landing");
    setMatch(null);
    setSelectedCardId("");
    setConfirmed(null);
    setError("");
  }

  async function scan(source) {
    setError("");
    setConfirmed(null);
    setMatch(null);
    setSelectedCardId("");
    try {
      releaseTemporaryImage(imageRef.current);
      imageRef.current = await captureCardImage({ source, nativeAdapter: nativeCameraAdapter, selectBrowserFile: chooseBrowserFile });
      setStage("analyzing");
      const recognized = await recognizeCardText(imageRef.current, { adapter: nativeOcrAdapter });
      const fused = fuseCardMatches(recognized.ocrMatch, recognized.visualMatch);
      if (!fused?.results?.length) {
        setStage("no-match");
        return;
      }
      setMatch(fused);
      setSelectedCardId(fused.primaryMatch?.cardId || fused.results[0].cardId);
      setStage("candidates");
    } catch (scanError) {
      setError(scanError?.message || "We couldn't scan that photo. Please try again.");
      setStage("landing");
    }
  }

  function confirmSelection() {
    const selected = confirmTrustedCandidate(match, selectedCardId);
    if (!selected) {
      setError("Choose one of the suggested cards before confirming.");
      return;
    }
    setConfirmed(selected);
    setError("");
    setStage("confirmed");
  }

  return (
    <section className="scanner-beta" aria-label="Card Scanner">
      <header className="scanner-beta-header">
        <span className="scanner-beta-badge">New · Beta</span>
        <h1>Card Scanner</h1>
        <p>Take one clear photo to find a card, then choose the match yourself.</p>
      </header>

      {stage === "landing" && (
        <>
          <div className="scanner-beta-frame" aria-hidden="true"><span /></div>
          <section className="scanner-beta-tips" aria-label="Capture tips">
            <h2>Capture tips</h2>
            <ul>{tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
            <p>Foil and highly reflective cards may require another photo.</p>
          </section>
          <div className="scanner-beta-actions">
            <button className="primary-action" type="button" onClick={() => scan("camera")}>Scan Card</button>
            <button className="secondary-action" type="button" onClick={() => scan("library")}>Choose Photo</button>
          </div>
        </>
      )}

      {stage === "analyzing" && (
        <section className="scanner-beta-state" aria-live="polite">
          <span className="scanner-spinner" aria-hidden="true" />
          <h2>Reading your card</h2>
          <p>Looking for the best matches now.</p>
        </section>
      )}

      {stage === "no-match" && (
        <section className="scanner-beta-state">
          <h2>No confident matches yet</h2>
          <p>Try another single photo with the full card visible and its text in focus.</p>
          <div className="scanner-beta-actions">
            <button className="primary-action" type="button" onClick={() => scan("camera")}>Retake Photo</button>
            <button className="secondary-action" type="button" onClick={() => scan("library")}>Choose Photo</button>
          </div>
        </section>
      )}

      {stage === "candidates" && (
        <section className="scanner-beta-results" aria-live="polite">
          <h2>Choose the matching card</h2>
          <p>Review the suggestions before you confirm.</p>
          <div className="scanner-beta-candidates">
            {match.results.slice(0, 3).map((candidate) => (
              <ScannerCandidate key={candidate.cardId} candidate={candidate} isSelected={selectedCardId === candidate.cardId} onSelect={setSelectedCardId} />
            ))}
          </div>
          <div className="scanner-beta-actions">
            <button className="primary-action" type="button" onClick={confirmSelection}>Confirm selected card</button>
            <button className="secondary-action" type="button" onClick={reset}>Scan another card</button>
          </div>
        </section>
      )}

      {stage === "confirmed" && confirmed && (
        <section className="scanner-beta-confirmed">
          <img src={getCardImageUrl(confirmed.card)} alt="" />
          <div>
            <span className="scanner-beta-confirmed-label">Match selected by you</span>
            <h2>{confirmed.card?.name}</h2>
            <p>{confirmed.setName}{confirmed.card?.number ? ` · #${confirmed.card.number}` : ""}</p>
            <div className="scanner-beta-actions">
              <button className="primary-action" type="button" onClick={() => onInspectCard?.(confirmed.card, { id: confirmed.setId, name: confirmed.setName })}>View card details</button>
              <button className="secondary-action" type="button" onClick={reset}>Scan another card</button>
            </div>
          </div>
        </section>
      )}

      {error && <p className="scanner-beta-error" role="alert">{error}</p>}
    </section>
  );
}