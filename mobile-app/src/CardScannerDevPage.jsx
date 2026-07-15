import { useEffect, useRef, useState } from "react";
import { captureCardImage, CardCaptureError, createTemporaryImage } from "../../src/lib/cardScanner/captureCardImage.js";
import { recognizeCardText } from "../../src/lib/cardScanner/recognizeCardText.js";
import { rankCardMatches } from "../../src/lib/cardScanner/rankCardMatches.js";
import { fuseCardMatches } from "../../src/lib/cardScanner/fuseCardMatches.js";
import { confirmTrustedCandidate, getScannerResultMode, releaseTemporaryImage } from "../../src/lib/cardScanner/scannerSession.js";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";
import { nativeCameraAdapter as defaultNativeCameraAdapter, nativeOcrAdapter as defaultOcrAdapter } from "./lib/nativeScannerAdapters.js";
import referenceCardUrl from "../../tests/fixtures/scanner/mega-charizard-x-ex-013-094.jpg?url";
import pixelFixture1Url from "../../tests/fixtures/scanner/pixel-real/here-comes-team-rocket-113-108.jpg?url";
import pixelFixture2Url from "../../tests/fixtures/scanner/pixel-real/diglett-55-108.jpg?url";
import pixelFixture3Url from "../../tests/fixtures/scanner/pixel-real/gardevoir-ex-111-114.jpg?url";
import pixelFixture4Url from "../../tests/fixtures/scanner/pixel-real/mega-charizard-x-ex-013-094.jpg?url";

const examples = ["Charizard ex\n199/165", "UMBRE0N EX\n161 / 131", "Pikachu\n58/102", "Pikachu", "copyright 2025 pokemon creatures inc"];
const pixelFixtureUrls = [pixelFixture1Url, pixelFixture2Url, pixelFixture3Url, pixelFixture4Url];

function Candidate({ result, onSelect, actionLabel = "Select Card" }) {
  return <article className="scanner-candidate"><img src={getCardImageUrl(result.card)} alt={result.card.name} /><div><h3>{result.card.name}</h3><p>{result.setName} · #{result.card.number}</p><p>{result.card.rarity}</p>{result.reasons?.length > 0 && <small>{result.reasons.slice(0, 2).join(" · ")}</small>}<button className="secondary-action" type="button" onClick={() => onSelect(result)}>{actionLabel}</button></div></article>;
}

export default function CardScannerDevPage({ nativeCameraAdapter, ocrAdapter } = {}) {
  const [stage, setStage] = useState("start");
  const [image, setImage] = useState(null);
  const [match, setMatch] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [message, setMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState(null);
  const [bottomPreviewUrl, setBottomPreviewUrl] = useState("");
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState("");
  const [outlinePreviewUrl, setOutlinePreviewUrl] = useState("");
  const [proposalPreviews, setProposalPreviews] = useState([]);
  const [previewInFront, setPreviewInFront] = useState(false);
  const [previewStart, setPreviewStart] = useState(null);
  const [devText, setDevText] = useState(examples[0]);
  const fileInputRef = useRef(null); const pendingFileRef = useRef(null);
  const previewRef = useRef(null); const previewGeometryRef = useRef(null);
  const activeCameraAdapter = nativeCameraAdapter || defaultNativeCameraAdapter;
  const activeOcrAdapter = ocrAdapter || (defaultNativeCameraAdapter.isAvailable() ? defaultOcrAdapter : globalThis.__PACKDEX_SCANNER_OCR__);

  useEffect(() => () => releaseTemporaryImage(image), [image]);
  useEffect(() => {
    let active = true;
    activeOcrAdapter?.prewarm?.().then((result) => {
      if (active) globalThis.__PACKDEX_SCANNER_PREWARM__ = { ready: true, ...result };
    }).catch((error) => {
      if (active) globalThis.__PACKDEX_SCANNER_PREWARM__ = { ready: false, error: error?.message || String(error) };
    });
    return () => { active = false; };
  }, [activeOcrAdapter]);
  useEffect(() => {
    globalThis.__PACKDEX_RUN_LOCAL_SCANNER_FILE__ = async (file) => {
      if (!(file instanceof File)) throw new Error("A real browser File is required.");
      const temporaryImage = createTemporaryImage(file);
      try {
        const reading = await recognizeCardText(temporaryImage, { adapter: activeOcrAdapter });
        const ocrMatch = reading.ocrMatch || rankCardMatches({ rawText: reading.fullText, textBlocks: reading.blocks, maxResults: 3 });
        const finalMatch = reading.visualMatch ? fuseCardMatches(ocrMatch, reading.visualMatch) : ocrMatch;
        return {
          file: { name: file.name, size: file.size, type: file.type },
          rawText: reading.fullText,
          ocrNames: ocrMatch.nameCandidates?.map(({ raw, normalized }) => ({ raw, normalized })) || [],
          ocrNumbers: ocrMatch.collectorNumbers?.map(({ raw, normalized, normalizedTotal, sourcePass }) => ({ raw, normalized, normalizedTotal, sourcePass })) || [],
          result: {
            confidence: finalMatch.confidence,
            results: finalMatch.results?.map(({ cardId, score, confidence, card, setName, reasons }) => ({ cardId, name: card.name, setName, score, confidence, reasons })) || [],
          },
          selectedProposalId: reading.imageDiagnostics?.boundary?.selectedProposalId || null,
          selectedProposalSource: reading.imageDiagnostics?.boundary?.selectedSource || null,
          proposals: reading.imageDiagnostics?.proposals?.map(({ id, source, processingState, enteredOrbPass, selected }) => ({ id, source, processingState, enteredOrbPass, selected })) || [],
          lightweightCandidates: reading.visualMatch?.lightweight?.candidates || [],
          orbShortlist: reading.visualMatch?.candidateIds || [],
          orbCandidates: reading.visualMatch?.orb?.candidates || [],
          timing: reading.scannerTiming || null,
        };
      } finally { releaseTemporaryImage(temporaryImage); }
    };
    return () => { delete globalThis.__PACKDEX_RUN_LOCAL_SCANNER_FILE__; };
  }, [activeOcrAdapter]);
  useEffect(() => {
    if (stage !== "start" || !activeCameraAdapter.isAvailable()) return undefined;
    setPreviewStart(null);
    let cancelled = false;
    const frame = requestAnimationFrame(async () => {
      try {
        await activeCameraAdapter.stopPreview?.();
        const geometry = await activeCameraAdapter.startPreview?.(previewRef.current, { toBack: !previewInFront });
        if (cancelled) await activeCameraAdapter.stopPreview?.(); else { previewGeometryRef.current = geometry; setPreviewStart(geometry); }
      } catch (error) { if (!cancelled) setMessage(error?.message || "Camera access wasn’t available."); }
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); activeCameraAdapter.stopPreview?.(); };
  }, [stage, previewInFront]);
  useEffect(() => {
    let handle;
    activeCameraAdapter.listenForAppState?.(({ isActive }) => {
      if (!isActive) activeCameraAdapter.stopPreview?.();
      else if (stage === "start") activeCameraAdapter.startPreview?.(previewRef.current, { toBack: !previewInFront }).then((geometry) => { previewGeometryRef.current = geometry; setPreviewStart(geometry); }).catch((error) => setMessage(error?.message || "Camera access wasn’t available."));
    }).then((value) => { handle = value; });
    return () => handle?.remove?.();
  }, [stage, previewInFront]);
  useEffect(() => { let handle; activeCameraAdapter.listenForRestoredCapture?.((restored) => { releaseTemporaryImage(image); setImage(restored); setStage("processing"); setMessage(""); recognizeCardText(restored, { adapter: activeOcrAdapter }).then((reading) => { if (!reading.fullText.trim() && !reading.visualMatch?.lightweight?.candidates?.length) throw new Error("We couldn’t read enough from this photo. Try again with the card flat and fully visible."); finishReading(reading.fullText, reading.blocks, reading); }).catch(() => { setStage("captured"); setMessage("We couldn’t read enough from this photo. Try again with the card flat and fully visible."); }); }).then((value) => { handle = value; }); return () => handle?.remove?.(); }, []);

  function selectBrowserFile(options) {
    return new Promise((resolve) => {
      pendingFileRef.current = resolve;
      const input = fileInputRef.current;
      input.accept = options.accept; input.capture = options.capture || ""; input.value = ""; input.click();
    });
  }
  async function beginCapture(source) {
    if (source === "camera") return capturePreview();
    setMessage(""); setConfirmed(null); setSelected(null); setMatch(null);
    let nextImage = null;
    try {
      nextImage = await captureCardImage({ source, nativeAdapter: activeCameraAdapter, selectBrowserFile });
      releaseTemporaryImage(image); setImage(nextImage); setStage("processing");
      const reading = await recognizeCardText(nextImage, { adapter: activeOcrAdapter });
      if (!reading.fullText.trim() && !reading.visualMatch?.lightweight?.candidates?.length) throw Object.assign(new Error("We couldn’t read enough from this photo. Try again with the card flat and fully visible."), { code: "empty-scan" });
      if (reading.previewUrl) setImage({ ...nextImage, imageUrl: reading.previewUrl });
      setOriginalPreviewUrl(reading.originalPreviewUrl || ""); setOutlinePreviewUrl(reading.outlinePreviewUrl || "");
      setBottomPreviewUrl(reading.bottomPreviewUrl || "");
      finishReading(reading.fullText, reading.blocks, reading);
    } catch (error) {
      if (error?.code === "cancelled") { setStage("start"); return; }
      setMessage(error instanceof CardCaptureError ? error.message : error.message || "We couldn’t read this card.");
      setStage(nextImage ? "captured" : "start");
    }
  }
  async function capturePreview() {
    setMessage(""); setConfirmed(null); setSelected(null); setMatch(null);
    let nextImage;
    try {
      nextImage = await activeCameraAdapter.capturePreview(previewGeometryRef.current);
      await activeCameraAdapter.stopPreview();
      releaseTemporaryImage(image); setImage(nextImage); setStage("processing");
      const reading = await recognizeCardText(nextImage, { adapter: activeOcrAdapter });
      if (!reading.fullText.trim() && !reading.visualMatch?.lightweight?.candidates?.length) throw new Error("We couldn’t read enough from this photo. Try again with the card flat and fully visible.");
      if (reading.previewUrl) setImage({ ...nextImage, imageUrl: reading.previewUrl });
      setOriginalPreviewUrl(reading.originalPreviewUrl || ""); setOutlinePreviewUrl(reading.outlinePreviewUrl || "");
      setBottomPreviewUrl(reading.bottomPreviewUrl || "");
      finishReading(reading.fullText, reading.blocks, reading);
    } catch (error) {
      await activeCameraAdapter.stopPreview?.();
      setMessage(error?.message || "We couldn’t read this card."); setStage(nextImage ? "captured" : "start");
    }
  }
  async function runReferenceTest() {
    setMessage(""); setConfirmed(null); setSelected(null); setMatch(null); setBottomPreviewUrl("");
    await activeCameraAdapter.stopPreview?.();
    let referenceImage;
    try {
      const blob = await fetch(referenceCardUrl).then((response) => response.blob());
      const file = new File([blob], "mega-charizard-x-ex-013-094.jpg", { type: blob.type || "image/jpeg" });
      referenceImage = createTemporaryImage(file);
      releaseTemporaryImage(image); setImage(referenceImage); setStage("processing");
      const reading = await recognizeCardText(referenceImage, { adapter: activeOcrAdapter });
      if (!reading.fullText.trim() && !reading.visualMatch?.lightweight?.candidates?.length) throw new Error("The reference image produced no usable local evidence.");
      if (reading.previewUrl) setImage({ ...referenceImage, imageUrl: reading.previewUrl });
      setOriginalPreviewUrl(reading.originalPreviewUrl || ""); setOutlinePreviewUrl(reading.outlinePreviewUrl || "");
      setBottomPreviewUrl(reading.bottomPreviewUrl || "");
      finishReading(reading.fullText, reading.blocks, reading);
    } catch (error) { setMessage(error?.message || "The reference test could not run."); setStage("captured"); }
  }
  async function runPixelFixtureTest(index) {
    setMessage(""); setConfirmed(null); setSelected(null); setMatch(null); setBottomPreviewUrl(""); setProposalPreviews([]);
    await activeCameraAdapter.stopPreview?.();
    let fixtureImage;
    try {
      const blob = await fetch(pixelFixtureUrls[index]).then((response) => response.blob());
      const file = new File([blob], `pixel-fixture-${index + 1}.jpg`, { type: blob.type || "image/jpeg" });
      fixtureImage = createTemporaryImage(file);
      releaseTemporaryImage(image); setImage(fixtureImage); setStage("processing");
      const reading = await recognizeCardText(fixtureImage, { adapter: activeOcrAdapter });
      if (!reading.fullText.trim() && !reading.visualMatch?.lightweight?.candidates?.length) throw new Error("The Pixel fixture produced no usable local evidence.");
      if (reading.previewUrl) setImage({ ...fixtureImage, imageUrl: reading.previewUrl });
      setOriginalPreviewUrl(reading.originalPreviewUrl || ""); setOutlinePreviewUrl(reading.outlinePreviewUrl || "");
      setBottomPreviewUrl(reading.bottomPreviewUrl || ""); setProposalPreviews(reading.proposalPreviews || []);
      globalThis.__PACKDEX_PIXEL_FIXTURE_RESULT__ = { index, reading: { ...reading, previewUrl: undefined, proposalPreviews: undefined, originalPreviewUrl: undefined, outlinePreviewUrl: undefined, bottomPreviewUrl: undefined } };
      finishReading(reading.fullText, reading.blocks, reading);
    } catch (error) { setMessage(error?.message || "The Pixel fixture test could not run."); setStage("captured"); }
  }
  function finishReading(fullText, blocks = [], reading = {}) {
    const ocrMatch = reading.ocrMatch || rankCardMatches({ rawText: fullText, textBlocks: blocks, maxResults: 3 });
    const nextMatch = reading.visualMatch ? fuseCardMatches(ocrMatch, reading.visualMatch) : ocrMatch;
    setProposalPreviews(reading.proposalPreviews || []);
    const nextDiagnostics = { previewStart, image: reading.imageDiagnostics || null, timing: reading.scannerTiming || null, passes: reading.passes || [], visual: reading.visualMatch || null, visualError: reading.visualError || null, rawText: fullText, normalizedText: nextMatch.normalizedText, collectorNumbers: nextMatch.collectorNumbers, nameCandidates: nextMatch.nameCandidates, narrowedSetIds: nextMatch.narrowedSetIds, narrowedCardIds: nextMatch.narrowedCardIds, matches: nextMatch.results.map(({ cardId, score, confidence, reasons, setName, card }) => ({ cardId, name: card.name, setName, score, confidence, reasons })) };
    setDiagnostics(nextDiagnostics); globalThis.__PACKDEX_SCANNER_LAST_RESULT__ = nextDiagnostics;
    setMatch(nextMatch); setSelected(null); setStage("result"); setMessage("");
  }
  function reset() { releaseTemporaryImage(image); setImage(null); setBottomPreviewUrl(""); setOriginalPreviewUrl(""); setOutlinePreviewUrl(""); setProposalPreviews([]); setMatch(null); setSelected(null); setConfirmed(null); setDiagnostics(null); setMessage(""); setStage("start"); }
  function confirm(result) { const trusted = confirmTrustedCandidate(match, result.cardId); if (trusted) { setConfirmed(trusted); setSelected(result); } }
  const mode = getScannerResultMode(match); const highResult = match?.primaryMatch;

  return <main className={`scanner-dev ${stage === "start" ? "preview-active" : ""}`}>
    <header><button className="scanner-close text-action" type="button" aria-label="Close scanner" onClick={() => { activeCameraAdapter.stopPreview?.(); history.length > 1 ? history.back() : window.location.assign("/"); }}>×</button><span className="eyebrow">Internal Preview</span><h1>Scan a Card</h1><p>Line up the full card inside the frame</p></header>
    <input ref={fileInputRef} className="scanner-file-input" type="file" accept="image/*" onCancel={() => { const resolve = pendingFileRef.current; pendingFileRef.current = null; resolve?.(null); }} onChange={(event) => { const resolve = pendingFileRef.current; pendingFileRef.current = null; resolve?.(event.target.files?.[0] || null); }} />
    <div id="scanner-camera-preview" ref={previewRef} className="scanner-preview-host">
    <section className={`scanner-frame ${image ? "has-image" : ""}`}>{image ? <img src={image.imageUrl} alt="Captured card" /> : <div className="scanner-frame-guide"><span>Align card here</span></div>}{stage === "processing" && <div className="scanner-reading"><span className="scanner-spinner" />Reading card…</div>}</section>
    </div>
    {message && <p className="scanner-message" role="status">{message}</p>}
    {stage === "start" && <div className="scanner-primary-actions"><button className="scanner-shutter" type="button" aria-label="Capture card" disabled={activeCameraAdapter.isAvailable() && !previewStart?.previewStarted} onClick={capturePreview}><span /></button><button className="secondary-action" type="button" onClick={() => beginCapture("library")}>Choose Photo</button><button className="secondary-action" type="button" onClick={runReferenceTest}>Run Reference Test</button>{pixelFixtureUrls.map((_, index) => <button className="secondary-action" type="button" key={index} onClick={() => runPixelFixtureTest(index)}>Run Pixel Fixture {index + 1}</button>)}<label className="scanner-preview-diagnostic"><input type="checkbox" checked={previewInFront} onChange={(event) => setPreviewInFront(event.target.checked)} /> Diagnostic: preview in front</label>{previewStart?.previewStarted && <small>Embedded preview started · {Math.round(previewStart.previewWidth)} × {Math.round(previewStart.previewHeight)}</small>}</div>}
    {(stage === "captured" || (image && stage === "result")) && <button className="text-action" type="button" onClick={reset}>Cancel</button>}
    {stage === "captured" && <><div className="scanner-result-actions"><button className="secondary-action" type="button" onClick={() => beginCapture("camera")}>Retake Photo</button></div><section className="scanner-dev-reading"><label htmlFor="scanner-dev-text">Development card text</label><textarea id="scanner-dev-text" rows="4" value={devText} onChange={(e) => setDevText(e.target.value)} /><div className="scanner-example-row">{examples.map((example) => <button type="button" key={example} onClick={() => setDevText(example)}>{example.split("\n")[0]}</button>)}</div><button className="primary-action" type="button" onClick={() => finishReading(devText)}>Read Test Text</button></section></>}
    {stage === "result" && mode === "high" && highResult && <section className="scanner-result"><span className="scanner-confidence">High confidence</span><Candidate result={highResult} onSelect={confirm} actionLabel="Confirm Card" /><div className="scanner-result-actions"><button className="secondary-action" type="button" onClick={() => { setMatch({ ...match, confidence: "medium", primaryMatch: null }); setSelected(null); }}>Not This Card</button><button className="secondary-action" type="button" onClick={reset}>Scan Again</button></div></section>}
    {stage === "result" && mode === "medium" && <section className="scanner-result"><h2>Choose the matching card</h2>{match.results.slice(0, 3).map((result) => <Candidate key={result.cardId} result={result} onSelect={(item) => setSelected(item)} />)}{selected && <button className="primary-action" type="button" onClick={() => confirm(selected)}>Confirm Card</button>}<button className="secondary-action" type="button" onClick={reset}>Scan Again</button></section>}
    {stage === "result" && mode === "low" && <section className="scanner-result scanner-low"><h2>{match.results?.length ? "We couldn’t confidently identify this card." : "We couldn’t find a reliable match."}</h2><p>Keep the full card visible on a plain background, reduce glare, hold steady, and try without a sleeve if practical.</p>{match.results?.length > 0 && <details><summary>Choose From Matches</summary>{match.results.slice(0, 3).map((result) => <Candidate key={result.cardId} result={result} onSelect={(item) => setSelected(item)} />)}{selected && <button className="primary-action" type="button" onClick={() => confirm(selected)}>Confirm Card</button>}</details>}<div className="scanner-result-actions"><button className="primary-action" type="button" onClick={reset}>Scan Again</button><button className="secondary-action" type="button" onClick={() => beginCapture("library")}>Choose Photo</button></div></section>}
    {diagnostics && <details className="scanner-diagnostics"><summary>Scanner Diagnostics</summary><button className="secondary-action" type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(diagnostics, null, 2))}>Copy Diagnostics</button>{originalPreviewUrl && <figure><img src={originalPreviewUrl} alt="Original complete scanner image" /><figcaption>Original complete image</figcaption></figure>}{outlinePreviewUrl && <figure><img src={outlinePreviewUrl} alt="Mapped live-preview outline crop" /><figcaption>Mapped outline crop</figcaption></figure>}{image?.imageUrl && <figure><img src={image.imageUrl} alt="Exact final OCR and visual matching input" /><figcaption>Detected/rectified final matching image</figcaption></figure>}{bottomPreviewUrl && <figure><img src={bottomPreviewUrl} alt="Bottom collector-number OCR crop" /><figcaption>Bottom collector-number OCR crop</figcaption></figure>}{proposalPreviews.length > 0 && <details><summary>Processed card proposals ({proposalPreviews.length})</summary>{proposalPreviews.map((proposal) => <figure key={proposal.id}><img src={proposal.previewUrl} alt={`${proposal.source} card proposal`} /><figcaption>{proposal.id} · {proposal.source}</figcaption></figure>)}</details>}<pre>{JSON.stringify(diagnostics, null, 2)}</pre></details>}
    {confirmed && <section className="scanner-confirmed" role="status"><span>Confirmed locally</span><strong>{confirmed.card.name}</strong><small>Trusted PackDex card ID: {confirmed.cardId}</small></section>}
  </main>;
}
