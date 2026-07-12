export class CardCaptureError extends Error {
  constructor(code, message) { super(message); this.name = "CardCaptureError"; this.code = code; }
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
  const file = await selectBrowserFile(getBrowserFileInputOptions(source));
  return createTemporaryImage(file, urlApi);
}
