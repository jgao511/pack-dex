import { useEffect, useRef, useState } from "react";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";
import { captureCardImage } from "../../src/lib/cardScanner/captureCardImage.js";
import { fuseCardMatches } from "../../src/lib/cardScanner/fuseCardMatches.js";
import { recognizeCardText } from "../../src/lib/cardScanner/recognizeCardText.js";
import { confirmTrustedCandidate, releaseTemporaryImage } from "../../src/lib/cardScanner/scannerSession.js";
import { formatUsd } from "../../src/lib/cardPrices.js";
import { getTcgplayerCardUrl } from "../../src/utils/tcgplayerSearch.js";
import { captureBrowserFrame, chooseBrowserFile, getBrowserCameraCapability, recognizeBrowserImage, startBrowserCamera, stopBrowserCamera } from "./lib/browserScannerCamera.js";
import { isAndroidNative } from "./lib/platform.js";

const TIPS_STORAGE_KEY = "packdex.scannerTipsSeen.v1";
const tips = ["Keep the full card inside the frame.", "Hold the phone steady and keep the card reasonably close.", "For foil cards, hold the card upright and avoid direct light or glare.", "Medium or slightly dim ambient light often works better than a bright overhead light."];
const usesAndroidNativeScanner = () => isAndroidNative();
const scannerDebug = (event, data) => { if (import.meta.env.DEV) console.info(`[PackDex scanner] ${event}`, data); };
function haveSeenTips() { try { return localStorage.getItem(TIPS_STORAGE_KEY) === "1"; } catch { return false; } }
function markTipsSeen() { try { localStorage.setItem(TIPS_STORAGE_KEY, "1"); } catch {} }

function ScannerCandidate({ candidate, isSelected, onSelect }) {
  const fallback = (event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/card-back.png"; };
  return <button className={`scanner-beta-candidate ${isSelected ? "is-selected" : ""}`} type="button" onClick={() => onSelect(candidate.cardId)}><img src={getCardImageUrl(candidate.card)} alt="" onError={fallback} /><span><strong>{candidate.card?.name || "Unknown card"}</strong><small>{candidate.setName}</small>{candidate.card?.number && <small>#{candidate.card.number}</small>}</span></button>;
}

function ScannerTips({ onStart, onClose }) {
  return <div className="scanner-beta-tips-overlay" role="presentation"><section className="scanner-beta-tips-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-tips-title"><button className="scanner-beta-tips-close" type="button" aria-label="Close tips" onClick={onClose}>×</button><h2 id="scanner-tips-title">Tips for a better scan</h2><ul>{tips.map((tip) => <li key={tip}>{tip}</li>)}</ul><p>Foil and highly reflective cards may require another photo.</p><button className="primary-action" type="button" onClick={onStart}>Start Scanning</button></section></div>;
}

function scannerActionLabel(kind, state) {
  const target = kind === "collection" ? "Collection" : "Wishlist";
  if (state === "auth-required") return `Sign in to Add to ${target}`;
  if (state === "saving") return "Adding…";
  if (state === "success" || state === "already-added") return `Added to ${target}`;
  return `Add to ${target}`;
}

function ScannerActionButton({ kind, state, onClick }) {
  const isComplete = state === "success" || state === "already-added";
  const isSaving = state === "saving";
  return <button
    className={`${kind === "collection" ? "primary-action" : "secondary-action"} ${isComplete ? "is-complete" : ""}`}
    type="button"
    disabled={isSaving || isComplete}
    aria-busy={isSaving || undefined}
    onClick={onClick}
  >
    <span className="scanner-beta-action-button-content">
      {isSaving && <span className="scanner-beta-action-spinner" aria-hidden="true" />}
      <span>{scannerActionLabel(kind, state)}</span>
    </span>
  </button>;
}

export function ScannerConfirmedResult({ confirmed, marketPrice, priceState, collectionActionState, wishlistActionState, actionError, onCollectionAction, onWishlistAction, onScanAnother }) {
  const tcgplayerCardUrl = getTcgplayerCardUrl({
    exactUrl: marketPrice?.tcgplayerUrl,
    cardName: confirmed.card?.name,
    setName: confirmed.setName,
    cardNumber: confirmed.card?.number,
  });
  const hasMarketPrice = priceState === "available" && Number(marketPrice?.marketPriceUsd) > 0;
  const isPriceLoading = priceState === "loading";
  const showPricePanel = isPriceLoading || hasMarketPrice || Boolean(tcgplayerCardUrl);

  return <section className="scanner-beta-confirmed" aria-live="polite" data-card-id={confirmed.cardId}>
    <img src={getCardImageUrl(confirmed.card)} alt={confirmed.card?.name || "Confirmed card"} />
    <div className="scanner-beta-confirmed-copy">
      <h2>{confirmed.card?.name}</h2>
      <p>{confirmed.setName}{confirmed.card?.number ? ` · #${confirmed.card.number}` : ""}</p>
      {showPricePanel && <section className={`scanner-beta-price ${hasMarketPrice || isPriceLoading ? "" : "is-link-only"}`} aria-label={isPriceLoading ? "Market price loading" : hasMarketPrice ? "Market price" : "TCGplayer price link"} aria-busy={isPriceLoading || undefined} data-price-state={priceState}>
        {(hasMarketPrice || isPriceLoading) && <>
          <span className="scanner-beta-price-label">Market Price</span>
          {isPriceLoading ? <span className="scanner-beta-price-loading"><span className="scanner-beta-price-spinner" aria-hidden="true" /><span>Loading price</span></span> : <strong>{formatUsd(marketPrice.marketPriceUsd)}</strong>}
        </>}
        {tcgplayerCardUrl && <a className="scanner-beta-tcgplayer-link" href={tcgplayerCardUrl} target="_blank" rel="noopener noreferrer">View on TCGplayer</a>}
      </section>}
      <div className="scanner-beta-actions">
        <ScannerActionButton kind="collection" state={collectionActionState} onClick={onCollectionAction} />
        <ScannerActionButton kind="wishlist" state={wishlistActionState} onClick={onWishlistAction} />
        {actionError && <p className="scanner-beta-action-error" role="alert">{actionError}</p>}
        <button className="text-action" type="button" disabled={collectionActionState === "saving" || wishlistActionState === "saving"} onClick={onScanAnother}>Scan Another</button>
      </div>
    </div>
  </section>;
}

export default function MobileScannerPage({ authState, authUserId, onRequireAuth, onAddToCollection, onAddToWishlist, onLoadActionState, onSearchManually, onLoadCardPrice }) {
  const imageRef = useRef(null); const videoRef = useRef(null); const nativePreviewRef = useRef(null); const streamRef = useRef(null); const nativeAdapterRef = useRef(null); const nativeOcrRef = useRef(null);
  const startingRef = useRef(null); const lifecycleRef = useRef(0); const mountedRef = useRef(true); const stageRef = useRef("camera"); const tipsRef = useRef(false); const analysisRef = useRef(0); const captureRef = useRef(false); const runtimeAttemptRef = useRef(0);
  const actionStateLoadRef = useRef(0); const collectionOperationRef = useRef(0); const wishlistOperationRef = useRef(0); const actionPendingRef = useRef({ collection: false, wishlist: false });
  const [stage, setStage] = useState("camera"); const [match, setMatch] = useState(null); const [selectedCardId, setSelectedCardId] = useState(""); const [confirmed, setConfirmed] = useState(null); const [error, setError] = useState("");
  const [showTips, setShowTips] = useState(() => !haveSeenTips()); const [previewReady, setPreviewReady] = useState(false); const [marketPrice, setMarketPrice] = useState(null); const [priceState, setPriceState] = useState("idle"); const [captureBusy, setCaptureBusy] = useState(false); const [runtimeState, setRuntimeState] = useState("idle"); const [cameraEpoch, setCameraEpoch] = useState(0);
  const [collectionActionState, setCollectionActionState] = useState("auth-required"); const [wishlistActionState, setWishlistActionState] = useState("auth-required"); const [actionError, setActionError] = useState("");
  stageRef.current = stage; tipsRef.current = showTips;

  const cameraShouldRun = () => mountedRef.current && stageRef.current === "camera" && !tipsRef.current && !document.hidden;
  async function stopCamera() {
    lifecycleRef.current += 1;
    stopBrowserCamera(videoRef.current, streamRef.current); streamRef.current = null;
    await nativeAdapterRef.current?.stopPreview?.().catch(() => {});
    if (mountedRef.current) setPreviewReady(false);
  }

  async function loadNative() {
    if (!usesAndroidNativeScanner()) return null;
    if (!nativeAdapterRef.current) {
      const module = await import("./lib/nativeScannerAdapters.js");
      nativeAdapterRef.current = module.nativeCameraAdapter; nativeOcrRef.current = module.nativeOcrAdapter;
    }
    return nativeAdapterRef.current;
  }

  async function ensureCameraStarted() {
    if (!cameraShouldRun() || startingRef.current) return startingRef.current;
    const generation = lifecycleRef.current;
    let operation;
    operation = Promise.resolve().then(async () => {
      try {
        if (!cameraShouldRun()) return;
        setError(""); scannerDebug("camera-start", { native: usesAndroidNativeScanner(), stage: stageRef.current });
        if (usesAndroidNativeScanner()) {
          if (!nativePreviewRef.current) return;
          const adapter = await loadNative(); let permission = await adapter.checkPermission?.();
          if (permission !== "granted") permission = await adapter.requestPermission?.();
          if (permission !== "granted") throw new Error(permission === "permanentlyDenied" ? "Camera access is blocked. Enable it in device settings, then try again." : "Camera access wasn’t available. Choose a photo instead.");
          await adapter.stopPreview?.(); await adapter.startPreview(nativePreviewRef.current, { toBack: true });
        } else {
          if (!videoRef.current) return;
          const tracks = streamRef.current?.getTracks?.() || [];
          if (tracks.some((track) => track.readyState === "live")) { setPreviewReady(true); return; }
          stopBrowserCamera(videoRef.current, streamRef.current); streamRef.current = null;
          const capability = getBrowserCameraCapability(); if (!capability.available) throw new Error(capability.reason);
          const stream = await startBrowserCamera(videoRef.current);
          if (generation !== lifecycleRef.current || !cameraShouldRun()) { stopBrowserCamera(videoRef.current, stream); return; }
          streamRef.current = stream;
        }
        if (generation === lifecycleRef.current && cameraShouldRun()) setPreviewReady(true);
      } catch (cameraError) {
        if (generation === lifecycleRef.current) setError(cameraError?.message || "Camera access wasn’t available. Choose a photo instead.");
      } finally {
        if (startingRef.current === operation) startingRef.current = null;
        if (generation !== lifecycleRef.current && cameraShouldRun()) window.setTimeout(ensureCameraStarted, 0);
      }
    });
    startingRef.current = operation; return operation;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; analysisRef.current += 1; releaseTemporaryImage(imageRef.current); void stopCamera(); };
  }, []);
  useEffect(() => {
    if (!cameraShouldRun()) { void stopCamera(); return undefined; }
    const timer = window.setTimeout(() => { void ensureCameraStarted(); }, 0);
    return () => window.clearTimeout(timer);
  }, [stage, showTips, cameraEpoch]);
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) void stopCamera(); else setCameraEpoch((value) => value + 1); };
    document.addEventListener("visibilitychange", onVisibility); return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (showTips || stage !== "camera") return undefined;
    const attempt = ++runtimeAttemptRef.current; setRuntimeState("loading");
    import("./lib/frozenAScanner.js").then(({ preloadFrozenAScanner }) => preloadFrozenAScanner()).then(() => {
      if (mountedRef.current && attempt === runtimeAttemptRef.current) setRuntimeState("ready");
    }).catch((runtimeError) => {
      if (mountedRef.current && attempt === runtimeAttemptRef.current) { setRuntimeState("failed"); setError(runtimeError?.message || "Scanner initialization failed. Try again."); }
    });
    return () => { runtimeAttemptRef.current += 1; };
  }, [showTips, stage]);
  useEffect(() => {
    const load = ++actionStateLoadRef.current;
    collectionOperationRef.current += 1; wishlistOperationRef.current += 1;
    actionPendingRef.current = { collection: false, wishlist: false };
    setActionError("");
    if (!confirmed) {
      setCollectionActionState(authState === "authenticated" ? "idle" : "auth-required");
      setWishlistActionState(authState === "authenticated" ? "idle" : "auth-required");
      return undefined;
    }
    if (authState !== "authenticated" || !authUserId) {
      setCollectionActionState("auth-required"); setWishlistActionState("auth-required");
      return undefined;
    }

    setCollectionActionState("idle"); setWishlistActionState("idle");
    void Promise.resolve(onLoadActionState?.(confirmed)).then((nextState) => {
      if (!mountedRef.current || load !== actionStateLoadRef.current) return;
      setCollectionActionState(nextState?.collectionAdded ? "already-added" : "idle");
      setWishlistActionState(nextState?.wishlisted ? "already-added" : "idle");
    }).catch((stateError) => {
      if (import.meta.env.DEV) console.warn("[PackDex scanner] action state load failed", stateError);
    });
    return () => { actionStateLoadRef.current += 1; };
  }, [confirmed?.cardId, confirmed?.setId, authState, authUserId]);

  function beginScanning() { markTipsSeen(); setShowTips(false); setCameraEpoch((value) => value + 1); }
  function closeTips() { setShowTips(false); setCameraEpoch((value) => value + 1); }

  async function analyze(image, browser = false) {
    const analysis = ++analysisRef.current; const started = performance.now(); setStage("analyzing"); setMatch(null); setSelectedCardId("");
    try {
      const recognized = browser ? await recognizeBrowserImage(image) : await recognizeCardText(image, { adapter: nativeOcrRef.current });
      const fused = recognized.fusedMatch || (recognized.visualMatch ? fuseCardMatches(recognized.ocrMatch, recognized.visualMatch) : recognized.ocrMatch);
      scannerDebug("analysis-complete", { adapter: browser ? "browser-production-visual" : "nativeOcrAdapter", totalMs: performance.now() - started, rawOcrCandidates: recognized.ocrMatch?.results?.length || 0, rawVisualCandidates: recognized.visualMatch?.lightweight?.candidates?.length || 0, normalizedCandidates: fused?.results?.length || 0, scannerTiming: recognized.scannerTiming || null });
      if (analysis !== analysisRef.current) return;
      if (!fused?.results?.length) { setStage("no-match"); return; }
      setMatch(fused); setSelectedCardId(fused.primaryMatch?.cardId || fused.results[0].cardId); setStage("candidates");
    } catch (scanError) {
      if (analysis !== analysisRef.current) return;
      setError("We couldn't process that photo. Please try again or choose a photo."); setStage("processing-error");
      if (import.meta.env.DEV) console.error("[PackDex scanner] processing failed", scanError);
    }
  }

  async function capture() {
    if (captureRef.current) return;
    captureRef.current = true; setCaptureBusy(true);
    setError("");
    try {
      const browser = !usesAndroidNativeScanner(); const nextImage = browser ? await captureBrowserFrame(videoRef.current) : await nativeAdapterRef.current.capturePreview();
      scannerDebug("capture-valid", { source: browser ? "browser-live" : "native-preview", type: nextImage?.file?.constructor?.name || typeof nextImage?.imageUrl, mimeType: nextImage?.file?.type || "image/jpeg", bytes: nextImage?.file?.size || 0, dataUrlLength: nextImage?.imageUrl?.startsWith("data:") ? nextImage.imageUrl.length : 0, videoWidth: videoRef.current?.videoWidth || null, videoHeight: videoRef.current?.videoHeight || null });
      await stopCamera(); releaseTemporaryImage(imageRef.current); imageRef.current = nextImage; await analyze(nextImage, browser);
    } catch (captureError) { setError(captureError?.message || "We couldn't capture that card. Please try again."); setStage("camera"); setCameraEpoch((value) => value + 1); } finally { captureRef.current = false; if (mountedRef.current) setCaptureBusy(false); }
  }

  async function choosePhoto() {
    if (captureRef.current) return;
    captureRef.current = true; setCaptureBusy(true);
    setError("");
    try {
      const browser = !usesAndroidNativeScanner();
      if (!browser) await stopCamera();
      const adapter = browser ? null : await loadNative();
      const nextImage = await captureCardImage({ source: "library", nativeAdapter: adapter, selectBrowserFile: chooseBrowserFile });
      if (browser) await stopCamera();
      releaseTemporaryImage(imageRef.current); imageRef.current = nextImage; await analyze(nextImage, !usesAndroidNativeScanner());
    } catch (photoError) { if (photoError?.code !== "cancelled") setError(photoError?.message || "We couldn't open that photo."); setStage("camera"); setCameraEpoch((value) => value + 1); } finally { captureRef.current = false; if (mountedRef.current) setCaptureBusy(false); }
  }

  function resetCamera() { analysisRef.current += 1; actionStateLoadRef.current += 1; collectionOperationRef.current += 1; wishlistOperationRef.current += 1; actionPendingRef.current = { collection: false, wishlist: false }; releaseTemporaryImage(imageRef.current); imageRef.current = null; setMatch(null); setSelectedCardId(""); setConfirmed(null); setCollectionActionState(authState === "authenticated" ? "idle" : "auth-required"); setWishlistActionState(authState === "authenticated" ? "idle" : "auth-required"); setActionError(""); setMarketPrice(null); setPriceState("idle"); setError(""); setPreviewReady(false); setStage("camera"); setCameraEpoch((value) => value + 1); }
  function confirmSelection() {
    const selected = confirmTrustedCandidate(match, selectedCardId);
    if (!selected) { setError("Choose one of the suggested cards before confirming."); return; }

    setConfirmed(selected); setMarketPrice(null); setPriceState("loading"); setError(""); setStage("confirmed");
    void Promise.resolve(onLoadCardPrice?.(selected.card, { id: selected.setId, name: selected.setName }))
      .then((nextPrice) => { if (mountedRef.current) { setMarketPrice(nextPrice || null); setPriceState(Number(nextPrice?.marketPriceUsd) > 0 ? "available" : "no-price"); } })
      .catch(() => { if (mountedRef.current) { setMarketPrice(null); setPriceState("error"); } });
  }
  async function saveAction(kind) {
    if (!confirmed) return;
    const setState = kind === "collection" ? setCollectionActionState : setWishlistActionState;
    const currentState = kind === "collection" ? collectionActionState : wishlistActionState;
    if (authState !== "authenticated" || !authUserId) {
      setState("auth-required"); setActionError(""); onRequireAuth?.(); return;
    }
    if (actionPendingRef.current[kind] || ["saving", "success", "already-added"].includes(currentState)) return;

    actionPendingRef.current[kind] = true;
    const operationRef = kind === "collection" ? collectionOperationRef : wishlistOperationRef;
    const operation = ++operationRef.current;
    const cardId = confirmed.cardId;
    setState("saving"); setActionError("");
    try {
      const outcome = kind === "collection" ? await onAddToCollection?.(confirmed) : await onAddToWishlist?.(confirmed);
      if (!mountedRef.current || operation !== operationRef.current || confirmed.cardId !== cardId || authState !== "authenticated") return;
      setState(outcome?.added === false || outcome?.alreadyAdded ? "already-added" : "success");
    } catch (saveError) {
      if (!mountedRef.current || operation !== operationRef.current) return;
      setState("error");
      setActionError(`We couldn’t add this card to your ${kind === "collection" ? "Collection" : "Wishlist"}. Please try again.`);
    } finally {
      if (operation === operationRef.current) actionPendingRef.current[kind] = false;
    }
  }

  return <section className={`scanner-beta scanner-beta-${stage}`} aria-label="Card Scanner">
    {showTips && <ScannerTips onStart={beginScanning} onClose={closeTips} />}
    {stage === "camera" && <section className="scanner-beta-camera" aria-label="Live card camera"><div className="scanner-beta-camera-host" ref={nativePreviewRef}>{!usesAndroidNativeScanner() && <video ref={videoRef} muted playsInline autoPlay /> }<div className="scanner-beta-frame" aria-hidden="true"><span /></div></div>{runtimeState === "loading" && <p className="scanner-beta-preparing" role="status">Preparing scanner…</p>}<div className="scanner-beta-camera-controls"><button className="scanner-beta-camera-action" type="button" disabled={captureBusy || runtimeState === "loading"} onClick={choosePhoto}>Choose Photo</button><button className="scanner-beta-shutter" type="button" aria-label="Capture card" disabled={!previewReady || captureBusy || runtimeState !== "ready"} onClick={capture}><span /></button><button className="scanner-beta-help" type="button" disabled={captureBusy} aria-label="Scanner tips" onClick={() => { void stopCamera(); setShowTips(true); }}>?</button></div></section>}
    {stage === "analyzing" && <section className="scanner-beta-state" aria-live="polite"><span className="scanner-spinner" aria-hidden="true" /><h2>Reading your card</h2><p>Looking for the best matches now.</p></section>}
    {stage === "no-match" && <section className="scanner-beta-state"><h2>We couldn’t identify this card confidently.</h2><p>Keep the full card in view, reduce glare, and try again.</p><div className="scanner-beta-actions"><button className="primary-action" type="button" onClick={resetCamera}>Try Again</button><button className="secondary-action" type="button" onClick={choosePhoto}>Choose Photo</button><button className="secondary-action" type="button" onClick={onSearchManually}>Search Manually</button></div></section>}
    {stage === "processing-error" && <section className="scanner-beta-state"><h2>We couldn’t process that photo</h2><p>Please try again or choose a photo.</p><div className="scanner-beta-actions"><button className="primary-action" type="button" onClick={resetCamera}>Try Again</button><button className="secondary-action" type="button" onClick={choosePhoto}>Choose Photo</button><button className="secondary-action" type="button" onClick={onSearchManually}>Search Manually</button></div></section>}
    {stage === "candidates" && <section className="scanner-beta-results" aria-live="polite"><h2>Choose the matching card</h2><p>Review the suggestions before you confirm.</p><div className="scanner-beta-candidates">{match.results.slice(0, 3).map((candidate) => <ScannerCandidate key={candidate.cardId} candidate={candidate} isSelected={selectedCardId === candidate.cardId} onSelect={setSelectedCardId} />)}</div><div className="scanner-beta-actions"><button className="primary-action" type="button" onClick={confirmSelection}>Confirm selected card</button><button className="secondary-action" type="button" onClick={resetCamera}>Scan Another</button></div></section>}
    {stage === "confirmed" && confirmed && <ScannerConfirmedResult confirmed={confirmed} marketPrice={marketPrice} priceState={priceState} collectionActionState={collectionActionState} wishlistActionState={wishlistActionState} actionError={actionError} onCollectionAction={() => saveAction("collection")} onWishlistAction={() => saveAction("wishlist")} onScanAnother={resetCamera} />}
    {error && <p className="scanner-beta-error" role="alert">{error}</p>}
  </section>;
}
