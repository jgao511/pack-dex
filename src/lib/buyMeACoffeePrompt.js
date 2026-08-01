import { isBuyMeACoffeeEnabled } from "../config/support.js";

export const BUY_ME_A_COFFEE_PACK_THRESHOLD = 50;
export const BUY_ME_A_COFFEE_PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const BUY_ME_A_COFFEE_PROMPT_MAX_SHOWS = 2;
export const BUY_ME_A_COFFEE_GUEST_PACKS_KEY = "packdex_buy_me_a_coffee_guest_lifetime_packs_v1";

const PROMPT_STORAGE_KEY_PREFIX = "packdex_buy_me_a_coffee_prompt_v1";
const LEGACY_PROFILE_STATS_KEY = "packdex-profile-stats";

function getDefaultStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function safeReadJson(storage, key) {
  if (!storage?.getItem) return null;

  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function safeWriteJson(storage, key, value) {
  if (!storage?.setItem) return false;

  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function normalizeTimestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getPromptStorageKey(userId = "") {
  const scope = userId ? `user:${String(userId)}` : "guest";
  return `${PROMPT_STORAGE_KEY_PREFIX}:${scope}`;
}

export function readBuyMeACoffeePromptState({ userId = "", storage = getDefaultStorage() } = {}) {
  const value = safeReadJson(storage, getPromptStorageKey(userId));

  return {
    shownCount: Math.min(BUY_ME_A_COFFEE_PROMPT_MAX_SHOWS, toNonNegativeInteger(value?.shownCount)),
    lastShownAt: normalizeTimestamp(value?.lastShownAt),
    dismissedAt: normalizeTimestamp(value?.dismissedAt),
  };
}

export function claimBuyMeACoffeePrompt({
  packsOpened,
  userId = "",
  storage = getDefaultStorage(),
  now = Date.now(),
} = {}) {
  const completedPacks = toNonNegativeInteger(packsOpened);
  if (!isBuyMeACoffeeEnabled() || completedPacks < BUY_ME_A_COFFEE_PACK_THRESHOLD) {
    return { shouldShow: false, reason: "below_threshold" };
  }

  const state = readBuyMeACoffeePromptState({ userId, storage });
  if (state.shownCount >= BUY_ME_A_COFFEE_PROMPT_MAX_SHOWS) {
    return { shouldShow: false, reason: "maximum_reached", state };
  }

  if (
    state.shownCount > 0 &&
    (!state.dismissedAt || now - state.dismissedAt < BUY_ME_A_COFFEE_PROMPT_COOLDOWN_MS)
  ) {
    return { shouldShow: false, reason: "cooldown", state };
  }

  const nextState = {
    ...state,
    shownCount: state.shownCount + 1,
    lastShownAt: now,
  };
  safeWriteJson(storage, getPromptStorageKey(userId), nextState);

  return { shouldShow: true, reason: "eligible", state: nextState };
}

export function dismissBuyMeACoffeePrompt({
  userId = "",
  storage = getDefaultStorage(),
  now = Date.now(),
} = {}) {
  const state = readBuyMeACoffeePromptState({ userId, storage });
  const nextState = { ...state, dismissedAt: now };
  safeWriteJson(storage, getPromptStorageKey(userId), nextState);
  return nextState;
}

export function loadGuestLifetimePacks(storage = getDefaultStorage()) {
  if (!storage?.getItem) return 0;

  try {
    const current = toNonNegativeInteger(storage.getItem(BUY_ME_A_COFFEE_GUEST_PACKS_KEY));
    const legacy = safeReadJson(storage, LEGACY_PROFILE_STATS_KEY);
    return Math.max(current, toNonNegativeInteger(legacy?.packsOpened));
  } catch {
    return 0;
  }
}

export function recordGuestCompletedPack(storage = getDefaultStorage()) {
  const nextCount = loadGuestLifetimePacks(storage) + 1;

  try {
    storage?.setItem?.(BUY_ME_A_COFFEE_GUEST_PACKS_KEY, String(nextCount));
  } catch {
    // The completed pack remains usable when storage is unavailable.
  }

  return nextCount;
}
