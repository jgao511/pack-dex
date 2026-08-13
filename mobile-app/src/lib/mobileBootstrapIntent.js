export const MOBILE_BOOTSTRAP_SET_EVENT = "packdex:mobile-bootstrap-set";
export const MOBILE_BOOTSTRAP_ONBOARDING_EVENT = "packdex:mobile-bootstrap-onboarding";

function dispatchBootstrapEvent(windowRef, eventName, detail) {
  const CustomEventConstructor = windowRef?.CustomEvent || globalThis.CustomEvent;
  if (!windowRef?.dispatchEvent || !CustomEventConstructor) return;
  windowRef.dispatchEvent(new CustomEventConstructor(eventName, { detail }));
}

export function setPendingMobileBootstrapSetId(setId, windowRef = globalThis.window) {
  if (!windowRef) return "";
  const normalized = String(setId || "").trim();
  const changed = windowRef.__packdexPendingMobileSetId !== normalized;
  windowRef.__packdexPendingMobileSetId = normalized;
  if (normalized && changed) dispatchBootstrapEvent(windowRef, MOBILE_BOOTSTRAP_SET_EVENT, { setId: normalized });
  return normalized;
}

export function claimMobileBootstrapSetIntent(setId, windowRef = globalThis.window) {
  if (!windowRef) return "";
  const normalized = String(setId || "").trim();
  if (!normalized) return "";
  const currentPending = String(windowRef.__packdexPendingMobileSetId || "").trim();
  if (currentPending !== normalized) {
    const startedAt = windowRef.performance?.now?.() ?? Date.now();
    windowRef.__packdexPerformance = {
      ...(windowRef.__packdexPerformance || {}),
      mobileSetTapStart: startedAt,
      mobileSetId: normalized,
    };
    if (windowRef.document?.documentElement?.dataset) {
      windowRef.document.documentElement.dataset.packdexMobileSetTapStart = String(startedAt);
    }
    windowRef.performance?.mark?.("packdex-mobile-set-tap-start");
  }
  return setPendingMobileBootstrapSetId(normalized, windowRef);
}

export function consumePendingMobileBootstrapSetId(windowRef = globalThis.window) {
  if (!windowRef) return "";
  const normalized = String(windowRef.__packdexPendingMobileSetId || "").trim();
  windowRef.__packdexPendingMobileSetId = "";
  return normalized;
}

export function setPendingMobileBootstrapTab(tab, windowRef = globalThis.window) {
  if (!windowRef) return "";
  const normalized = String(tab || "").trim();
  windowRef.__packdexPendingMobileTab = normalized;
  return normalized;
}

export function consumePendingMobileBootstrapTab(windowRef = globalThis.window) {
  if (!windowRef) return "";
  const normalized = String(windowRef.__packdexPendingMobileTab || "").trim();
  windowRef.__packdexPendingMobileTab = "";
  return normalized;
}

export function setPendingMobileBootstrapCollectionSetId(setId, windowRef = globalThis.window) {
  if (!windowRef) return "";
  const normalized = String(setId || "").trim();
  windowRef.__packdexPendingMobileCollectionSetId = normalized;
  return normalized;
}

export function consumePendingMobileBootstrapCollectionSetId(windowRef = globalThis.window) {
  if (!windowRef) return "";
  const normalized = String(windowRef.__packdexPendingMobileCollectionSetId || "").trim();
  windowRef.__packdexPendingMobileCollectionSetId = "";
  return normalized;
}

export function setPendingMobileBootstrapOpenRequested(requested = true, windowRef = globalThis.window) {
  if (!windowRef) return false;
  windowRef.__packdexPendingMobileOpenRequested = requested === true;
  return windowRef.__packdexPendingMobileOpenRequested;
}

export function consumePendingMobileBootstrapOpenRequested(windowRef = globalThis.window) {
  if (!windowRef) return false;
  const requested = windowRef.__packdexPendingMobileOpenRequested === true;
  windowRef.__packdexPendingMobileOpenRequested = false;
  return requested;
}

export function setPendingMobileBootstrapOnboardingAction(action, setId = "", windowRef = globalThis.window) {
  if (!windowRef) return null;
  const intent = { action: String(action || "").trim(), setId: String(setId || "").trim() };
  windowRef.__packdexPendingMobileOnboarding = intent;
  dispatchBootstrapEvent(windowRef, MOBILE_BOOTSTRAP_ONBOARDING_EVENT, intent);
  return intent;
}

export function consumePendingMobileBootstrapOnboardingAction(windowRef = globalThis.window) {
  if (!windowRef) return null;
  const intent = windowRef.__packdexPendingMobileOnboarding || null;
  windowRef.__packdexPendingMobileOnboarding = null;
  return intent;
}
