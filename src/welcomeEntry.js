export const WELCOME_SEEN_KEY = "packdex_welcome_seen_v1";
export const DESKTOP_MOBILE_NOTICE_DISMISSED_KEY = "packdex_desktop_mobile_notice_dismissed_v1";

export function normalizeEntryPath(pathname = "/") {
  const path = String(pathname || "/");
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function readStorageFlag(key, host = globalThis) {
  try {
    return host?.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeStorageFlag(key, host = globalThis) {
  try {
    host?.localStorage?.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

export function isLikelyMobileVisitor({
  userAgent = "",
  userAgentMobile = false,
  coarsePointer = false,
  viewportWidth = Number.POSITIVE_INFINITY,
} = {}) {
  if (userAgentMobile) return true;
  if (/Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(String(userAgent))) return true;
  return Boolean(coarsePointer && Number(viewportWidth) <= 900);
}

export function getWelcomeEntryDecision({
  pathname = "/",
  search = "",
  isMobile = false,
  storageHost = globalThis,
} = {}) {
  const path = normalizeEntryPath(pathname);

  if (path === "/welcome") return "welcome";
  if (path !== "/") return "desktop-app";

  const forceDesktop = new URLSearchParams(String(search)).get("desktop") === "1";
  if (forceDesktop) return "desktop-app";

  if (!readStorageFlag(WELCOME_SEEN_KEY, storageHost)) return "welcome";
  return isMobile ? "mobile-app" : "desktop-app";
}

export function markWelcomeSeen(host = globalThis) {
  return writeStorageFlag(WELCOME_SEEN_KEY, host);
}

export function dismissDesktopMobileNotice(host = globalThis) {
  return writeStorageFlag(DESKTOP_MOBILE_NOTICE_DISMISSED_KEY, host);
}
