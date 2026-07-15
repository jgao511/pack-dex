import { createTemporaryImage } from "../../../src/lib/cardScanner/captureCardImage.js";
import { fuseCardMatches } from "../../../src/lib/cardScanner/fuseCardMatches.js";
import { runVisualMatching } from "../../../src/lib/cardScanner/localVisual/runVisualMatching.js";
import { rankCardMatches } from "../../../src/lib/cardScanner/rankCardMatches.js";

const MIN_CAPTURE_BYTES = 1024;

export class BrowserCaptureError extends Error {
  constructor(code, message) { super(message); this.name = "BrowserCaptureError"; this.code = code; }
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

export async function recognizeBrowserImage(image, { decodeImage = decodeBrowserImage, documentRef = document, TextDetector = globalThis.TextDetector, visualMatcher = runVisualMatching } = {}) {
  const blob = image?.file || await fetch(image?.imageUrl).then((response) => {
    if (!response.ok) throw new BrowserCaptureError("image-unreadable", "We couldn't process that photo. Please try again or choose a photo.");
    return response.blob();
  });
  if (!blob || blob.size < MIN_CAPTURE_BYTES) throw new BrowserCaptureError("invalid-capture", "We couldn't process that photo. Please try again or choose a photo.");
  const decoded = await decodeImage(blob);
  try {
    if (!decoded.width || !decoded.height) throw new BrowserCaptureError("invalid-capture", "We couldn't process that photo. Please try again or choose a photo.");
    const canvas = documentRef.createElement("canvas"); canvas.width = decoded.width; canvas.height = decoded.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new BrowserCaptureError("canvas-unavailable", "We couldn't process that photo. Please try again or choose a photo.");
    context.drawImage(decoded.source, 0, 0);
    const detections = typeof TextDetector === "function" ? await new TextDetector().detect(decoded.source) : [];
    const blocks = detections.map((item) => ({ text: item.rawValue || "", boundingBox: item.boundingBox })).filter((item) => item.text);
    const text = blocks.map((item) => item.text).join("\n");
    const ocrMatch = rankCardMatches({ rawText: text, textBlocks: blocks, maxResults: 3 });
    const visualMatch = await visualMatcher(canvas, ocrMatch, { candidateLimit: 40, orbCandidateLimit: 20 });
    return { text, blocks, ocrMatch, visualMatch, fusedMatch: fuseCardMatches(ocrMatch, visualMatch) };
  } finally {
    decoded.close();
  }
}
