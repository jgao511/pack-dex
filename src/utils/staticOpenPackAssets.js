import { CARD_BACK_URL, getSetLogoUrl } from "./assetUrls.js";
import { preloadImage } from "./imageCache.js";

const warmedStaticUrls = new Set();
const queuedStaticUrls = new Set();
const staticStats = {
  requested: 0,
  loaded: 0,
  failed: 0,
  skippedDuplicate: 0,
  cardBackPreloads: 0,
  logoPreloads: 0,
  remoteLogoUrls: 0,
};

let idleHandle = null;
let timeoutHandle = null;

function normalizeUrl(url) {
  if (!url) return "";

  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return String(url);
  }
}

function isLocalPublicUrl(url) {
  if (!url || typeof window === "undefined") return false;

  const normalizedUrl = normalizeUrl(url);

  return normalizedUrl.startsWith(window.location.origin);
}

function rememberStaticUrl(url, type) {
  if (!url) return false;

  if (warmedStaticUrls.has(url) || queuedStaticUrls.has(url)) {
    staticStats.skippedDuplicate += 1;
    return false;
  }

  queuedStaticUrls.add(url);
  staticStats.requested += 1;

  if (type === "card-back") staticStats.cardBackPreloads += 1;
  if (type === "logo") staticStats.logoPreloads += 1;
  if (type === "logo" && /^https?:\/\//i.test(url)) staticStats.remoteLogoUrls += 1;

  return true;
}

function markSettled(url, success) {
  queuedStaticUrls.delete(url);
  warmedStaticUrls.add(url);

  if (success) {
    staticStats.loaded += 1;
  } else {
    staticStats.failed += 1;
  }
}

function preloadStaticUrl(url, type) {
  if (typeof window === "undefined" || !rememberStaticUrl(url, type)) return;

  const startedAt = performance.now();

  preloadImage(url, {
    timeoutMs: 0,
    onLoad: (detail) => {
      markSettled(url, true);

      if (import.meta.env.DEV) {
        const durationMs = Math.round(performance.now() - startedAt);

        if (durationMs > 500) {
          console.warn("[PackDex static assets] Slow static image preload", {
            type,
            url,
            durationMs,
            naturalWidth: detail?.img?.naturalWidth || null,
            naturalHeight: detail?.img?.naturalHeight || null,
          });
        }
      }
    },
    onError: () => markSettled(url, false),
  });
}

function scheduleIdle(callback) {
  if (typeof window === "undefined" || idleHandle || timeoutHandle) return;

  const run = () => {
    idleHandle = null;
    timeoutHandle = null;

    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    callback();
  };

  if ("requestIdleCallback" in window) {
    idleHandle = window.requestIdleCallback(run, { timeout: 2000 });
    return;
  }

  timeoutHandle = window.setTimeout(run, 900);
}

function uniqueLogoUrls(sets) {
  return Array.from(new Set((sets || []).map((set) => getSetLogoUrl(set)).filter(Boolean)));
}

export function preloadStaticOpenPackAssets(prioritySets = [], options = {}) {
  if (typeof window === "undefined") return;

  const immediateLogoLimit = options.immediateLogoLimit ?? 10;
  const idleLogoLimit = options.idleLogoLimit ?? 24;
  const additionalSets = options.additionalSets || [];
  const priorityLogoUrls = uniqueLogoUrls(prioritySets);
  const additionalLogoUrls = uniqueLogoUrls(additionalSets).filter((url) => !priorityLogoUrls.includes(url));

  preloadStaticUrl(CARD_BACK_URL, "card-back");
  priorityLogoUrls.slice(0, immediateLogoLimit).forEach((url) => preloadStaticUrl(url, "logo"));

  scheduleIdle(() => {
    additionalLogoUrls.slice(0, idleLogoLimit).forEach((url) => preloadStaticUrl(url, "logo"));
  });
}

export function getStaticOpenPackAssetDebug() {
  return {
    cardBackUrl: CARD_BACK_URL,
    normalizedCardBackUrl: normalizeUrl(CARD_BACK_URL),
    cardBackIsLocalPublic: isLocalPublicUrl(CARD_BACK_URL),
    queuedCount: queuedStaticUrls.size,
    warmedCount: warmedStaticUrls.size,
    warmedUrls: Array.from(warmedStaticUrls),
    queuedUrls: Array.from(queuedStaticUrls),
    stats: { ...staticStats },
  };
}

if (typeof window !== "undefined" && import.meta.env.DEV) {
  window.__packdexStaticImageDebug = getStaticOpenPackAssetDebug;
}
