import { CARD_BACK_URL } from "./assetUrls.js";

const records = [];
const urlUses = new Map();
const renderStartKeys = new Set();

let startupPreloadRecord = null;

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeUrl(url) {
  if (!url) return "";

  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return String(url);
  }
}

function addUrlUse(label, url) {
  if (!import.meta.env.DEV || !url) return;

  const normalizedUrl = normalizeUrl(url);
  const labels = urlUses.get(normalizedUrl) || new Set();

  labels.add(label);
  urlUses.set(normalizedUrl, labels);

  if (/raw\.githubusercontent\.com/i.test(normalizedUrl)) {
    console.warn("[PackDex card back] Runtime card-back is using GitHub raw URL", {
      label,
      url,
      normalizedUrl,
    });
  }

  const uniqueUrls = Array.from(urlUses.keys());

  if (uniqueUrls.length > 1) {
    console.warn("[PackDex card back] Multiple card-back URLs detected", {
      urls: uniqueUrls,
      uses: Object.fromEntries(Array.from(urlUses.entries()).map(([key, value]) => [key, Array.from(value)])),
    });
  }
}

export function markCardBackPreloadStart(url = CARD_BACK_URL, detail = {}) {
  if (!import.meta.env.DEV) return;

  if ((detail.pending || detail.cached) && startupPreloadRecord) {
    addUrlUse("startup-preload", url);
    return;
  }

  startupPreloadRecord = {
    type: "startup-preload",
    url,
    normalizedUrl: normalizeUrl(url),
    startedAt: now(),
    finishedAt: null,
    durationMs: null,
    success: null,
    naturalWidth: null,
    naturalHeight: null,
  };

  records.push(startupPreloadRecord);
  addUrlUse("startup-preload", url);
  console.debug("[PackDex card back] Startup preload started", startupPreloadRecord);
}

export function markCardBackPreloadFinish(success, detail = {}) {
  if (!import.meta.env.DEV || !startupPreloadRecord) return;
  if (startupPreloadRecord.success !== null) return;

  const finishedAt = now();
  const img = detail.img;

  startupPreloadRecord.finishedAt = finishedAt;
  startupPreloadRecord.durationMs = Math.round(finishedAt - startupPreloadRecord.startedAt);
  startupPreloadRecord.success = Boolean(success);
  startupPreloadRecord.naturalWidth = img?.naturalWidth || null;
  startupPreloadRecord.naturalHeight = img?.naturalHeight || null;

  if (startupPreloadRecord.durationMs > 500) {
    console.warn("[PackDex card back] Startup preload took over 500ms", startupPreloadRecord);
  } else {
    console.debug("[PackDex card back] Startup preload finished", startupPreloadRecord);
  }
}

export function markIdleCardBackRenderStart(label, url = CARD_BACK_URL) {
  if (!import.meta.env.DEV) return;

  const key = `${label}:${normalizeUrl(url)}`;

  if (renderStartKeys.has(key)) return;

  renderStartKeys.add(key);
  addUrlUse(label, url);
  records.push({
    type: "idle-render-start",
    label,
    url,
    normalizedUrl: normalizeUrl(url),
    startedAt: now(),
  });
}

export function markIdleCardBackLoad(label, img, success = true) {
  if (!import.meta.env.DEV || !img) return;

  const loadedAt = now();
  const renderedSrc = img.currentSrc || img.src || "";
  const normalizedRenderedSrc = normalizeUrl(renderedSrc);
  const performanceEntries =
    typeof performance !== "undefined" && performance.getEntriesByName
      ? performance.getEntriesByName(normalizedRenderedSrc, "resource")
      : [];
  const latestEntry = performanceEntries.at(-1);
  const durationMs = latestEntry?.duration != null ? Math.round(latestEntry.duration) : null;

  const record = {
    type: "idle-rendered-image",
    label,
    expectedUrl: CARD_BACK_URL,
    normalizedExpectedUrl: normalizeUrl(CARD_BACK_URL),
    renderedSrc,
    normalizedRenderedSrc,
    loadedAt,
    durationMs,
    success: Boolean(success),
    naturalWidth: img.naturalWidth || null,
    naturalHeight: img.naturalHeight || null,
    transferSize: latestEntry?.transferSize,
    encodedBodySize: latestEntry?.encodedBodySize,
    decodedBodySize: latestEntry?.decodedBodySize,
  };

  records.push(record);
  addUrlUse(label, renderedSrc);
  console.debug("[PackDex card back] Idle card-back rendered src", record);

  if (durationMs != null && durationMs > 500) {
    console.warn("[PackDex card back] Idle card-back resource timing took over 500ms", record);
  }
}

export function getCardBackDebugRecords() {
  return {
    expectedCardBackUrl: CARD_BACK_URL,
    normalizedExpectedCardBackUrl: normalizeUrl(CARD_BACK_URL),
    records: records.map((record) => ({ ...record })),
    urlUses: Object.fromEntries(Array.from(urlUses.entries()).map(([key, value]) => [key, Array.from(value)])),
  };
}

if (typeof window !== "undefined" && import.meta.env.DEV) {
  window.__packdexCardBackDebug = getCardBackDebugRecords;
}
