import { getRarityVisualLevel } from "./rarityPresentation.js";

export const HAPTICS_SETTING_KEY = "packdex-mobile-haptics-enabled";

const PATTERNS = Object.freeze({
  rare: 18,
  double: 30,
  illustration: [16, 42, 16],
  major: [28, 38, 22, 38, 28],
  top: [38, 42, 28, 42, 38],
});

export function loadHapticsEnabled() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(HAPTICS_SETTING_KEY) !== "false";
}

export function saveHapticsEnabled(enabled) {
  if (typeof window !== "undefined") window.localStorage.setItem(HAPTICS_SETTING_KEY, String(Boolean(enabled)));
}

export function triggerRevealHaptic(card, set, enabled = true) {
  if (!enabled || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  const pattern = PATTERNS[getRarityVisualLevel(card, set)];
  if (!pattern) return false;
  try {
    return Boolean(navigator.vibrate(pattern));
  } catch {
    return false;
  }
}
