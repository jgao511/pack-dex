import { Capacitor } from "@capacitor/core";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";
import { App } from "@capacitor/app";
import { CapacitorPluginMlKitTextRecognition } from "@pantrist/capacitor-plugin-ml-kit-text-recognition";
import { CardCaptureError } from "../../../src/lib/cardScanner/captureCardImage.js";
import { prepareCardImage } from "../../../src/lib/cardScanner/prepareCardImage.js";

function permissionStatus(value) { if (value === "granted" || value === "limited") return "granted"; if (value === "denied") return "permanentlyDenied"; return "denied"; }
function photoToTemporaryImage(photo) {
  const imageUrl = photo?.webPath || (photo?.path ? Capacitor.convertFileSrc(photo.path) : "");
  if (!imageUrl) throw new CardCaptureError("malformed-result", "We couldn’t open that photo. Please try another one.");
  let released = false; return { imageUrl, nativePath: photo.path || null, format: photo.format || null, release() { released = true; this.nativePath = null; this.imageUrl = ""; } };
}
function isCancellation(error) { return /cancel|user cancelled|user canceled/i.test(String(error?.message || error || "")); }

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
    return { text: results.map((pass) => pass.text).filter(Boolean).join("\n"), blocks: results.flatMap((pass) => pass.blocks.map((block) => ({ ...block, sourcePass: pass.label }))), passes: results, imageDiagnostics: { originalWidth: working.originalWidth, originalHeight: working.originalHeight, preparedWidth: working.width, preparedHeight: working.height, detectedOrientation: working.detectedOrientation, rotationApplied: working.rotationApplied } };
  },
};
