import { useEffect, useRef, useState } from "react";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";
import { captureCardImage } from "../../src/lib/cardScanner/captureCardImage.js";
import { fuseCardMatches } from "../../src/lib/cardScanner/fuseCardMatches.js";
import { recognizeCardText } from "../../src/lib/cardScanner/recognizeCardText.js";
import { confirmTrustedCandidate, releaseTemporaryImage } from "../../src/lib/cardScanner/scannerSession.js";
import { captureBrowserFrame, getBrowserCameraCapability, recognizeBrowserImage, startBrowserCamera, stopBrowserCamera } from "./lib/browserScannerCamera.js";

const TIPS_SESSION_KEY = "packdex-scanner-tips-seen";
const tips = ["Keep the entire card inside the frame.", "Move close enough for the card text to be readable.", "Avoid glare and harsh reflections.", "Hold your phone steady."];
const isNative = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());

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
  return <button className={`scanner-beta-candidate ${isSelected ? "is-selected" : ""}`} type="button" onClick={() => onSelect(candidate.cardId)}><img src={getCardImageUrl(candidate.card)} alt="" /><span><strong>{candidate.card?.name || "Unknown card"}</strong><small>{candidate.setName}</small>{candidate.card?.number && <small>#{candidate.card.number}</small>}</span></button>;
}

function ScannerTips({ onStart, onClose }) {
  return <div className="scanner-beta-tips-overlay" role="presentation"><section className="scanner-beta-tips-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-tips-title"><button className="scanner-beta-tips-close" type="button" aria-label="Close tips" onClick={onClose}>×</button><h2 id="scanner-tips-title">Tips for a better scan</h2><ul>{tips.map((tip) => <li key={tip}>{tip}</li>)}</ul><p>Foil and highly reflective cards may require another photo.</p><button className="primary-action" type="button" onClick={onStart}>Start Scanning</button></section></div>;
}

export default function MobileScannerPage({ onInspectCard, onAddToCollection, onAddToWishlist, onSearchManually }) {
  const imageRef = useRef(null); const videoRef = useRef(null); const nativePreviewRef = useRef(null); const streamRef = useRef(null); const nativeAdapterRef = useRef(null); const nativeOcrRef = useRef(null); const startingRef = useRef(false);
  const [stage, setStage] = useState("camera"); const [match, setMatch] = useState(null); const [selectedCardId, setSelectedCardId] = useState(""); const [confirmed, setConfirmed] = useState(null); const [error, setError] = useState("");
  const [showTips, setShowTips] = useState(() => { try { return sessionStorage.getItem(TIPS_SESSION_KEY) !== "1"; } catch { return true; } });
  const [previewReady, setPreviewReady] = useState(false); const [saving, setSaving] = useState("");

  async function stopPreview() {
    stopBrowserCamera(videoRef.current, streamRef.current); streamRef.current = null;
    await nativeAdapterRef.current?.stopPreview?.().catch(() => {}); setPreviewReady(false);
  }

  useEffect(() => () => { releaseTemporaryImage(imageRef.current); stopPreview(); }, []);
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stopPreview(); else if (!showTips && stage === "camera") startPreview(); };
    document.addEventListener("visibilitychange", onVisibility); return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [showTips, stage]);

  async function loadNative() {
    if (!isNative()) return null;
    if (!nativeAdapterRef.current) {
      const module = await import("./lib/nativeScannerAdapters.js");
      nativeAdapterRef.current = module.nativeCameraAdapter; nativeOcrRef.current = module.nativeOcrAdapter;
    }
    return nativeAdapterRef.current;
  }

  async function startPreview() {
    if (startingRef.current || previewReady || stage !== "camera") return;
    startingRef.current = true; setError("");
    try {
      if (isNative()) {
        const adapter = await loadNative(); let permission = await adapter.checkPermission?.();
        if (permission !== "granted") permission = await adapter.requestPermission?.();
        if (permission !== "granted") throw new Error(permission === "permanentlyDenied" ? "Camera access is blocked. Enable it in device settings, then try again." : "Camera access wasn’t available. Choose a photo instead.");
        await adapter.stopPreview?.(); await adapter.startPreview(nativePreviewRef.current, { toBack: true });
      } else {
        const capability = getBrowserCameraCapability(); if (!capability.available) throw new Error(capability.reason);
        streamRef.current = await startBrowserCamera(videoRef.current);
      }
      setPreviewReady(true);
    } catch (cameraError) { setError(cameraError?.message || "Camera access wasn’t available. Choose a photo instead."); }
    finally { startingRef.current = false; }
  }

  async function beginScanning() {
    try { sessionStorage.setItem(TIPS_SESSION_KEY, "1"); } catch {}
    setShowTips(false); await startPreview();
  }

  async function analyze(image, browser = false) {
    setStage("analyzing");
    const recognized = browser ? await recognizeBrowserImage(image) : await recognizeCardText(image, { adapter: nativeOcrRef.current });
    const fused = recognized.visualMatch ? fuseCardMatches(recognized.ocrMatch, recognized.visualMatch) : recognized.ocrMatch;
    if (!fused?.results?.length) { setStage("no-match"); return; }
    setMatch(fused); setSelectedCardId(fused.primaryMatch?.cardId || fused.results[0].cardId); setStage("candidates");
  }

  async function capture() {
    setError("");
    try {
      const browser = !isNative(); const nextImage = browser ? await captureBrowserFrame(videoRef.current) : await nativeAdapterRef.current.capturePreview();
      await stopPreview(); releaseTemporaryImage(imageRef.current); imageRef.current = nextImage; await analyze(nextImage, browser);
    } catch (captureError) { setError(captureError?.message || "We couldn't capture that card. Please try again."); setStage("camera"); }
  }

  async function choosePhoto() {
    setError("");
    try {
      await stopPreview(); const adapter = isNative() ? await loadNative() : null;
      const nextImage = await captureCardImage({ source: "library", nativeAdapter: adapter, selectBrowserFile: chooseBrowserFile });
      releaseTemporaryImage(imageRef.current); imageRef.current = nextImage; await analyze(nextImage, !isNative());
    } catch (photoError) { if (photoError?.code !== "cancelled") setError(photoError?.message || "We couldn't open that photo."); setStage("camera"); }
  }

  function resetCamera() { releaseTemporaryImage(imageRef.current); imageRef.current = null; setMatch(null); setSelectedCardId(""); setConfirmed(null); setSaving(""); setError(""); setStage("camera"); setPreviewReady(false); window.setTimeout(startPreview, 0); }
  function confirmSelection() { const selected = confirmTrustedCandidate(match, selectedCardId); if (!selected) { setError("Choose one of the suggested cards before confirming."); return; } setConfirmed(selected); setError(""); setStage("confirmed"); }
  async function save(kind) { if (!confirmed) return; setSaving(kind); try { if (kind === "collection") await onAddToCollection?.(confirmed); else await onAddToWishlist?.(confirmed); } finally { setSaving(""); } }

  return <section className={`scanner-beta scanner-beta-${stage}`} aria-label="Card Scanner">
    {showTips && <ScannerTips onStart={beginScanning} onClose={() => setShowTips(false)} />}
    {stage === "camera" && <section className="scanner-beta-camera" aria-label="Live card camera"><div className="scanner-beta-camera-host" ref={nativePreviewRef}>{!isNative() && <video ref={videoRef} muted playsInline autoPlay /> }<div className="scanner-beta-frame" aria-hidden="true"><span /></div></div><div className="scanner-beta-camera-controls"><button className="scanner-beta-shutter" type="button" aria-label="Capture card" disabled={!previewReady} onClick={capture}><span /></button><button className="scanner-beta-camera-action" type="button" onClick={choosePhoto}>Choose Photo</button><button className="scanner-beta-help" type="button" aria-label="Scanner tips" onClick={() => { stopPreview(); setShowTips(true); }}>?</button></div></section>}
    {stage === "analyzing" && <section className="scanner-beta-state" aria-live="polite"><span className="scanner-spinner" aria-hidden="true" /><h2>Reading your card</h2><p>Looking for the best matches now.</p></section>}
    {stage === "no-match" && <section className="scanner-beta-state"><h2>No confident matches yet</h2><p>Keep the full card in view, reduce glare, and try again.</p><div className="scanner-beta-actions"><button className="primary-action" type="button" onClick={resetCamera}>Retake</button><button className="secondary-action" type="button" onClick={choosePhoto}>Choose Photo</button><button className="secondary-action" type="button" onClick={onSearchManually}>Search Manually</button></div></section>}
    {stage === "candidates" && <section className="scanner-beta-results" aria-live="polite"><h2>Choose the matching card</h2><p>Review the suggestions before you confirm.</p><div className="scanner-beta-candidates">{match.results.slice(0, 3).map((candidate) => <ScannerCandidate key={candidate.cardId} candidate={candidate} isSelected={selectedCardId === candidate.cardId} onSelect={setSelectedCardId} />)}</div><div className="scanner-beta-actions"><button className="primary-action" type="button" onClick={confirmSelection}>Confirm selected card</button><button className="secondary-action" type="button" onClick={resetCamera}>Scan Another</button></div></section>}
    {stage === "confirmed" && confirmed && <section className="scanner-beta-confirmed"><img src={getCardImageUrl(confirmed.card)} alt="" /><div><span className="scanner-beta-confirmed-label">Match selected by you</span><h2>{confirmed.card?.name}</h2><p>{confirmed.setName}{confirmed.card?.number ? ` · #${confirmed.card.number}` : ""}</p><div className="scanner-beta-actions"><button className="primary-action" type="button" onClick={() => onInspectCard?.(confirmed.card, { id: confirmed.setId, name: confirmed.setName })}>View card details</button><button className="secondary-action" type="button" disabled={saving === "collection"} onClick={() => save("collection")}>{saving === "collection" ? "Adding..." : "Add to Collection"}</button><button className="secondary-action" type="button" disabled={saving === "wishlist"} onClick={() => save("wishlist")}>{saving === "wishlist" ? "Saving..." : "Add to Wishlist"}</button><button className="secondary-action" type="button" onClick={resetCamera}>Scan Another</button></div></div></section>}
    {error && <p className="scanner-beta-error" role="alert">{error}</p>}
  </section>;
}