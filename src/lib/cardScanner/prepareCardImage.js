import { CardRecognitionError } from "./recognizeCardText.js";

export function getProportionalSize(width, height, maxEdge = 1800) {
  if (!(width > 0 && height > 0)) throw new CardRecognitionError("empty-image", "We couldn’t open that photo.");
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function stripDataUrlPrefix(value) { return String(value || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""); }

function canvasFactory(width, height, createCanvas) { const canvas = createCanvas ? createCanvas(width, height) : document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas; }

export function getOcrCropDefinitions(width, height) {
  return [
    { label: "full-card", x: 0, y: 0, width, height, scale: 1, enhance: false },
    { label: "name-top", x: 0, y: 0, width, height: Math.round(height * .27), scale: 2, enhance: false },
    { label: "collector-bottom", x: 0, y: Math.round(height * .76), width, height: Math.round(height * .24), scale: 2.5, enhance: true },
    { label: "collector-bottom-left", x: 0, y: Math.round(height * .76), width: Math.round(width * .62), height: Math.round(height * .24), scale: 2.5, enhance: true },
    { label: "collector-bottom-right", x: Math.round(width * .38), y: Math.round(height * .76), width: Math.round(width * .62), height: Math.round(height * .24), scale: 2.5, enhance: true },
  ];
}

export function createOcrPasses(canvas, { quality = .92, createCanvas } = {}) {
  return getOcrCropDefinitions(canvas.width, canvas.height).map((crop) => {
    const out = canvasFactory(Math.round(crop.width * crop.scale), Math.round(crop.height * crop.scale), createCanvas);
    const context = out.getContext("2d"); if (crop.enhance) context.filter = "grayscale(1) contrast(1.45)";
    context.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
    return { label: crop.label, width: out.width, height: out.height, base64Image: stripDataUrlPrefix(out.toDataURL("image/jpeg", quality)), rotation: 0 };
  });
}

export async function prepareCardImage(image, { maxEdge = 1800, quality = .92, fetchImpl = fetch, createBitmap = createImageBitmap, createCanvas } = {}) {
  if (!image?.imageUrl) throw new CardRecognitionError("empty-image", "We couldn’t open that photo.");
  const response = await fetchImpl(image.imageUrl); const blob = await response.blob();
  // Capacitor Camera returns corrected pixels; do not apply EXIF a second time.
  const bitmap = await createBitmap(blob, { imageOrientation: "none" });
  const originalWidth = bitmap.width; const originalHeight = bitmap.height;
  const size = getProportionalSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = canvasFactory(size.width, size.height, createCanvas);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, size.width, size.height); bitmap.close?.();
  return { canvas, passes: createOcrPasses(canvas, { quality, createCanvas }), originalWidth, originalHeight, width: size.width, height: size.height, detectedOrientation: size.height >= size.width ? "portrait" : "landscape", rotationApplied: 0 };
}
