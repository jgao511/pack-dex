import { normalizeRevealStyle } from "./revealStyle.js";

export const CANONICAL_PHONE_REVEAL_QUERY = "(max-width: 720px)";

export function isCanonicalPhoneRevealViewport(viewport = globalThis.window) {
  if (!viewport) return false;
  const mediaMatch = viewport.matchMedia?.(CANONICAL_PHONE_REVEAL_QUERY)?.matches;
  if (typeof mediaMatch === "boolean") return mediaMatch;
  return Number(viewport.innerWidth) <= 720;
}

export function createCanonicalRevealSession({
  phoneViewport = false,
  preferredStyle = "tap",
  sequence = 0,
} = {}) {
  return Object.freeze({
    sequence: Number(sequence) || 0,
    interactionSurface: phoneViewport ? "phone" : "desktop",
    revealStyle: phoneViewport ? normalizeRevealStyle(preferredStyle) : "automatic",
  });
}
