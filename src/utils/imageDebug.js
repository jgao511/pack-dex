import { getCardImageUrl } from "./assetUrls.js";
import { getDisplayCardName, getDisplayRarity } from "./packGenerator.js";

const SLOW_IMAGE_MS = 1000;
const VERY_SLOW_IMAGE_MS = 2500;
const isDev = Boolean(import.meta.env.DEV);

let lastPack = null;
let packCounter = 0;
let lastOpenClick = null;
let lastGeneration = null;
const packIdsByCards = new WeakMap();
const sessionRecords = [];

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function getFileExtension(url) {
  try {
    const pathname = new URL(url, window.location.href).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);

    return match ? match[1].toLowerCase() : "";
  } catch {
    const match = String(url || "").split("?")[0].match(/\.([a-z0-9]+)$/i);

    return match ? match[1].toLowerCase() : "";
  }
}

function getResourceTiming(url, startTime = 0) {
  if (!isDev || typeof performance === "undefined" || !url) return null;

  const normalizedUrl = normalizeUrl(url);
  const entries = performance
    .getEntriesByType("resource")
    .filter((entry) => normalizeUrl(entry.name) === normalizedUrl)
    .filter((entry) => !startTime || entry.startTime >= startTime - 5);
  const entry = entries[entries.length - 1];

  if (!entry) return null;

  const hasDetailedTiming = entry.responseStart > 0 && entry.requestStart > 0;

  return {
    duration: Math.round(entry.duration),
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
    startTime: Math.round(entry.startTime),
    timingRestricted: !hasDetailedTiming,
    responseStart: Math.round(entry.responseStart),
    responseEnd: Math.round(entry.responseEnd),
    dns: hasDetailedTiming ? Math.round(entry.domainLookupEnd - entry.domainLookupStart) : "",
    connect: hasDetailedTiming ? Math.round(entry.connectEnd - entry.connectStart) : "",
    ttfb: hasDetailedTiming ? Math.round(entry.responseStart - entry.requestStart) : "",
    download: hasDetailedTiming ? Math.round(entry.responseEnd - entry.responseStart) : "",
  };
}

function normalizeUrl(url) {
  if (!url || typeof window === "undefined") return "";

  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return String(url || "");
  }
}

function findRecord(packId, slot) {
  if (!lastPack || lastPack.packId !== packId) return null;

  return lastPack.records.find((record) => record.slot === slot) || null;
}

function getUrlMismatchReason(preloadUrl, renderedUrl) {
  if (!preloadUrl || !renderedUrl || preloadUrl === renderedUrl) return "";

  try {
    const preload = new URL(preloadUrl, window.location.origin);
    const rendered = new URL(renderedUrl, window.location.origin);
    const reasons = [];

    if (preload.href !== rendered.href) reasons.push("href");
    if (preload.origin !== rendered.origin) reasons.push("origin");
    if (preload.pathname !== rendered.pathname) reasons.push("path");
    if (preload.pathname.toLowerCase() === rendered.pathname.toLowerCase() && preload.pathname !== rendered.pathname) {
      reasons.push("case");
    }
    if (getFileExtension(preload.href) !== getFileExtension(rendered.href)) reasons.push("extension");
    if (preload.search !== rendered.search) reasons.push("query");

    return reasons.join(", ") || "different string";
  } catch {
    return "could not parse";
  }
}

function updateUrlDiagnostics(record) {
  record.normalizedPreloadUrl = normalizeUrl(record.preloadUrl);
  record.normalizedRenderedUrl = normalizeUrl(record.renderedUrl);
  record.renderedUrlMissing = !record.renderedUrl;
  record.urlMismatchRaw = Boolean(record.preloadUrl && record.renderedUrl && record.preloadUrl !== record.renderedUrl);
  record.urlMismatchNormalized = Boolean(
    record.normalizedPreloadUrl &&
      record.normalizedRenderedUrl &&
      record.normalizedPreloadUrl !== record.normalizedRenderedUrl
  );
  record.urlMismatchReason = record.urlMismatchNormalized
    ? getUrlMismatchReason(record.normalizedPreloadUrl, record.normalizedRenderedUrl)
    : "";
}

function toTableRecord(record) {
  const earlyLateMs =
    Number.isFinite(record.preloadFinishTime) && Number.isFinite(record.visualRevealTime)
      ? Math.round(record.visualRevealTime - record.preloadFinishTime)
      : "";
  const finishedAfterReveal = Number.isFinite(earlyLateMs) ? earlyLateMs < 0 : false;

  return {
    slot: record.slot + 1,
    card: record.cardName,
    set: record.setId,
    rarity: record.rarity,
    ext: record.fileExtension,
    status: record.status,
    preloadMs: Math.round(record.preloadDurationMs ?? 0),
    revealDeltaMs: earlyLateMs === "" ? "" : earlyLateMs,
    finishedAfterReveal,
    natural: record.naturalWidth && record.naturalHeight ? `${record.naturalWidth}x${record.naturalHeight}` : "",
    transferSize: record.resourceTiming?.transferSize ?? "",
    encodedBodySize: record.resourceTiming?.encodedBodySize ?? "",
    decodedBodySize: record.resourceTiming?.decodedBodySize ?? "",
    ttfb: record.resourceTiming?.ttfb ?? "",
    download: record.resourceTiming?.download ?? "",
    preloadUrl: record.preloadUrl,
    renderedUrl: record.renderedUrl || "",
    normalizedPreloadUrl: record.normalizedPreloadUrl || "",
    normalizedRenderedUrl: record.normalizedRenderedUrl || "",
    renderedUrlMissing: Boolean(record.renderedUrlMissing),
    renderedUrlCapturedAt: record.renderedUrlCapturedAt || null,
    urlMismatchRaw: Boolean(record.urlMismatchRaw),
    urlMismatchNormalized: Boolean(record.urlMismatchNormalized),
  };
}

function getMedian(values) {
  if (!values.length) return 0;

  const sortedValues = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2) return sortedValues[midpoint];

  return (sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2;
}

function getRepeatedSlowCardNames(records) {
  const counts = records.reduce((result, record) => {
    result[record.cardName] = (result[record.cardName] || 0) + 1;
    return result;
  }, {});

  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .sort(([, countA], [, countB]) => countB - countA)
    .map(([cardName, count]) => ({ cardName, count }));
}

function getLoadDuration(record) {
  return Number(record?.loadDurationMs ?? record?.durationMs ?? record?.preloadDurationMs ?? 0);
}

function getImageSummary() {
  const records = sessionRecords;
  const successfulLoads = records.filter((record) => record.status === "success");
  const failedLoads = records.filter((record) => record.status !== "success" && record.status !== "pending");
  const pendingLoads = records.filter((record) => record.status === "pending");
  const successfulDurations = successfulLoads
    .map(getLoadDuration)
    .filter((duration) => Number.isFinite(duration));
  const slowSuccessfulLoads = successfulLoads.filter((record) => getLoadDuration(record) > SLOW_IMAGE_MS);
  const verySlowSuccessfulLoads = successfulLoads.filter((record) => getLoadDuration(record) > VERY_SLOW_IMAGE_MS);
  const finishedAfterReveal = records.filter(
    (record) =>
      Number.isFinite(record.preloadFinishTime) &&
      Number.isFinite(record.visualRevealTime) &&
      record.preloadFinishTime > record.visualRevealTime
  );
  const top10SlowestSuccessfulImageUrls = [...successfulLoads]
    .sort((a, b) => getLoadDuration(b) - getLoadDuration(a))
    .slice(0, 10)
    .map((record) => ({
      cardName: record.cardName,
      setId: record.setId,
      rarity: record.rarity,
      slot: record.slot + 1,
      imageUrl: record.renderedUrl || record.imageUrl || record.preloadUrl,
      durationMs: Math.round(getLoadDuration(record)),
      preloadMs: Math.round(getLoadDuration(record)),
      revealDeltaMs:
        Number.isFinite(record.visualRevealTime) && Number.isFinite(record.preloadFinishTime)
          ? Math.round(record.visualRevealTime - record.preloadFinishTime)
          : "",
      finishedAfterReveal:
        Number.isFinite(record.preloadFinishTime) &&
        Number.isFinite(record.visualRevealTime) &&
        record.preloadFinishTime > record.visualRevealTime,
      preloadUrl: record.preloadUrl,
      renderedUrl: record.renderedUrl || "",
      normalizedPreloadUrl: record.normalizedPreloadUrl || "",
      normalizedRenderedUrl: record.normalizedRenderedUrl || "",
      renderedUrlMissing: Boolean(record.renderedUrlMissing),
      renderedUrlCapturedAt: record.renderedUrlCapturedAt || null,
      urlMismatchRaw: Boolean(record.urlMismatchRaw),
      urlMismatchNormalized: Boolean(record.urlMismatchNormalized),
      transferSize: record.resourceTiming?.transferSize ?? "",
      encodedBodySize: record.resourceTiming?.encodedBodySize ?? "",
      decodedBodySize: record.resourceTiming?.decodedBodySize ?? "",
      ttfb: record.resourceTiming?.ttfb ?? "",
      download: record.resourceTiming?.download ?? "",
    }));
  const summary = {
    totalRecords: records.length,
    successfulLoads: successfulLoads.length,
    failedLoads: failedLoads.length,
    pendingLoads: pendingLoads.length,
    slowSuccessfulLoadsOver1000ms: slowSuccessfulLoads.length,
    verySlowSuccessfulLoadsOver2500ms: verySlowSuccessfulLoads.length,
    finishedAfterRevealCount: finishedAfterReveal.length,
    preloadRenderUrlMismatchCount: records.filter((record) => record.urlMismatchNormalized).length,
    rawPreloadRenderUrlMismatchCount: records.filter((record) => record.urlMismatchRaw).length,
    normalizedPreloadRenderUrlMismatchCount: records.filter((record) => record.urlMismatchNormalized).length,
    renderedUrlMissingCount: records.filter((record) => record.renderedUrlMissing).length,
    fallbackFailureCount: records.filter((record) => record.failedRenderedUrl).length,
    averageSuccessfulLoadDurationMs: successfulDurations.length
      ? Math.round(successfulDurations.reduce((sum, duration) => sum + duration, 0) / successfulDurations.length)
      : 0,
    medianSuccessfulLoadDurationMs: Math.round(getMedian(successfulDurations)),
    top10SlowestSuccessfulImageUrls,
    repeatedSlowCardNames: getRepeatedSlowCardNames(slowSuccessfulLoads),
    imagesFinishedAfterReveal: finishedAfterReveal.length,
    topRepeatedSlowCardNames: getRepeatedSlowCardNames(slowSuccessfulLoads),
    failedImageUrls: failedLoads.slice(0, 20).map((record) => ({
      cardName: record.cardName,
      setId: record.setId,
      rarity: record.rarity,
      slot: record.slot + 1,
      preloadUrl: record.preloadUrl,
      renderedUrl: record.renderedUrl || "",
      normalizedPreloadUrl: record.normalizedPreloadUrl || "",
      normalizedRenderedUrl: record.normalizedRenderedUrl || "",
      failedRenderedUrl: record.failedRenderedUrl || "",
      status: record.status,
    })),
    finishedAfterRevealImages: finishedAfterReveal.slice(0, 20).map((record) => ({
      cardName: record.cardName,
      setId: record.setId,
      slot: record.slot + 1,
      lateByMs: Math.round(record.preloadFinishTime - record.visualRevealTime),
      preloadMs: Math.round(record.preloadDurationMs || 0),
      preloadUrl: record.preloadUrl,
      renderedUrl: record.renderedUrl || "",
      normalizedPreloadUrl: record.normalizedPreloadUrl || "",
      normalizedRenderedUrl: record.normalizedRenderedUrl || "",
      renderedUrlMissing: Boolean(record.renderedUrlMissing),
      status: record.status,
    })),
  };

  console.log("[PackDex image summary]");
  console.table(top10SlowestSuccessfulImageUrls);
  console.log(JSON.stringify(summary, null, 2));

  return summary;
}

function findImageRecords(cardNameOrUrl = "") {
  const query = String(cardNameOrUrl || "").trim().toLowerCase();

  if (!query) return [];

  return sessionRecords.filter((record) =>
    [
      record.cardName,
      record.preloadUrl,
      record.renderedUrl,
      record.normalizedPreloadUrl,
      record.normalizedRenderedUrl,
      record.failedRenderedUrl,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  );
}

function exportImageDebug() {
  const slowRecords = sessionRecords
    .filter(
      (record) =>
        getLoadDuration(record) > SLOW_IMAGE_MS ||
        (Number.isFinite(record.preloadFinishTime) &&
          Number.isFinite(record.visualRevealTime) &&
          record.preloadFinishTime > record.visualRevealTime)
    )
    .map(toTableRecord);

  return JSON.stringify(
    {
      summary: getImageSummary(),
      slowRecords,
    },
    null,
    2
  );
}

function installWindowHelpers() {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  window.__packdexImageDebug = () => lastPack?.records || [];
  window.__packdexImageSummary = getImageSummary;
  window.__packdexFindImageRecord = findImageRecords;
  window.__packdexExportImageDebug = exportImageDebug;
  window.__packdexSlowImages = () =>
    (lastPack?.records || []).filter(
      (record) =>
        (record.preloadDurationMs || 0) > SLOW_IMAGE_MS ||
        (Number.isFinite(record.preloadFinishTime) &&
          Number.isFinite(record.visualRevealTime) &&
          record.preloadFinishTime > record.visualRevealTime)
    );
  window.__packdexLastPackImageTable = () => {
    const rows = (lastPack?.records || []).map(toTableRecord);

    console.table(rows);
    return rows;
  };
  if (import.meta.env.DEV && !window.__packdexRunImageLoadTest) {
    import("./imageLoadTest.dev.js").then(({ runImageLoadTest }) => {
      window.__packdexRunImageLoadTest = runImageLoadTest;
    });
  }
}

function maybeWarnRecord(record) {
  if (!isDev || !record || record.warned) return;

  const duration = record.preloadDurationMs || 0;
  const finishedLate =
    Number.isFinite(record.preloadFinishTime) &&
    Number.isFinite(record.visualRevealTime) &&
    record.preloadFinishTime > record.visualRevealTime;
  const lateBy = finishedLate ? Math.round(record.preloadFinishTime - record.visualRevealTime) : 0;

  if (finishedLate) {
    console.warn("[PackDex image late after reveal]", {
      card: record.cardName,
      slot: record.slot + 1,
      lateBy,
      preloadUrl: record.preloadUrl,
      renderedUrl: record.renderedUrl,
    });
  }

  if (duration > VERY_SLOW_IMAGE_MS) {
    console.error("[PackDex very slow image]", toTableRecord(record));
  } else if (duration > SLOW_IMAGE_MS) {
    console.warn("[PackDex slow image]", toTableRecord(record));
  }

  if (record.urlMismatchReason) {
    console.warn("[PackDex preload/render URL mismatch]", {
      card: record.cardName,
      slot: record.slot + 1,
      reason: record.urlMismatchReason,
      preloadUrl: record.preloadUrl,
      renderedUrl: record.renderedUrl,
    });
  }

  if (finishedLate || duration > SLOW_IMAGE_MS || record.urlMismatchReason) {
    record.warned = true;
  }
}

function maybePrintPackTable() {
  if (!isDev || !lastPack || lastPack.printed) return;

  const allPreloadsDone = lastPack.records.every((record) => record.preloadFinishTime || record.status === "failed");
  const allRevealTimesKnown = lastPack.records.every((record) => Number.isFinite(record.visualRevealTime));

  if (!allPreloadsDone || !allRevealTimesKnown) return;

  lastPack.printed = true;
  console.groupCollapsed(`[PackDex image timings] ${lastPack.setName} (${lastPack.records.length} cards)`);
  console.table(lastPack.records.map(toTableRecord));
  console.log({
    packId: lastPack.packId,
    openClick: lastOpenClick,
    generation: lastGeneration,
    dealStartTime: lastPack.dealStartTime,
    preloadStartTime: lastPack.preloadStartTime,
  });
  console.groupEnd();
}

export function markOpenPackClick(set) {
  if (!isDev) return;

  lastOpenClick = {
    time: now(),
    setId: set?.id || "",
    setName: set?.name || "",
  };
  installWindowHelpers();
  console.log("[PackDex open pack click]", lastOpenClick);
}

export function markPackGenerationStart(set) {
  if (!isDev) return 0;

  const generationStart = now();

  console.log("[PackDex pack generation start]", {
    time: generationStart,
    setId: set?.id || "",
    setName: set?.name || "",
  });

  return generationStart;
}

export function markPackGenerationComplete(set, cards, generationStart) {
  if (!isDev) return;

  const finishTime = now();

  lastGeneration = {
    startTime: generationStart,
    finishTime,
    durationMs: generationStart ? Math.round(finishTime - generationStart) : "",
    setId: set?.id || "",
    setName: set?.name || "",
    cards: cards?.length || 0,
  };
  console.log("[PackDex pack generation complete]", lastGeneration);
}

export function beginPackImageDebug(cards, set) {
  if (!isDev || !Array.isArray(cards)) return "";

  const existingPackId = packIdsByCards.get(cards);

  if (existingPackId) return existingPackId;

  packCounter += 1;

  const packId = `image-pack-${Date.now()}-${packCounter}`;
  packIdsByCards.set(cards, packId);

  lastPack = {
    packId,
    setId: set?.id || "",
    setName: set?.name || "",
    createdAt: now(),
    records: cards.map((card, index) => {
      const preloadUrl = getCardImageUrl(card);

      return {
        packId,
        slot: index,
        cardName: getDisplayCardName(card, set),
        setName: set?.name || "",
        setId: set?.id || "",
        rarity: getDisplayRarity(card, set),
        preloadUrl,
        normalizedPreloadUrl: normalizeUrl(preloadUrl),
        normalizedRenderedUrl: "",
        renderedUrl: "",
        renderedUrlMissing: true,
        renderedUrlCapturedAt: null,
        urlMismatchRaw: false,
        urlMismatchNormalized: false,
        finalImageUrl: getCardImageUrl(card),
        fileExtension: getFileExtension(preloadUrl),
        status: "pending",
      };
    }),
    printed: false,
  };
  sessionRecords.push(...lastPack.records);
  installWindowHelpers();
  return packId;
}

export function markDealStart(packId) {
  if (!isDev || !lastPack || lastPack.packId !== packId) return;

  lastPack.dealStartTime = now();
  console.log("[PackDex dealing animation start]", {
    packId,
    time: lastPack.dealStartTime,
  });
}

export function markPreloadStart(packId, slot, url) {
  const record = findRecord(packId, slot);

  if (!isDev || !record) return;

  record.preloadUrl = url;
  record.preloadStartTime = now();
  record.fileExtension = getFileExtension(url);
  updateUrlDiagnostics(record);
  console.log("[PackDex preload start]", {
    slot: slot + 1,
    card: record.cardName,
    url,
    time: record.preloadStartTime,
  });
}

export function markPreloadFinish(packId, slot, url, result, detail = {}) {
  const record = findRecord(packId, slot);

  if (!isDev || !record) return;

  record.preloadFinishTime = now();
  record.preloadDurationMs = record.preloadStartTime ? record.preloadFinishTime - record.preloadStartTime : 0;
  record.status = result ? "success" : "failed";
  record.naturalWidth = detail.img?.naturalWidth || record.naturalWidth || "";
  record.naturalHeight = detail.img?.naturalHeight || record.naturalHeight || "";
  record.resourceTiming = getResourceTiming(url, record.preloadStartTime);
  updateUrlDiagnostics(record);

  maybeWarnRecord(record);
  maybePrintPackTable();
}

export function markVisualRevealSchedule(packId, slot, revealTime) {
  const record = findRecord(packId, slot);

  if (!isDev || !record) return;

  record.visualRevealTime = revealTime;
  console.log("[PackDex visual reveal scheduled]", {
    slot: slot + 1,
    card: record.cardName,
    time: revealTime,
  });
  maybeWarnRecord(record);
  maybePrintPackTable();
}

export function markRenderedImageLoad(packId, slot, renderedUrl, img) {
  const record = findRecord(packId, slot);

  if (!isDev || !record) return;

  if (renderedUrl) {
    record.renderedUrl = renderedUrl;
    record.renderedUrlCapturedAt = now();
  }
  record.renderLoadTime = now();
  record.naturalWidth = img?.naturalWidth || record.naturalWidth || "";
  record.naturalHeight = img?.naturalHeight || record.naturalHeight || "";
  record.resourceTiming = getResourceTiming(renderedUrl, record.preloadStartTime) || record.resourceTiming;
  updateUrlDiagnostics(record);

  maybeWarnRecord(record);
  maybePrintPackTable();
}

export function markRenderedImageSrc(packId, slot, renderedUrl) {
  const record = findRecord(packId, slot);

  if (!isDev || !record || !renderedUrl) return;

  record.renderedUrl = renderedUrl;
  record.renderedUrlCapturedAt = now();
  updateUrlDiagnostics(record);

  maybeWarnRecord(record);
  maybePrintPackTable();
}

export function markRenderedImageError(packId, slot, failedUrl) {
  const record = findRecord(packId, slot);

  if (!isDev || !record) return;

  record.failedRenderedUrl = failedUrl;
  record.renderErrorTime = now();
  if (failedUrl) {
    record.renderedUrl = record.renderedUrl || failedUrl;
    record.renderedUrlCapturedAt = record.renderedUrlCapturedAt || now();
  }
  record.status = record.status === "success" ? "render-failed-after-preload" : "failed";
  updateUrlDiagnostics(record);
  console.warn("[PackDex rendered image failed]", {
    slot: slot + 1,
    card: record.cardName,
    failedUrl,
    preloadUrl: record.preloadUrl,
  });
}

installWindowHelpers();
