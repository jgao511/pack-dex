const MOBILE_TABS = new Set(["open", "collection", "explore", "profile"]);
const NATIVE_ONBOARDING_COMPLETE_PATH = "/?tab=profile";

export function getInitialMobileTab(location = globalThis.location) {
  const path = String(location?.pathname || "");
  if (path.includes("/explore")) return "explore";

  const requestedTab = new URLSearchParams(String(location?.search || "")).get("tab");
  return MOBILE_TABS.has(requestedTab) ? requestedTab : "open";
}

export function consumeOnboardingCompleteParam({
  location = globalThis.location,
  history = globalThis.history,
  title = globalThis.document?.title || "",
} = {}) {
  const url = new URL(location?.href || "https://www.pack-dex.com/mobile-app/");
  if (url.searchParams.get("onboardingComplete") !== "1") return false;

  url.searchParams.delete("onboardingComplete");
  history?.replaceState?.({}, title, `${url.pathname}${url.search}${url.hash}`);
  return true;
}

export function getMobileTabPath(tab) {
  return tab === "profile" ? "/mobile-app/?tab=profile" : "/mobile-app/";
}

export function navigateAfterMobileOnboarding({
  destination = "/mobile-app/?tab=profile",
  native = false,
  location = globalThis.location,
  history = globalThis.history,
  title = globalThis.document?.title || "",
} = {}) {
  if (native) {
    // Capacitor serves the bundled app from its root. Reloading the website's
    // /mobile-app/ route makes relative JS and image assets resolve beneath a
    // directory that does not exist in the native bundle, leaving only the
    // static startup shell on screen.
    history?.replaceState?.({}, title, NATIVE_ONBOARDING_COMPLETE_PATH);
    return NATIVE_ONBOARDING_COMPLETE_PATH;
  }

  location?.replace?.(destination);
  return destination;
}
