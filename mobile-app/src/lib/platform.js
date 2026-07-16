import { Capacitor } from "@capacitor/core";

export function isAndroidNative(capacitor = Capacitor) {
  return capacitor.isNativePlatform() && capacitor.getPlatform() === "android";
}

export function isIosNative(capacitor = Capacitor) {
  return capacitor.isNativePlatform() && capacitor.getPlatform() === "ios";
}

export function getScannerRuntime(capacitor = Capacitor) {
  return isAndroidNative(capacitor) ? "android-native" : "browser-wasm";
}
