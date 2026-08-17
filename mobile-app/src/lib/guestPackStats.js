export const GUEST_LIFETIME_PACKS_KEY = "packdex_guest_lifetime_packs_v1";

const LEGACY_PROFILE_STATS_KEY = "packdex-profile-stats";

function getDefaultStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function readLegacyPackCount(storage) {
  try {
    const value = JSON.parse(storage?.getItem?.(LEGACY_PROFILE_STATS_KEY) || "null");
    return toNonNegativeInteger(value?.packsOpened);
  } catch {
    return 0;
  }
}

export function loadGuestLifetimePacks(storage = getDefaultStorage()) {
  if (!storage?.getItem) return 0;

  try {
    const current = toNonNegativeInteger(storage.getItem(GUEST_LIFETIME_PACKS_KEY));
    return Math.max(current, readLegacyPackCount(storage));
  } catch {
    return 0;
  }
}

export function recordGuestCompletedPack(storage = getDefaultStorage()) {
  const nextCount = loadGuestLifetimePacks(storage) + 1;

  try {
    storage?.setItem?.(GUEST_LIFETIME_PACKS_KEY, String(nextCount));
  } catch {
    // The completed pack remains usable when storage is unavailable.
  }

  return nextCount;
}
