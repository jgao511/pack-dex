import { Capacitor } from "@capacitor/core";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";
import { CameraPreview } from "@capacitor-community/camera-preview";
import { App } from "@capacitor/app";
import { CapacitorPluginMlKitTextRecognition } from "@pantrist/capacitor-plugin-ml-kit-text-recognition";
import { CardCaptureError } from "../../../src/lib/cardScanner/captureCardImage.js";
import { getOcrCropDefinitions, prepareCardImage } from "../../../src/lib/cardScanner/prepareCardImage.js";

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
    const working = await prepareCardImage(image);
    const results = [];
    for (const pass of working.passes) {
      try { const result = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image: pass.base64Image, rotation: 0 }); results.push({ label: pass.label, width: pass.width, height: pass.height, text: result.text || "", blocks: result.blocks || [] }); }
      finally { pass.base64Image = ""; }
    }
    return { text: results.map((pass) => pass.text).filter(Boolean).join("\n"), blocks: results.flatMap((pass) => pass.blocks.map((block) => ({ ...block, sourcePass: pass.label }))), passes: results, previewUrl: working.previewUrl, bottomPreviewUrl: working.bottomPreviewUrl, imageDiagnostics: { originalWidth: working.originalWidth, originalHeight: working.originalHeight, preparedWidth: working.width, preparedHeight: working.height, mappedCrop: working.mappedCrop, previewGeometry: image.previewGeometry || null, bottomCrop: getOcrCropDefinitions(working.width, working.height).find((crop) => crop.label === "collector-bottom-edge"), detectedOrientation: working.detectedOrientation, rotationApplied: working.rotationApplied } };
  },
};
