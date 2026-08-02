import { PACKDEX_CLIENT_BUILD } from "./packPersistenceVersion.js";

export const PACKDEX_CLIENT_VERSION = PACKDEX_CLIENT_BUILD;
const RELOAD_MARKER_PREFIX = "packdex-sw-reloaded:";

export function shouldReloadForServiceWorkerVersion({
  announcedVersion = "",
  clientVersion = PACKDEX_CLIENT_VERSION,
  reloadedVersion = "",
} = {}) {
  return Boolean(
    announcedVersion &&
    announcedVersion !== clientVersion &&
    reloadedVersion !== announcedVersion
  );
}

export async function registerPackDexServiceWorker({
  navigatorHost = typeof navigator === "undefined" ? null : navigator,
  locationHost = typeof window === "undefined" ? null : window.location,
  sessionStorageHost = typeof window === "undefined" ? null : window.sessionStorage,
} = {}) {
  if (!navigatorHost?.serviceWorker || !locationHost) return null;

  const reloadForVersion = (announcedVersion) => {
    const marker = `${RELOAD_MARKER_PREFIX}${announcedVersion}`;
    const reloadedVersion = sessionStorageHost?.getItem(marker) ? announcedVersion : "";
    if (!shouldReloadForServiceWorkerVersion({ announcedVersion, reloadedVersion })) return;
    sessionStorageHost?.setItem(marker, "1");
    locationHost.reload();
  };

  navigatorHost.serviceWorker.addEventListener("message", (event) => {
    if (event?.data?.type !== "PACKDEX_SW_ACTIVATED") return;
    reloadForVersion(String(event.data.version || ""));
  });

  const registration = await navigatorHost.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });

  const activateWaitingWorker = (worker) => {
    if (worker?.state === "installed") worker.postMessage({ type: "PACKDEX_SKIP_WAITING" });
  };
  registration.addEventListener?.("updatefound", () => {
    registration.installing?.addEventListener("statechange", () => {
      activateWaitingWorker(registration.installing);
    });
  });
  activateWaitingWorker(registration.waiting);
  registration.update?.().catch(() => {});
  return registration;
}
