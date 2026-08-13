import { Capacitor } from "@capacitor/core";

export function isNativeRuntime(capacitor = Capacitor) {
  try {
    return Boolean(capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

export function shouldSuppressBrowserAds(capacitor = Capacitor) {
  if (typeof capacitor?.isNativePlatform !== "function") return true;
  try {
    return Boolean(capacitor.isNativePlatform());
  } catch {
    // An unavailable bridge must never cause browser advertising to be enabled
    // inside an otherwise native WebView.
    return true;
  }
}

export function isAndroidNative(capacitor = Capacitor) {
  try {
    return Boolean(capacitor?.isNativePlatform?.()) && capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function isIosNative(capacitor = Capacitor) {
  try {
    return Boolean(capacitor?.isNativePlatform?.()) && capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

export function getScannerRuntime(capacitor = Capacitor) {
  return isAndroidNative(capacitor) ? "android-native" : "browser-wasm";
}
