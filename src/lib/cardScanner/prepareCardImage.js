import { CardRecognitionError } from "./recognizeCardText.js";

export function getProportionalSize(width, height, maxEdge = 1800) {
  if (!(width > 0 && height > 0)) throw new CardRecognitionError("empty-image", "We couldn’t open that photo.");
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function stripDataUrlPrefix(value) { return String(value || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""); }

export async function prepareCardImage(image, { maxEdge = 1800, quality = .92, fetchImpl = fetch, createBitmap = createImageBitmap, createCanvas } = {}) {
  if (!image?.imageUrl) throw new CardRecognitionError("empty-image", "We couldn’t open that photo.");
  const response = await fetchImpl(image.imageUrl); const blob = await response.blob();
  const bitmap = await createBitmap(blob, { imageOrientation: "from-image" });
  const size = getProportionalSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = createCanvas ? createCanvas(size.width, size.height) : Object.assign(document.createElement("canvas"), size);
  canvas.width = size.width; canvas.height = size.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, size.width, size.height); bitmap.close?.();
  return { base64Image: stripDataUrlPrefix(canvas.toDataURL("image/jpeg", quality)), rotation: 0, width: size.width, height: size.height };
}
