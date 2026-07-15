import { createTemporaryImage } from "../../../src/lib/cardScanner/captureCardImage.js";
import { rankCardMatches } from "../../../src/lib/cardScanner/rankCardMatches.js";

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
  return stream;
}

export function stopBrowserCamera(video, stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
  if (video) video.srcObject = null;
}

export async function captureBrowserFrame(video) {
  if (!video?.videoWidth || !video?.videoHeight) throw new Error("The camera is still starting. Try again in a moment.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("We couldn't capture that frame. Please try again.");
  return createTemporaryImage(new File([blob], "card-scan.jpg", { type: "image/jpeg" }));
}

export async function recognizeBrowserImage(image) {
  const TextDetector = globalThis.TextDetector;
  if (typeof TextDetector !== "function") return { text: "", blocks: [], ocrMatch: rankCardMatches({}) };
  const blob = image?.file || await fetch(image?.imageUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(blob);
  try {
    const detector = new TextDetector();
    const detections = await detector.detect(bitmap);
    const blocks = detections.map((item) => ({ text: item.rawValue || "", boundingBox: item.boundingBox })).filter((item) => item.text);
    const text = blocks.map((item) => item.text).join("\n");
    return { text, blocks, ocrMatch: rankCardMatches({ rawText: text, textBlocks: blocks, maxResults: 3 }) };
  } finally {
    bitmap.close?.();
  }
}