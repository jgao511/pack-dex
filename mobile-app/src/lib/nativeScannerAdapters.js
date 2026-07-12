import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";
import { CameraPreview } from "@capacitor-community/camera-preview";
import { App } from "@capacitor/app";
import { CapacitorPluginMlKitTextRecognition } from "@pantrist/capacitor-plugin-ml-kit-text-recognition";
import { CardCaptureError } from "../../../src/lib/cardScanner/captureCardImage.js";
import { getOcrCropDefinitions, prepareCardImage } from "../../../src/lib/cardScanner/prepareCardImage.js";
import { rectifyCanvas } from "../../../src/lib/cardScanner/localVisual/visualWorkerClient.js";
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

export const nativeOcrAdapter = {
  async recognize(image) {
    const scanStarted = performance.now();
    const working = await prepareCardImage(image, { rectify: async ({ outlineCanvas, fullCanvas, mappedCrop }) => {
      const attempts = [];
      if (mappedCrop) {
        const outline = await rectifyCanvas(outlineCanvas); attempts.push({ source: "mapped-outline", ...outline, canvas: undefined });
        if (outline.canvas) return { canvas: outline.canvas, diagnostics: { selectedSource: "mapped-outline", fallbackReason: null, attempts } };
      }
      const full = await rectifyCanvas(fullCanvas); attempts.push({ source: "full-capture", ...full, canvas: undefined });
      if (full.canvas) return { canvas: full.canvas, diagnostics: { selectedSource: "full-capture", fallbackReason: mappedCrop ? "outline-boundary-uncertain" : null, attempts } };
      return { canvas: fullCanvas, diagnostics: { selectedSource: "full-capture-fallback", fallbackReason: full.detection?.fallbackReason || "card-boundary-uncertain", attempts } };
    } });
    const preparationFinished = performance.now();
    const results = [];
    for (const pass of working.passes) {
      const passStarted = performance.now();
      try { const result = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image: pass.base64Image, rotation: 0 }); results.push({ label: pass.label, width: pass.width, height: pass.height, text: result.text || "", blocks: result.blocks || [], processingMs: performance.now() - passStarted }); }
      finally { pass.base64Image = ""; }
    }
    const text = results.map((pass) => pass.text).filter(Boolean).join("\n");
    const blocks = results.flatMap((pass) => pass.blocks.map((block) => ({ ...block, sourcePass: pass.label })));
    const ocrMatch = rankCardMatches({ rawText: text, textBlocks: blocks, maxResults: 3 });
    let visualMatch = null; let visualError = null;
    const visualStarted = performance.now();
    try { visualMatch = await runVisualMatching(working.canvas, ocrMatch, { loadImageBlob: loadCandidateImageBlob }); }
    catch (error) { visualError = error?.message || String(error); }
    const finished = performance.now();
    return { text, blocks, passes: results, ocrMatch, visualMatch, visualError, scannerTiming: { totalMs: finished - scanStarted, preparationMs: preparationFinished - scanStarted, ocrMs: visualStarted - preparationFinished, visualMs: finished - visualStarted }, previewUrl: working.previewUrl, originalPreviewUrl: working.originalPreviewUrl, outlinePreviewUrl: working.outlinePreviewUrl, bottomPreviewUrl: working.bottomPreviewUrl, imageDiagnostics: { originalWidth: working.originalWidth, originalHeight: working.originalHeight, preparedWidth: working.width, preparedHeight: working.height, mappedCrop: working.mappedCrop, boundary: working.boundaryDiagnostics, previewGeometry: image.previewGeometry || null, bottomCrop: getOcrCropDefinitions(working.width, working.height).find((crop) => crop.label === "collector-bottom-edge"), detectedOrientation: working.detectedOrientation, rotationApplied: working.rotationApplied } };
  },
};
