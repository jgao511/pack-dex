const MOBILE_TABS = new Set(["open", "collection", "explore", "profile"]);

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
