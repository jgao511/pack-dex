import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";
import { CameraPreview } from "@capacitor-community/camera-preview";
import { App } from "@capacitor/app";
import { CapacitorPluginMlKitTextRecognition } from "@pantrist/capacitor-plugin-ml-kit-text-recognition";
import { CardCaptureError } from "../../../src/lib/cardScanner/captureCardImage.js";
import { createOcrPasses, getOcrCropDefinitions, prepareCardImage } from "../../../src/lib/cardScanner/prepareCardImage.js";
import {
  analyzeNextProposalBatch,
  beginProposalScan,
  prewarmVisualWorker,
  releaseProposalSession,
} from "../../../src/lib/cardScanner/localVisual/visualWorkerClient.js";
import { fuseCardMatches } from "../../../src/lib/cardScanner/fuseCardMatches.js";
import { rankFinalProposalRuns, rankProposalEvidence } from "../../../src/lib/cardScanner/proposalEvidence.js";
import { rankCardMatches } from "../../../src/lib/cardScanner/rankCardMatches.js";
import { runVisualMatching } from "../../../src/lib/cardScanner/localVisual/runVisualMatching.js";
import { recognizeFrozenA } from "./frozenAScanner.js";
import { isAndroidNative } from "./platform.js";

function permissionStatus(value) { if (value === "granted" || value === "limited") return "granted"; if (value === "denied") return "permanentlyDenied"; return "denied"; }
function photoToTemporaryImage(photo) {
  const imageUrl = photo?.webPath || (photo?.path ? Capacitor.convertFileSrc(photo.path) : "");
  if (!imageUrl) throw new CardCaptureError("malformed-result", "We couldn’t open that photo. Please try another one.");
  let released = false; return { imageUrl, nativePath: photo.path || null, format: photo.format || null, release() { released = true; this.nativePath = null; this.imageUrl = ""; } };
}
function isCancellation(error) { return /cancel|user cancelled|user canceled/i.test(String(error?.message || error || "")); }
function temporaryDataImage(value, previewGeometry) {
  let imageUrl = `data:image/jpeg;base64,${String(value || "").replace(/^data:image\/[^;]+;base64,/, "")}`;
  return { imageUrl, previewGeometry, nativePath: null, format: "jpeg", release() { imageUrl = ""; this.imageUrl = ""; this.previewGeometry = null; } };
}
function setPreviewTransparency(active) {
  for (const element of [document.documentElement, document.body, document.getElementById("root")]) element?.classList.toggle("scanner-camera-active", active);
}
let previewOperation = Promise.resolve();
function serializePreview(operation) {
  const next = previewOperation.catch(() => {}).then(operation);
  previewOperation = next;
  return next;
}
async function cameraIsStarted() {
  try { return Boolean((await CameraPreview.isCameraStarted()).value); } catch { return false; }
}
const candidateImageCache = new Map();
async function loadCandidateImageBlob(url) {
  if (candidateImageCache.has(url)) return candidateImageCache.get(url);
  const pending = (async () => {
    if (!isAndroidNative()) { const response = await fetch(url); if (!response.ok) throw new Error(`Candidate image HTTP ${response.status}`); return response.blob(); }
    const response = await CapacitorHttp.get({ url, responseType: "blob", connectTimeout: 10_000, readTimeout: 15_000 });
    if (response.status < 200 || response.status >= 300 || typeof response.data !== "string") throw new Error(`Candidate image HTTP ${response.status}`);
    const binary = atob(response.data); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: response.headers?.["Content-Type"] || response.headers?.["content-type"] || "image/jpeg" });
  })();
  candidateImageCache.set(url, pending);
  if (candidateImageCache.size > 24) candidateImageCache.delete(candidateImageCache.keys().next().value);
  try { return await pending; } catch (error) { candidateImageCache.delete(url); throw error; }
}

export const nativeCameraAdapter = {
  isAvailable: () => isAndroidNative(),
  async checkPermission() { return permissionStatus((await Camera.checkPermissions()).camera); },
  async requestPermission() { return permissionStatus((await Camera.requestPermissions({ permissions: ["camera"] })).camera); },
  async capture({ source }) {
    try {
      const photo = await Camera.getPhoto({ source: source === "camera" ? CameraSource.Camera : CameraSource.Photos, direction: CameraDirection.Rear, resultType: CameraResultType.Uri, quality: 92, width: 1800, height: 1800, allowEditing: false, correctOrientation: true, saveToGallery: false });
      return photoToTemporaryImage(photo);
    } catch (error) { if (isCancellation(error)) return null; throw new CardCaptureError("capture-failed", source === "camera" ? "Camera access wasn’t available." : "We couldn’t open that photo."); }
  },
  async startPreview(element, { toBack = true } = {}) {
    return serializePreview(async () => {
      const rect = element.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      setPreviewTransparency(toBack);
      try {
        if (await cameraIsStarted()) await CameraPreview.stop();
        // Android's plugin converts these values from dp to physical pixels, so
        // CSS coordinates must not be multiplied by devicePixelRatio here.
        await CameraPreview.start({
          position: "rear", parent: element.id, className: "packdex-camera-preview",
          x: Math.round(rect.left), y: Math.round(rect.top),
          width: Math.round(rect.width), height: Math.round(rect.height),
          disableAudio: true, storeToFile: false, disableExifHeaderStripping: false,
          lockAndroidOrientation: true, toBack,
        });
        const { value: started } = await CameraPreview.isCameraStarted();
        if (!started) throw new CardCaptureError("preview-not-started", "The embedded camera did not start.");
        return { previewStarted: true, toBack, previewX: rect.left, previewY: rect.top, previewWidth: rect.width, previewHeight: rect.height, devicePixelRatio: dpr, outline: { x: 10, y: 10, width: rect.width - 20, height: rect.height - 20 }, displayOrientation: screen.orientation?.type || "portrait", displayRotation: screen.orientation?.angle || 0 };
      } catch (error) { setPreviewTransparency(false); throw error; }
    });
  },
  async capturePreview(previewGeometry) {
    await previewOperation;
    if (!(await cameraIsStarted())) throw new CardCaptureError("preview-not-started", "The embedded camera is not ready yet.");
    const picture = await CameraPreview.capture({ quality: 92 });
    if (!picture?.value) throw new CardCaptureError("malformed-result", "We couldn’t capture that card.");
    return temporaryDataImage(picture.value, previewGeometry);
  },
  async stopPreview() { setPreviewTransparency(false); return serializePreview(async () => { if (await cameraIsStarted()) await CameraPreview.stop(); }); },
  async listenForAppState(callback) { return App.addListener("appStateChange", callback); },
  async listenForRestoredCapture(callback) { return App.addListener("appRestoredResult", ({ pluginId, methodName, data, success }) => { if (success && pluginId === "Camera" && methodName === "getPhoto" && data) callback(photoToTemporaryImage(data)); }); },
};

async function recognizeProposalPasses(canvas, labels) {
  const conversionStarted = performance.now();
  const definitions = createOcrPasses(canvas, { labels }); const results = [];
  const conversionMs = performance.now() - conversionStarted;
  for (let index = 0; index < definitions.length; index += 1) {
    const pass = definitions[index];
    const passStarted = performance.now();
    try {
      const result = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image: pass.base64Image, rotation: 0 });
      results.push({
        label: pass.label, width: pass.width, height: pass.height,
        text: result.text || "", blocks: result.blocks || [],
        previewUrl: pass.label === "collector-bottom-edge" ? `data:image/jpeg;base64,${pass.base64Image}` : null,
        conversionMs: index === 0 ? conversionMs : 0,
        base64Bytes: pass.base64Image.length,
        processingMs: performance.now() - passStarted,
      });
    } finally { pass.base64Image = ""; }
  }
  return results;
}

function summarizeOcrPasses(results) {
  const matchStarted = performance.now();
  const text = results.map((pass) => pass.text).filter(Boolean).join("\n");
  const blocks = results.flatMap((pass) => pass.blocks.map((block) => ({ ...block, sourcePass: pass.label })));
  const ocrMatch = rankCardMatches({ rawText: text, textBlocks: blocks, maxResults: 3 });
  return { text, blocks, ocrMatch, matchProcessingMs: performance.now() - matchStarted };
}
function canvasToBase64(canvas) { return canvas.toDataURL("image/jpeg", .88).replace(/^data:image\/[^;]+;base64,/, ""); }

function rotateCanvasQuarterTurns(source, rotationApplied) {
  const turns = ((rotationApplied / 90) % 4 + 4) % 4; const swapped = turns % 2 === 1;
  const canvas = document.createElement("canvas"); canvas.width = swapped ? source.height : source.width; canvas.height = swapped ? source.width : source.height;
  const context = canvas.getContext("2d"); context.translate(canvas.width / 2, canvas.height / 2); context.rotate(turns * Math.PI / 2);
  context.drawImage(source, -source.width / 2, -source.height / 2); return canvas;
}
function orientationTextScore(text) {
  const value = String(text || ""); const letters = (value.match(/[A-Za-z]/g) || []).length; const words = (value.match(/[A-Za-z]{3,}/g) || []).length;
  const collector = /\b(?:[A-Z]{1,3}\d{1,3}|\d{1,3})\s*\/\s*\d{1,3}\b/i.test(value) ? 30 : 0;
  const layout = /\b(?:basic|stage|trainer|supporter|pokemon|hp|weakness|resistance|retreat)\b/i.test(value) ? 16 : 0;
  return Math.min(120, letters) + words * 4 + collector + layout;
}
async function selectNativeLandscapeOrientation(canvas) {
  if (!(canvas.width > canvas.height)) return null;
  const candidates = [];
  for (const rotationApplied of [90, 270]) {
    const probe = rotateCanvasQuarterTurns(canvas, rotationApplied);
    try {
      const result = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image: canvasToBase64(probe), rotation: 0 });
      const text = result?.text || ""; candidates.push({ rotationApplied, score: orientationTextScore(text), textLength: text.length });
    } catch { candidates.push({ rotationApplied, score: 0, textLength: 0 }); }
    finally { probe.width = 1; probe.height = 1; }
  }
  candidates.sort((left, right) => right.score - left.score || right.textLength - left.textLength || left.rotationApplied - right.rotationApplied);
  const selected = candidates[0];
  return selected?.score >= 20 ? { canvas: rotateCanvasQuarterTurns(canvas, selected.rotationApplied), rotationApplied: selected.rotationApplied, diagnostics: { method: "landscape-ocr-layout", candidates } } : null;
}

let scannerPrewarmPromise;
let scannerPrewarmResult;
let candidateOriginPrewarmPromise;
function prewarmCandidateOrigin() {
  if (!isAndroidNative()) return Promise.resolve({ attempted: false });
  if (!candidateOriginPrewarmPromise) {
    const started = performance.now();
    candidateOriginPrewarmPromise = CapacitorHttp.request({
      url: "https://assets.pack-dex.com/", method: "HEAD",
      connectTimeout: 2_500, readTimeout: 2_500,
    }).then((response) => ({ attempted: true, status: response.status, processingMs: performance.now() - started }))
      .catch((error) => ({ attempted: true, error: error?.message || String(error), processingMs: performance.now() - started }));
  }
  return candidateOriginPrewarmPromise;
}
async function prewarmScannerResources() {
  if (scannerPrewarmResult) return { ...scannerPrewarmResult, reused: true, waitMs: 0 };
  if (!scannerPrewarmPromise) {
    const started = performance.now();
    scannerPrewarmPromise = Promise.all([prewarmVisualWorker(), prewarmCandidateOrigin()]).then(([result, candidateOrigin]) => {
      scannerPrewarmResult = { ...result, candidateOrigin, totalMs: performance.now() - started, reused: false };
      return scannerPrewarmResult;
    }).catch((error) => { scannerPrewarmPromise = undefined; throw error; });
  }
  const waitStarted = performance.now();
  const result = await scannerPrewarmPromise;
  return { ...result, waitMs: performance.now() - waitStarted };
}

function securedResultReason(completed) {
  if (completed.fusedMatch?.confidence === "high") return "existing-high-confidence";
  const topResultId = completed.fusedMatch?.results?.[0]?.cardId;
  const topOrb = completed.visualMatch?.orb?.candidates?.find(({ cardId }) => cardId === topResultId);
  return topResultId && topOrb?.score >= .55 && topOrb?.inliers >= 12 ? "existing-strong-orb" : null;
}

const proposalOptions = {
  output: { width: 500, height: 700 }, maxProposals: 10,
  centeredHeightFractions: [.46, .52, .58, .66],
  centeredOffsets: [{ x: 0, y: -.045 }, { x: 0, y: .045 }, { x: -.04, y: 0 }, { x: .04, y: 0 }],
  offsetHeightFraction: .56,
};

async function completeProposalRun(run, workerRuntime) {
  const started = performance.now();
  const enhanced = await recognizeProposalPasses(run.proposal.canvas, ["name-top", "collector-bottom", "collector-bottom-edge"]);
  const passes = [...run.passes, ...enhanced]; const summary = summarizeOcrPasses(passes);
  const visualStarted = performance.now();
  let visualMatch; let visualError = null;
  try {
    visualMatch = await runVisualMatching(run.proposal.canvas, summary.ocrMatch, {
      candidateLimit: 40, orbCandidateLimit: 20,
      precomputedLightweight: run.lightweight,
      loadImageBlob: loadCandidateImageBlob,
      knownWorkerRuntime: workerRuntime,
    });
  } catch (error) {
    visualError = error?.message || String(error);
    visualMatch = { lightweight: run.lightweight, orb: { candidates: [], processingMs: 0 }, candidateIds: [] };
  }
  const fusionStarted = performance.now();
  const fusedMatch = fuseCardMatches(summary.ocrMatch, visualMatch);
  const fusionMs = performance.now() - fusionStarted;
  return {
    ...run, ...summary, passes, visualMatch, visualError, fusedMatch, fusionMs,
    enhancedAndVisualMs: performance.now() - started,
    visualWallMs: fusionStarted - visualStarted,
  };
}

export const nativeOcrAdapter = {
  prewarm: prewarmScannerResources,
  async recognize(image) {
    const scanStarted = performance.now();
    const workerRuntime = await prewarmScannerResources();
    const resourceWaitFinished = performance.now();
    let sessionInfo;
    let sessionId;
    const processedProposals = [];
    const batchTimings = [];
    const firstPassRuns = [];
    const completedById = new Map();
    let securedRun = null;
    let earlyCompletionReason = null;
    let preparationFinished;
    let outputStarted;
    try {
      const working = await prepareCardImage(image, { includePasses: false, normalizeOrientation: selectNativeLandscapeOrientation, rectify: async ({ fullCanvas, mappedCrop, originalWidth, originalHeight }) => {
        const outline = mappedCrop ? {
          x: mappedCrop.x * fullCanvas.width / originalWidth,
          y: mappedCrop.y * fullCanvas.height / originalHeight,
          width: mappedCrop.width * fullCanvas.width / originalWidth,
          height: mappedCrop.height * fullCanvas.height / originalHeight,
        } : null;
        sessionInfo = await beginProposalScan(fullCanvas, { ...proposalOptions, outline });
        sessionId = sessionInfo.sessionId;
        return {
          canvas: fullCanvas,
          diagnostics: {
            selectedSource: null, fallbackReason: null,
            proposalProcessingMs: sessionInfo.generationMs,
            proposalCount: sessionInfo.proposalCount,
          },
        };
      } });
      preparationFinished = performance.now();

      while (sessionInfo && processedProposals.length < sessionInfo.proposalCount) {
        const batchStarted = performance.now();
        const batch = await analyzeNextProposalBatch(sessionId, { batchSize: 1, limit: 40 });
        batchTimings.push({
          fromCursor: batch.fromCursor, nextCursor: batch.nextCursor,
          workerMs: batch.processingMs, wallMs: performance.now() - batchStarted,
        });
        const proposal = batch.proposals[0];
        if (!proposal) break;
        processedProposals.push(proposal);
        const firstPassStarted = performance.now();
        const passes = await recognizeProposalPasses(proposal.canvas, ["full-card"]);
        const summary = summarizeOcrPasses(passes);
        const ranked = rankProposalEvidence([{ proposal, passes, ...summary, lightweight: proposal.lightweight }]);
        const run = { ...ranked[0], firstPassWallMs: performance.now() - firstPassStarted };
        firstPassRuns.push(run);

        // Proposal order is execution-only. An attempted proposal still uses
        // the full existing OCR, visual, ORB, fusion, and confidence rules.
        const completed = await completeProposalRun(run, workerRuntime);
        completedById.set(proposal.id, completed);
        const reason = securedResultReason(completed);
        if (reason) {
          securedRun = completed;
          earlyCompletionReason = reason;
          break;
        }
      }

      const rankedFirstPass = rankProposalEvidence(firstPassRuns);
      let selected = securedRun;
      if (!selected) {
        const finalists = rankedFirstPass.slice(0, Math.min(2, rankedFirstPass.length));
        const finalRuns = finalists.map(({ proposal }) => completedById.get(proposal.id)).filter(Boolean);
        selected = rankFinalProposalRuns(finalRuns)[0] || finalRuns[0] || rankedFirstPass[0];
      }
      if (!selected) throw new CardCaptureError("no-proposals", "We couldnâ€™t isolate a card in that photo.");

      outputStarted = performance.now();
      const previewUrl = selected.proposal.canvas.toDataURL("image/jpeg", .92);
      const proposalPreviews = processedProposals.map((proposal) => ({
        id: proposal.id, source: proposal.source,
        previewUrl: proposal.id === selected.proposal.id ? previewUrl : proposal.canvas.toDataURL("image/jpeg", .76),
      }));
      const rankedById = new Map(rankedFirstPass.map((run) => [run.proposal.id, run]));
      const proposalDiagnostics = (sessionInfo.proposals || []).map((metadata) => {
        const run = rankedById.get(metadata.id);
        const completed = completedById.get(metadata.id);
        const evidenceSource = completed || run;
        return {
          ...metadata,
          processingState: completed ? "completed" : earlyCompletionReason ? "skipped-after-secure-result" : "not-processed",
          evidence: evidenceSource?.evidence || null,
          ocrText: completed?.text || run?.text || "",
          ocrNames: evidenceSource?.ocrMatch?.nameCandidates?.map(({ raw }) => raw) || [],
          ocrNumbers: evidenceSource?.ocrMatch?.collectorNumbers?.map(({ raw, sourcePass }) => ({ raw, sourcePass })) || [],
          lightweightCandidates: run?.lightweight?.candidates || [],
          enteredOrbPass: Boolean(completed), orbShortlist: completed?.visualMatch?.candidateIds || [],
          orbCandidates: completed?.visualMatch?.orb?.candidates || [],
          fusedCandidates: completed?.fusedMatch?.results?.map(({ cardId, confidence, score }) => ({ cardId, confidence, score })) || [],
          selected: metadata.id === selected.proposal.id,
        };
      });
      const selectedBottom = selected.passes?.find((pass) => pass.label === "collector-bottom-edge")?.previewUrl || null;
      const frozenA = await recognizeFrozenA(selected.proposal.canvas, selected.ocrMatch);
      const finished = performance.now();
      const completedRuns = [...completedById.values()];
      const allPasses = completedRuns.flatMap((run) => run.passes || []);
      return {
        text: selected.text || "", blocks: selected.blocks || [], passes: selected.passes || [],
        ocrMatch: selected.ocrMatch, visualMatch: selected.visualMatch || null, imageDiagnostics: working.boundaryDiagnostics || null, frozenA, fusedMatch: frozenA.fusedMatch, visualError: selected.visualError || null,
        scannerTiming: {
          schemaVersion: 1,
          totalMs: finished - scanStarted,
          resourceWaitMs: resourceWaitFinished - scanStarted,
          preparationMs: preparationFinished - resourceWaitFinished,
          image: working.timing,
          worker: {
            prewarm: workerRuntime,
            generationMs: sessionInfo.generationMs,
            cvLoadMs: sessionInfo.cvLoadMs,
            cachedProposalBytes: sessionInfo.cachedBytes,
            batchSearchMs: batchTimings.reduce((total, timing) => total + timing.workerMs, 0),
            batchRoundTripMs: batchTimings.reduce((total, timing) => total + timing.wallMs, 0),
          },
          proposalsAvailable: sessionInfo.proposalCount,
          proposalsProcessed: processedProposals.length,
          earlyCompletion: Boolean(earlyCompletionReason),
          earlyCompletionReason,
          firstPassOcrWallMs: firstPassRuns.reduce((total, run) => total + run.firstPassWallMs, 0),
          ocrCalls: allPasses.length,
          ocrConversionMs: allPasses.reduce((total, pass) => total + (pass.conversionMs || 0), 0),
          ocrBridgeAndDetectMs: allPasses.reduce((total, pass) => total + (pass.processingMs || 0), 0),
          ocrMatchMs: completedRuns.reduce((total, run) => total + (run.matchProcessingMs || 0), 0),
          visualMs: completedRuns.reduce((total, run) => total + (run.visualMatch?.totalProcessingMs || 0), 0),
          orbMs: completedRuns.reduce((total, run) => total + (run.visualMatch?.orb?.processingMs || 0), 0),
          fusionMs: completedRuns.reduce((total, run) => total + (run.fusionMs || 0), 0),
          outputPreviewMs: finished - outputStarted,
        },
        previewUrl, proposalPreviews,
        originalPreviewUrl: working.originalPreviewUrl, outlinePreviewUrl: working.outlinePreviewUrl, bottomPreviewUrl: selectedBottom,
        imageDiagnostics: {
          originalWidth: working.originalWidth, originalHeight: working.originalHeight,
          preparedWidth: selected.proposal.canvas.width, preparedHeight: selected.proposal.canvas.height,
          mappedCrop: working.mappedCrop,
          boundary: { ...working.boundaryDiagnostics, selectedSource: selected.proposal.source, selectedProposalId: selected.proposal.id },
          proposals: proposalDiagnostics,
          previewGeometry: image.previewGeometry || null,
          bottomCrop: getOcrCropDefinitions(selected.proposal.canvas.width, selected.proposal.canvas.height).find((crop) => crop.label === "collector-bottom-edge"),
          detectedOrientation: "portrait", rotationApplied: working.rotationApplied,
        },
      };
    } finally {
      if (sessionId) { try { await releaseProposalSession(sessionId); } catch {} }
      for (const proposal of processedProposals) { proposal.canvas.width = 0; proposal.canvas.height = 0; }
    }
  },
};
