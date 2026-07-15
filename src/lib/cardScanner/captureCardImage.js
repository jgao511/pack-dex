export class CardCaptureError extends Error {
  constructor(code, message) { super(message); this.name = "CardCaptureError"; this.code = code; }
}

const MAX_BROWSER_IMAGE_BYTES = 25 * 1024 * 1024;

export function validateBrowserImageFile(file) {
  if (!file || typeof file !== "object") throw new CardCaptureError("cancelled", "Photo selection was cancelled.");
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || "")) throw new CardCaptureError("unsupported-file", "Choose a JPEG, PNG, WebP, HEIC, or HEIF image.");
  if (!Number.isFinite(file.size) || file.size < 1) throw new CardCaptureError("invalid-file", "That photo is empty or invalid. Please choose another one.");
  if (file.size > MAX_BROWSER_IMAGE_BYTES) throw new CardCaptureError("file-too-large", "That photo is too large to scan safely. Please choose a smaller image.");
  return file;
}

export function getBrowserFileInputOptions(source = "library") {
  return { accept: "image/*", capture: source === "camera" ? "environment" : undefined };
}

export function createTemporaryImage(file, urlApi = URL) {
  if (!file) throw new CardCaptureError("cancelled", "Photo selection was cancelled.");
  const imageUrl = urlApi.createObjectURL(file);
  let released = false;
  return { file, imageUrl, release() { if (!released) { released = true; urlApi.revokeObjectURL(imageUrl); } } };
}

export async function captureCardImage({ source = "camera", nativeAdapter, selectBrowserFile, urlApi = URL } = {}) {
  if (nativeAdapter?.isAvailable?.()) {
    if (source === "camera") {
      let permission = await nativeAdapter.checkPermission?.();
      if (permission !== "granted") permission = await nativeAdapter.requestPermission?.();
      if (permission === "permanentlyDenied") throw new CardCaptureError("permission-permanently-denied", "Camera access is blocked. Enable it in device settings, then try again.");
      if (permission !== "granted") throw new CardCaptureError("permission-denied", "Camera access wasn’t available. You can choose a photo instead.");
    }
    const result = await nativeAdapter.capture({ source, saveToGallery: false });
    if (!result) throw new CardCaptureError("cancelled", "Card scan was cancelled.");
    if (!result.imageUrl) throw new CardCaptureError("malformed-result", "We couldn’t open that photo. Please try another one.");
    return result;
  }
  if (!selectBrowserFile) throw new CardCaptureError("unavailable", "Camera capture is unavailable here. Choose a photo instead.");
  const file = validateBrowserImageFile(await selectBrowserFile(getBrowserFileInputOptions(source)));
  return createTemporaryImage(file, urlApi);
}
