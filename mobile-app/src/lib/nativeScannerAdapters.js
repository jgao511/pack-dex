import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";
import { CameraPreview } from "@capacitor-community/camera-preview";
import { App } from "@capacitor/app";
import { CapacitorPluginMlKitTextRecognition } from "@pantrist/capacitor-plugin-ml-kit-text-recognition";
import { CardCaptureError } from "../../../src/lib/cardScanner/captureCardImage.js";
import { createOcrPasses, getOcrCropDefinitions, prepareCardImage } from "../../../src/lib/cardScanner/prepareCardImage.js";
import { analyzeProposalCanvases } from "../../../src/lib/cardScanner/localVisual/visualWorkerClient.js";
import { fuseCardMatches } from "../../../src/lib/cardScanner/fuseCardMatches.js";
import { rankFinalProposalRuns, rankProposalEvidence } from "../../../src/lib/cardScanner/proposalEvidence.js";
import { rankCardMatches } from "../../../src/lib/cardScanner/rankCardMatches.js";
import { runVisualMatching } from "../../../src/lib/cardScanner/localVisual/runVisualMatching.js";

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
    if (!Capacitor.isNativePlatform()) { const response = await fetch(url); if (!response.ok) throw new Error(`Candidate image HTTP ${response.status}`); return response.blob(); }
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
  isAvailable: () => Capacitor.isNativePlatform(),
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
  const definitions = createOcrPasses(canvas, { labels }); const results = [];
  for (const pass of definitions) {
    const passStarted = performance.now();
    try {
      const result = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image: pass.base64Image, rotation: 0 });
      results.push({
        label: pass.label, width: pass.width, height: pass.height,
        text: result.text || "", blocks: result.blocks || [],
        previewUrl: pass.label === "collector-bottom-edge" ? `data:image/jpeg;base64,${pass.base64Image}` : null,
        processingMs: performance.now() - passStarted,
      });
    } finally { pass.base64Image = ""; }
  }
  return results;
}

function summarizeOcrPasses(results) {
  const text = results.map((pass) => pass.text).filter(Boolean).join("\n");
  const blocks = results.flatMap((pass) => pass.blocks.map((block) => ({ ...block, sourcePass: pass.label })));
  return { text, blocks, ocrMatch: rankCardMatches({ rawText: text, textBlocks: blocks, maxResults: 3 }) };
}

export const nativeOcrAdapter = {
  async recognize(image) {
    const scanStarted = performance.now();
    let proposalAnalysis;
    const working = await prepareCardImage(image, { includePasses: false, rectify: async ({ fullCanvas, mappedCrop, originalWidth, originalHeight }) => {
      const outline = mappedCrop ? {
        x: mappedCrop.x * fullCanvas.width / originalWidth,
        y: mappedCrop.y * fullCanvas.height / originalHeight,
        width: mappedCrop.width * fullCanvas.width / originalWidth,
        height: mappedCrop.height * fullCanvas.height / originalHeight,
      } : null;
      proposalAnalysis = await analyzeProposalCanvases(fullCanvas, {
        outline, output: { width: 500, height: 700 }, maxProposals: 10,
        centeredHeightFractions: [.46, .52, .58, .66],
        centeredOffsets: [{ x: 0, y: -.045 }, { x: 0, y: .045 }, { x: -.04, y: 0 }, { x: .04, y: 0 }],
        offsetHeightFraction: .56,
      }, 40);
      const proposals = proposalAnalysis.proposals;
      return {
        canvas: proposals[0]?.canvas || fullCanvas,
        proposals,
        diagnostics: {
          selectedSource: null, fallbackReason: null,
          proposalProcessingMs: proposalAnalysis.processingMs,
          proposalCount: proposals.length,
        },
      };
    } });
    const preparationFinished = performance.now();
    const proposals = working.proposals?.length ? working.proposals : proposalAnalysis?.proposals || [];
    try {
      const firstPassRuns = [];
      for (const proposal of proposals) {
        const passes = await recognizeProposalPasses(proposal.canvas, ["full-card"]);
        const summary = summarizeOcrPasses(passes);
        firstPassRuns.push({ proposal, passes, ...summary, lightweight: proposal.lightweight });
      }
      const rankedFirstPass = rankProposalEvidence(firstPassRuns);
      const finalists = rankedFirstPass.slice(0, Math.min(2, rankedFirstPass.length));
      const ocrFirstPassFinished = performance.now();
      const finalRuns = [];
      for (const finalist of finalists) {
        const enhanced = await recognizeProposalPasses(finalist.proposal.canvas, ["name-top", "collector-bottom", "collector-bottom-edge"]);
        const passes = [...finalist.passes, ...enhanced]; const summary = summarizeOcrPasses(passes);
        let visualMatch; let visualError = null;
        try {
          visualMatch = await runVisualMatching(finalist.proposal.canvas, summary.ocrMatch, {
            candidateLimit: 40, orbCandidateLimit: 20,
            precomputedLightweight: finalist.lightweight,
            loadImageBlob: loadCandidateImageBlob,
          });
        } catch (error) {
          visualError = error?.message || String(error);
          visualMatch = { lightweight: finalist.lightweight, orb: { candidates: [], processingMs: 0 }, candidateIds: [] };
        }
        const completed = { ...finalist, ...summary, passes, visualMatch, visualError, fusedMatch: fuseCardMatches(summary.ocrMatch, visualMatch) };
        finalRuns.push(completed);
        const topResultId = completed.fusedMatch?.results?.[0]?.cardId;
        const topOrb = completed.visualMatch?.orb?.candidates?.find(({ cardId }) => cardId === topResultId);
        if (completed.fusedMatch?.confidence === "high" || (topResultId && topOrb?.score >= .55 && topOrb?.inliers >= 12)) break;
      }
      const visualFinished = performance.now();
      const rankedFinal = rankFinalProposalRuns(finalRuns);
      const selected = rankedFinal[0] || finalRuns[0] || rankedFirstPass[0];
      if (!selected) throw new CardCaptureError("no-proposals", "We couldnâ€™t isolate a card in that photo.");
      const proposalPreviews = proposals.map((proposal) => ({ id: proposal.id, source: proposal.source, previewUrl: proposal.canvas.toDataURL("image/jpeg", .76) }));
      const proposalDiagnostics = rankedFirstPass.map((run) => {
        const completed = finalRuns.find(({ proposal }) => proposal.id === run.proposal.id);
        return {
          id: run.proposal.id, source: run.proposal.source, corners: run.proposal.corners,
          geometryScore: run.proposal.geometryScore, quality: run.proposal.quality,
          detector: run.proposal.detector, isFallback: run.proposal.isFallback,
          evidence: run.evidence, ocrText: completed?.text || run.text,
          ocrNames: (completed?.ocrMatch || run.ocrMatch)?.nameCandidates?.map(({ raw }) => raw) || [],
          ocrNumbers: (completed?.ocrMatch || run.ocrMatch)?.collectorNumbers?.map(({ raw, sourcePass }) => ({ raw, sourcePass })) || [],
          lightweightCandidates: run.lightweight?.candidates || [],
          enteredOrbPass: Boolean(completed), orbShortlist: completed?.visualMatch?.candidateIds || [],
          orbCandidates: completed?.visualMatch?.orb?.candidates || [],
          fusedCandidates: completed?.fusedMatch?.results?.map(({ cardId, confidence, score }) => ({ cardId, confidence, score })) || [],
          selected: run.proposal.id === selected.proposal.id,
        };
      });
      const selectedBottom = selected.passes?.find((pass) => pass.label === "collector-bottom-edge")?.previewUrl || null;
      const previewUrl = selected.proposal.canvas.toDataURL("image/jpeg", .92);
      const finished = performance.now();
      return {
        text: selected.text || "", blocks: selected.blocks || [], passes: selected.passes || [],
        ocrMatch: selected.ocrMatch, visualMatch: selected.visualMatch || null, visualError: selected.visualError || null,
        scannerTiming: {
          totalMs: finished - scanStarted,
          preparationMs: preparationFinished - scanStarted,
          proposalOcrMs: ocrFirstPassFinished - preparationFinished,
          finalistOcrAndVisualMs: visualFinished - ocrFirstPassFinished,
          ocrMs: (selected.passes || []).reduce((total, pass) => total + (pass.processingMs || 0), 0),
          visualMs: selected.visualMatch?.totalProcessingMs || 0,
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
      for (const proposal of proposals) { proposal.canvas.width = 0; proposal.canvas.height = 0; }
    }
  },
};
