import { createTemporaryImage } from "../../../src/lib/cardScanner/captureCardImage.js";
import { fuseCardMatches } from "../../../src/lib/cardScanner/fuseCardMatches.js";
import { runVisualMatching } from "../../../src/lib/cardScanner/localVisual/runVisualMatching.js";
import { rectifyCanvas } from "../../../src/lib/cardScanner/localVisual/visualWorkerClient.js";
import { rankCardMatches } from "../../../src/lib/cardScanner/rankCardMatches.js";
import { prepareCardImage } from "../../../src/lib/cardScanner/prepareCardImage.js";
import { applyFrozenAAcceptancePolicy } from "../../../src/lib/cardScanner/frozenAAcceptancePolicy.js";
import { recognizeFrozenA } from "./frozenAScanner.js";

const MIN_CAPTURE_BYTES = 1024;
const PICKER_FOCUS_DELAY_MS = 150;
const POKEMON_CARD_ASPECT_RATIO = 63 / 88;

export class BrowserCaptureError extends Error {
  constructor(code, message) { super(message); this.name = "BrowserCaptureError"; this.code = code; }
}

// iOS Safari can omit `change` when a file picker is cancelled. Keep this
// isolated from React so it can clean up every DOM listener deterministically.
export function chooseBrowserFile(options, {
  documentRef = document,
  windowRef = window,
  setTimeoutRef = setTimeout,
  clearTimeoutRef = clearTimeout,
} = {}) {
  return new Promise((resolve) => {
    const input = documentRef.createElement("input");
    let settled = false;
    let pickerBlurred = false;
    let focusTimer = null;

    const cleanup = () => {
      if (focusTimer !== null) clearTimeoutRef(focusTimer);
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      windowRef.removeEventListener("blur", onBlur);
      windowRef.removeEventListener("focus", onFocus);
      input.remove();
    };
    const finish = (file = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };
    const onChange = () => finish(input.files?.[0] || null);
    const onCancel = () => finish(null);
    const onBlur = () => { pickerBlurred = true; };
    const onFocus = () => {
      if (!pickerBlurred) return;
      if (focusTimer !== null) clearTimeoutRef(focusTimer);
      focusTimer = setTimeoutRef(() => finish(input.files?.[0] || null), PICKER_FOCUS_DELAY_MS);
    };

    input.type = "file";
    input.accept = options.accept || "image/*";
    if (options.capture) input.capture = options.capture;
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    input.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    windowRef.addEventListener("blur", onBlur);
    windowRef.addEventListener("focus", onFocus);
    documentRef.body.append(input);
    input.click();
  });
}

async function decodeBrowserImage(blob) {
  if (typeof globalThis.createImageBitmap === "function") {
    const bitmap = await globalThis.createImageBitmap(blob, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
  }
  if (typeof globalThis.Image !== "function") throw new BrowserCaptureError("decode-unavailable", "We couldn't process that photo. Please try again or choose a photo.");
  const imageUrl = URL.createObjectURL(blob); const image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new BrowserCaptureError("image-unreadable", "We couldn't process that photo. Please try again or choose a photo.")); image.src = imageUrl; });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(imageUrl) };
  } catch (error) { URL.revokeObjectURL(imageUrl); throw error; }
}

export function getBrowserCameraCapability(environment = globalThis) {
  const navigatorRef = environment?.navigator;
  if (!environment?.isSecureContext) return { available: false, reason: "Camera access requires a secure connection." };
  if (!navigatorRef?.mediaDevices?.getUserMedia) return { available: false, reason: "Live camera preview is not available in this browser." };
  return { available: true, reason: "" };
}

export async function startBrowserCamera(video, mediaDevices = globalThis.navigator?.mediaDevices, environment = globalThis) {
  const capability = getBrowserCameraCapability(environment);
  if (!capability.available) throw Object.assign(new Error(capability.reason), { code: "camera-unavailable" });
  if (!video) throw new Error("Camera preview is not ready.");
  const stream = await mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if ((!video.videoWidth || !video.videoHeight) && typeof video.addEventListener === "function") {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new BrowserCaptureError("preview-not-ready", "The camera is still starting. Try again in a moment.")), 3000);
      video.addEventListener("loadedmetadata", () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
  }
  return stream;
}

export function stopBrowserCamera(video, stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
  if (video) video.srcObject = null;
}

export async function captureBrowserFrame(video, { documentRef = document, FileCtor = File } = {}) {
  if (!video?.videoWidth || !video?.videoHeight) throw new Error("The camera is still starting. Try again in a moment.");
  const canvas = documentRef.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new BrowserCaptureError("canvas-unavailable", "We couldn't process that photo. Please try again or choose a photo.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob || blob.size < MIN_CAPTURE_BYTES || !/^image\/(jpeg|png|webp)$/i.test(blob.type)) throw new BrowserCaptureError("invalid-capture", "We couldn't process that photo. Please try again or choose a photo.");
  const pixels = context.getImageData(0, 0, Math.min(32, canvas.width), Math.min(32, canvas.height)).data;
  let minimum = 255; let maximum = 0;
  for (let index = 0; index < pixels.length; index += 4) { const value = pixels[index] + pixels[index + 1] + pixels[index + 2]; minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  if (maximum - minimum < 3) throw new BrowserCaptureError("blank-capture", "We couldn't process that photo. Please try again or choose a photo.");
  return createTemporaryImage(new FileCtor([blob], "card-scan.jpg", { type: blob.type }));
}

function rotateCanvasQuarterTurns(source, rotationApplied, documentRef = document) {
  const turns = ((rotationApplied / 90) % 4 + 4) % 4;
  const swapped = turns % 2 === 1;
  const canvas = documentRef.createElement("canvas"); canvas.width = swapped ? source.height : source.width; canvas.height = swapped ? source.width : source.height;
  const context = canvas.getContext("2d"); context.translate(canvas.width / 2, canvas.height / 2); context.rotate(turns * Math.PI / 2);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function orientationTextScore(text) {
  const value = String(text || "");
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  const words = (value.match(/[A-Za-z]{3,}/g) || []).length;
  const collector = /\b(?:[A-Z]{1,3}\d{1,3}|\d{1,3})\s*\/\s*\d{1,3}\b/i.test(value) ? 30 : 0;
  const cardLayout = /\b(?:basic|stage|trainer|supporter|pokemon|hp|weakness|resistance|retreat)\b/i.test(value) ? 16 : 0;
  return Math.min(120, letters) + words * 4 + collector + cardLayout;
}

async function selectBrowserLandscapeOrientation(canvas, TextDetector, documentRef) {
  if (!(canvas.width > canvas.height) || typeof TextDetector !== "function") return null;
  const candidates = [];
  for (const rotationApplied of [90, 270]) {
    const probe = rotateCanvasQuarterTurns(canvas, rotationApplied, documentRef);
    try {
      const text = (await new TextDetector().detect(probe)).map((item) => item.rawValue || "").join("\n");
      candidates.push({ rotationApplied, score: orientationTextScore(text), textLength: text.length });
    } catch { candidates.push({ rotationApplied, score: 0, textLength: 0 }); }
    finally { probe.width = 1; probe.height = 1; }
  }
  candidates.sort((left, right) => right.score - left.score || right.textLength - left.textLength || left.rotationApplied - right.rotationApplied);
  const selected = candidates[0];
  return selected?.score >= 20 ? { canvas: rotateCanvasQuarterTurns(canvas, selected.rotationApplied, documentRef), rotationApplied: selected.rotationApplied, diagnostics: { method: "landscape-ocr-layout", candidates } } : null;
}

function centeredCardFallback(source, documentRef) {
  const height = Math.round(source.height * .78); const width = Math.round(height * POKEMON_CARD_ASPECT_RATIO);
  if (!(width > 0 && height > 0 && width <= source.width && height <= source.height)) return null;
  const canvas = documentRef.createElement("canvas"); canvas.width = 500; canvas.height = 700;
  canvas.getContext("2d").drawImage(source, Math.round((source.width - width) / 2), Math.round((source.height - height) / 2), width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function recognizeBrowserImage(image, { decodeImage = decodeBrowserImage, documentRef = document, TextDetector = globalThis.TextDetector, visualMatcher = runVisualMatching, frozenRecognizer = recognizeFrozenA, prepareImage = prepareCardImage } = {}) {
  const blob = image?.file || await fetch(image?.imageUrl).then((response) => {
    if (!response.ok) throw new BrowserCaptureError("image-unreadable", "We couldn't process that photo. Please try again or choose a photo.");
    return response.blob();
  });
  if (!blob || blob.size < MIN_CAPTURE_BYTES) throw new BrowserCaptureError("invalid-capture", "We couldn't process that photo. Please try again or choose a photo.");
  const decoded = await decodeImage(blob);
  try {
    if (!decoded.width || !decoded.height) throw new BrowserCaptureError("invalid-capture", "We couldn't process that photo. Please try again or choose a photo.");
    const prepared = await prepareImage({ imageUrl: image?.imageUrl }, {
      fetchImpl: async () => ({ blob: async () => blob }),
      normalizeOrientation: (canvas) => selectBrowserLandscapeOrientation(canvas, TextDetector, documentRef),
      rectify: async ({ outlineCanvas, fullCanvas, mappedCrop }) => {
        try {
          const result = await rectifyCanvas(outlineCanvas, { output: { width: 500, height: 700 } });
          if (result?.detection?.found && result.canvas) return { canvas: result.canvas, diagnostics: result.detection };
          if (!mappedCrop && (!result?.canvas || result.canvas === fullCanvas || (result.canvas.width === fullCanvas.width && result.canvas.height === fullCanvas.height))) {
            const fallback = centeredCardFallback(fullCanvas, documentRef); if (fallback) return { canvas: fallback, diagnostics: { found: false, fallback: "centered-card-aspect" } };
          }
        } catch {}
        return null;
      },
    });
    const canvas = prepared.canvas;
    const detections = typeof TextDetector === "function" ? await new TextDetector().detect(canvas) : [];
    const blocks = detections.map((item) => ({ text: item.rawValue || "", boundingBox: item.boundingBox })).filter((item) => item.text);
    const text = blocks.map((item) => item.text).join("\n");
    const ocrMatch = rankCardMatches({ rawText: text, textBlocks: blocks, maxResults: 3 });
    // Frozen A is the production browser recognizer. The established local
    // matcher remains supporting evidence only and cannot hide model failures.
    const frozen = await frozenRecognizer(canvas, ocrMatch);
    let visualMatch;
    try { visualMatch = await visualMatcher(canvas, ocrMatch, { candidateLimit: 40, orbCandidateLimit: 20 }); } catch { visualMatch = null; }
    const frozenMatch = frozen.fusedMatch || fuseCardMatches(ocrMatch, visualMatch);
    const fusedMatch = applyFrozenAAcceptancePolicy({ frozenMatch, frozenCandidates: frozen.candidates, ocrMatch, geometry: { boundaryDiagnostics: prepared.boundaryDiagnostics }, diagnostics: Boolean(import.meta.env?.DEV) });
    return { text, blocks, ocrMatch, visualMatch, frozenA: frozen, fusedMatch };
  } finally {
    decoded.close();
  }
}
