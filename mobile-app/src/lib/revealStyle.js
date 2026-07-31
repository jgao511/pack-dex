export const REVEAL_STYLE_KEY = "packdex_reveal_style_v1";
export const DEFAULT_REVEAL_STYLE = "tap";
export const REVEAL_STYLES = Object.freeze(["automatic", "tap", "swipe"]);
export const TAP_DUPLICATE_GUARD_MS = 32;

export function normalizeRevealStyle(value) {
  return REVEAL_STYLES.includes(value) ? value : DEFAULT_REVEAL_STYLE;
}

export function loadRevealStyle(storage = globalThis.localStorage) {
  try {
    return normalizeRevealStyle(storage?.getItem?.(REVEAL_STYLE_KEY));
  } catch {
    return DEFAULT_REVEAL_STYLE;
  }
}

export function saveRevealStyle(value, storage = globalThis.localStorage) {
  const normalized = normalizeRevealStyle(value);
  try {
    storage?.setItem?.(REVEAL_STYLE_KEY, normalized);
  } catch {
    // A reveal preference should never prevent a pack from opening.
  }
  return normalized;
}

export function claimTapRevealInput(previousTimestamp, nextTimestamp) {
  const previous = Number(previousTimestamp);
  const next = Number(nextTimestamp);
  if (
    Number.isFinite(previous) &&
    Number.isFinite(next) &&
    next >= previous &&
    next - previous < TAP_DUPLICATE_GUARD_MS
  ) {
    return { accepted: false, timestamp: previous };
  }
  return { accepted: true, timestamp: Number.isFinite(next) ? next : Date.now() };
}

export function revealCardAtIndex(revealedIndexes, index, totalCards) {
  const current = revealedIndexes instanceof Set ? revealedIndexes : new Set(revealedIndexes || []);
  if (!Number.isInteger(index) || index < 0 || index >= totalCards || current.has(index)) {
    return { changed: false, revealedIndexes: current, isComplete: current.size >= totalCards };
  }

  const next = new Set(current);
  next.add(index);
  return { changed: true, revealedIndexes: next, isComplete: next.size >= totalCards };
}

export function getSwipeReleaseAction({
  deltaX = 0,
  deltaY = 0,
  elapsedMs = 1,
} = {}) {
  const x = Number(deltaX) || 0;
  const y = Number(deltaY) || 0;
  const elapsed = Math.max(1, Number(elapsedMs) || 1);
  const distance = Math.hypot(x, y);

  const horizontalVelocity = Math.abs(x) / elapsed;
  const upwardVelocity = Math.max(0, -y) / elapsed;
  const passedDistance = Math.abs(x) >= 90 || y <= -110;
  const passedVelocity = distance >= 36 && (horizontalVelocity >= 0.55 || upwardVelocity >= 0.55);
  if (!passedDistance && !passedVelocity) return { action: "reset" };

  const direction = y < -Math.abs(x) * 0.72 ? "up" : x < 0 ? "left" : "right";
  return { action: "dismiss", direction };
}

export function getSwipeTransform({ deltaX = 0, deltaY = 0, reducedMotion = false } = {}) {
  const x = Number(deltaX) || 0;
  const y = Math.min(70, Number(deltaY) || 0);
  if (reducedMotion) return `translate3d(${x}px, ${y}px, 0)`;

  const rotateZ = Math.max(-11, Math.min(11, x / 18));
  const rotateX = Math.max(-7, Math.min(7, -y / 24));
  const rotateY = Math.max(-8, Math.min(8, x / 22));
  const scale = Math.max(0.965, 1 - Math.min(0.035, Math.hypot(x, y) / 5000));
  return `translate3d(${x}px, ${y}px, 0) rotateZ(${rotateZ}deg) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
}
