import { useEffect, useRef, useState } from "react";
import { captureCardImage, CardCaptureError } from "../../src/lib/cardScanner/captureCardImage.js";
import { recognizeCardText } from "../../src/lib/cardScanner/recognizeCardText.js";
import { rankCardMatches } from "../../src/lib/cardScanner/rankCardMatches.js";
import { confirmTrustedCandidate, getScannerResultMode, releaseTemporaryImage } from "../../src/lib/cardScanner/scannerSession.js";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";

const examples = ["Charizard ex\n199/165", "UMBRE0N EX\n161 / 131", "Pikachu\n58/102", "Pikachu", "copyright 2025 pokemon creatures inc"];

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
  const [devText, setDevText] = useState(examples[0]);
  const fileInputRef = useRef(null); const pendingFileRef = useRef(null);
  const activeOcrAdapter = ocrAdapter || globalThis.__PACKDEX_SCANNER_OCR__;

  useEffect(() => () => releaseTemporaryImage(image), [image]);

  function selectBrowserFile(options) {
    return new Promise((resolve) => {
      pendingFileRef.current = resolve;
      const input = fileInputRef.current;
      input.accept = options.accept; input.capture = options.capture || ""; input.value = ""; input.click();
    });
  }
  async function beginCapture(source) {
    setMessage(""); setConfirmed(null); setSelected(null); setMatch(null);
    let nextImage = null;
    try {
      nextImage = await captureCardImage({ source, nativeAdapter: nativeCameraAdapter, selectBrowserFile });
      releaseTemporaryImage(image); setImage(nextImage); setStage("processing");
      const reading = await recognizeCardText(nextImage, { adapter: activeOcrAdapter });
      finishReading(reading.fullText, reading.blocks);
    } catch (error) {
      if (error?.code === "cancelled") { setStage("start"); return; }
      setMessage(error instanceof CardCaptureError ? error.message : error.message || "We couldn’t read this card.");
      setStage(nextImage ? "captured" : "start");
    }
  }
  function finishReading(fullText, blocks = []) {
    const nextMatch = rankCardMatches({ rawText: fullText, textBlocks: blocks, maxResults: 5 });
    setMatch(nextMatch); setSelected(null); setStage("result"); setMessage("");
  }
  function reset() { releaseTemporaryImage(image); setImage(null); setMatch(null); setSelected(null); setConfirmed(null); setMessage(""); setStage("start"); }
  function confirm(result) { const trusted = confirmTrustedCandidate(match, result.cardId); if (trusted) { setConfirmed(trusted); setSelected(result); } }
  const mode = getScannerResultMode(match); const highResult = match?.primaryMatch;

  return <main className="scanner-dev">
    <header><span className="eyebrow">Internal Preview</span><h1>Scan a Card</h1><p>Place the full card inside the frame</p></header>
    <input ref={fileInputRef} className="scanner-file-input" type="file" accept="image/*" onCancel={() => { const resolve = pendingFileRef.current; pendingFileRef.current = null; resolve?.(null); }} onChange={(event) => { const resolve = pendingFileRef.current; pendingFileRef.current = null; resolve?.(event.target.files?.[0] || null); }} />
    <section className={`scanner-frame ${image ? "has-image" : ""}`}>{image ? <img src={image.imageUrl} alt="Captured card" /> : <div className="scanner-frame-guide"><span>Align card here</span></div>}{stage === "processing" && <div className="scanner-reading"><span className="scanner-spinner" />Reading card…</div>}</section>
    {message && <p className="scanner-message" role="status">{message}</p>}
    {stage === "start" && <div className="scanner-primary-actions"><button className="primary-action" type="button" onClick={() => beginCapture("camera")}>Scan Card</button><button className="secondary-action" type="button" onClick={() => beginCapture("library")}>Choose Photo</button></div>}
    {(stage === "captured" || (image && stage === "result")) && <button className="text-action" type="button" onClick={reset}>Cancel</button>}
    {stage === "captured" && <><div className="scanner-result-actions"><button className="secondary-action" type="button" onClick={() => beginCapture("camera")}>Retake Photo</button></div><section className="scanner-dev-reading"><label htmlFor="scanner-dev-text">Development card text</label><textarea id="scanner-dev-text" rows="4" value={devText} onChange={(e) => setDevText(e.target.value)} /><div className="scanner-example-row">{examples.map((example) => <button type="button" key={example} onClick={() => setDevText(example)}>{example.split("\n")[0]}</button>)}</div><button className="primary-action" type="button" onClick={() => finishReading(devText)}>Read Test Text</button></section></>}
    {stage === "result" && mode === "high" && highResult && <section className="scanner-result"><span className="scanner-confidence">High confidence</span><Candidate result={highResult} onSelect={confirm} actionLabel="Confirm Card" /><div className="scanner-result-actions"><button className="secondary-action" type="button" onClick={() => { setMatch({ ...match, confidence: "medium", primaryMatch: null }); setSelected(null); }}>Not This Card</button><button className="secondary-action" type="button" onClick={reset}>Scan Again</button></div></section>}
    {stage === "result" && mode === "medium" && <section className="scanner-result"><h2>Choose the matching card</h2>{match.results.slice(0, 3).map((result) => <Candidate key={result.cardId} result={result} onSelect={(item) => setSelected(item)} />)}{selected && <button className="primary-action" type="button" onClick={() => confirm(selected)}>Confirm Card</button>}<button className="secondary-action" type="button" onClick={reset}>Scan Again</button></section>}
    {stage === "result" && mode === "low" && <section className="scanner-result scanner-low"><h2>We couldn’t confidently identify this card.</h2>{match.results?.length > 0 && <details><summary>Choose From Matches</summary>{match.results.slice(0, 3).map((result) => <Candidate key={result.cardId} result={result} onSelect={(item) => setSelected(item)} />)}{selected && <button className="primary-action" type="button" onClick={() => confirm(selected)}>Confirm Card</button>}</details>}<button className="primary-action" type="button" onClick={reset}>Scan Again</button></section>}
    {confirmed && <section className="scanner-confirmed" role="status"><span>Confirmed locally</span><strong>{confirmed.card.name}</strong><small>Trusted PackDex card ID: {confirmed.cardId}</small></section>}
  </main>;
}
