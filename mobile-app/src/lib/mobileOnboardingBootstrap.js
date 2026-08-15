export const MOBILE_ONBOARDING_VERSION = 1;
export const MOBILE_ONBOARDING_VERSION_KEY = "packdex_mobile_onboarding_version";
export const MOBILE_ONBOARDING_STATE_KEY = "packdex_mobile_onboarding_state_v1";

function getStorage(storage = globalThis.localStorage) {
  try {
    return storage || null;
  } catch {
    return null;
  }
}
export function isMobileOnboardingComplete(storage = getStorage()) {
  return Number(storage?.getItem(MOBILE_ONBOARDING_VERSION_KEY) || 0) >= MOBILE_ONBOARDING_VERSION;
}

export function readMobileOnboardingBootstrapState(storage = getStorage()) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(MOBILE_ONBOARDING_STATE_KEY) || "null");
    return value?.version === MOBILE_ONBOARDING_VERSION ? value : null;
  } catch {
    return null;
  }
}

export function writeMobileOnboardingBootstrapState(state, storage = getStorage()) {
  if (!storage || !state) return;
  storage.setItem(MOBILE_ONBOARDING_STATE_KEY, JSON.stringify({
    ...state,
    version: MOBILE_ONBOARDING_VERSION,
    updatedAt: Date.now(),
  }));
}
