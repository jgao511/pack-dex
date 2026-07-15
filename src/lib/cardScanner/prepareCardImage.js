import { CardRecognitionError } from "./recognizeCardText.js";
import { mapPreviewOutlineToCapture } from "./mapPreviewCrop.js";

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
    { label: "collector-bottom-edge", x: 0, y: Math.round(height * .84), width, height: Math.round(height * .16), scale: 3, enhance: true },
  ];
}

export function createOcrPasses(canvas, { quality = .92, createCanvas, labels = null } = {}) {
  const selectedLabels = labels ? new Set(labels) : null;
  return getOcrCropDefinitions(canvas.width, canvas.height).filter((crop) => !selectedLabels || selectedLabels.has(crop.label)).map((crop) => {
    const out = canvasFactory(Math.round(crop.width * crop.scale), Math.round(crop.height * crop.scale), createCanvas);
    const context = out.getContext("2d"); if (crop.enhance) context.filter = "grayscale(1) contrast(1.45)";
    context.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
    const width = out.width; const height = out.height; const base64Image = stripDataUrlPrefix(out.toDataURL("image/jpeg", quality));
    out.width = 0; out.height = 0;
    return { label: crop.label, width, height, base64Image, rotation: 0 };
  });
}

export async function prepareCardImage(image, { maxEdge = 1800, quality = .92, fetchImpl = fetch, createBitmap = createImageBitmap, createCanvas, rectify, includePasses = true, normalizeOrientation } = {}) {
  if (!image?.imageUrl) throw new CardRecognitionError("empty-image", "We couldn’t open that photo.");
  const started = performance.now();
  const response = await fetchImpl(image.imageUrl); const blob = await response.blob();
  const blobReady = performance.now();
  // Browser File/Blob inputs can retain EXIF orientation even when native
  // camera captures have already normalized it. `from-image` rotates only
  // when metadata requires it, so portrait pixels reach proposals in both
  // paths without changing already-corrected captures.
  const bitmap = await createBitmap(blob, { imageOrientation: "from-image" });
  const bitmapReady = performance.now();
  const originalWidth = bitmap.width; const originalHeight = bitmap.height;
  const mappedCrop = image.previewGeometry ? mapPreviewOutlineToCapture({ ...image.previewGeometry, captureWidth: originalWidth, captureHeight: originalHeight }) : null;
  const source = mappedCrop || { x: 0, y: 0, width: originalWidth, height: originalHeight };
  const fullSize = getProportionalSize(originalWidth, originalHeight, maxEdge);
  const fullCanvas = canvasFactory(fullSize.width, fullSize.height, createCanvas);
  fullCanvas.getContext("2d").drawImage(bitmap, 0, 0, originalWidth, originalHeight, 0, 0, fullSize.width, fullSize.height);
  // EXIF orientation has already been applied above. Gallery captures can
  // still contain sideways pixels; resolve that before boundary detection,
  // OCR, and embedding so every downstream scanner stage sees one canvas.
  const orientation = !mappedCrop && normalizeOrientation ? await normalizeOrientation(fullCanvas) : null;
  const orientedFullCanvas = orientation?.canvas || fullCanvas;
  const size = getProportionalSize(source.width, source.height, maxEdge);
  const outlineCanvas = mappedCrop ? canvasFactory(size.width, size.height, createCanvas) : orientedFullCanvas;
  if (mappedCrop) outlineCanvas.getContext("2d").drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, size.width, size.height);
  const canvasesReady = performance.now();
  let rectification = null;
  if (rectify) rectification = await rectify({ outlineCanvas, fullCanvas: orientedFullCanvas, mappedCrop, originalWidth, originalHeight });
  const rectificationReady = performance.now();
  const canvas = rectification?.canvas || (mappedCrop ? outlineCanvas : orientedFullCanvas);
  const passes = includePasses ? createOcrPasses(canvas, { quality, createCanvas }) : [];
  if (includePasses && (mappedCrop || rectification?.canvas)) {
    const fallbackPasses = createOcrPasses(orientedFullCanvas, { quality, createCanvas }).filter((pass) => pass.label === "full-card" || pass.label === "collector-bottom-edge");
    for (const pass of fallbackPasses) passes.push({ ...pass, label: pass.label === "full-card" ? "full-capture-fallback" : "full-capture-bottom-edge" });
  }
  bitmap.close?.();
  const bottomPass = passes.find((pass) => pass.label === "collector-bottom-edge");
  // Reuse identical diagnostic encodes. Choose Photo commonly uses the same
  // canvas for all three values, and encoding it repeatedly is pure overhead.
  const previewStarted = performance.now();
  const encodedCanvases = new Map();
  const encode = (target) => {
    if (!encodedCanvases.has(target)) encodedCanvases.set(target, target.toDataURL("image/jpeg", quality));
    return encodedCanvases.get(target);
  };
  const previewUrl = encode(canvas);
  const originalPreviewUrl = encode(orientedFullCanvas);
  const outlinePreviewUrl = encode(outlineCanvas);
  const finished = performance.now();
  return {
    canvas, proposals: rectification?.proposals || null,
    previewUrl, originalPreviewUrl, outlinePreviewUrl,
    bottomPreviewUrl: bottomPass ? `data:image/jpeg;base64,${bottomPass.base64Image}` : null,
    passes, originalWidth, originalHeight, width: canvas.width, height: canvas.height,
    mappedCrop, boundaryDiagnostics: rectification?.diagnostics || null,
    detectedOrientation: canvas.height >= canvas.width ? "portrait" : "landscape", rotationApplied: orientation?.rotationApplied || 0,
    orientationDiagnostics: orientation?.diagnostics || null,
    timing: {
      totalMs: finished - started,
      fetchBlobMs: blobReady - started,
      blobBytes: blob.size,
      bitmapDecodeMs: bitmapReady - blobReady,
      canvasDrawMs: canvasesReady - bitmapReady,
      rectificationMs: rectificationReady - canvasesReady,
      previewEncodeMs: finished - previewStarted,
      previewEncodeCount: encodedCanvases.size,
    },
  };
}
