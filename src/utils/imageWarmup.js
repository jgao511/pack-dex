import { getCardImageUrl } from "./assetUrls.js";
import { getRarityCategory } from "./packGenerator.js";

const COMMON_PRIORITY = new Set(["common", "uncommon", "rare", "holoRare"]);

const warmedUrls = new Set();
const queuedUrls = new Set();
const activeUrls = new Set();
const queue = [];
const stats = {
  queued: 0,
  warmed: 0,
  failed: 0,
  skippedDuplicate: 0,
  skippedConnection: 0,
  skippedCap: 0,
  initialSelectedSetWarmup: 0,
  summaryScreenWarmup: 0,
};

let activeCount = 0;
let isPaused = false;
let pausedBecausePackOpening = false;
let idleHandle = null;
let timeoutHandle = null;
let currentSelectedSetId = "";

function isMobileWarmup() {
  if (typeof window === "undefined") return false;

  return window.matchMedia?.("(max-width: 720px)")?.matches || navigator.maxTouchPoints > 1;
}

function getConnectionInfo() {
  if (typeof navigator === "undefined") return {};

  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
}

function getConcurrency() {
  return isMobileWarmup() ? 2 : 3;
}

function getSessionCap() {
  return isMobileWarmup() ? 100 : 200;
}

function getDefaultBatchSize() {
  return isMobileWarmup() ? 25 : 50;
}

function getSummaryBatchSize() {
  return isMobileWarmup() ? 15 : 35;
}

function shouldSkipForConnection() {
  const connection = getConnectionInfo();

  if (connection.saveData) return true;
  if (["slow-2g", "2g"].includes(connection.effectiveType)) return true;

  return false;
}

function canStartWarmup() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (isPaused || document.visibilityState === "hidden") return false;
  if (shouldSkipForConnection()) return false;

  return warmedUrls.size + activeCount < getSessionCap();
}

function scheduleIdleWork() {
  if (idleHandle || timeoutHandle || !queue.length) return;
  if (isPaused || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;

  const run = () => {
    idleHandle = null;
    timeoutHandle = null;
    pumpQueue();
  };

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    idleHandle = window.requestIdleCallback(run, { timeout: 1800 });
    return;
  }

  timeoutHandle = window.setTimeout(run, 900);
}

function clearScheduledIdleWork() {
  if (typeof window === "undefined") return;

  if (idleHandle && "cancelIdleCallback" in window) {
    window.cancelIdleCallback(idleHandle);
  }

  if (timeoutHandle) {
    window.clearTimeout(timeoutHandle);
  }

  idleHandle = null;
  timeoutHandle = null;
}

function warmUrl(url) {
  activeCount += 1;
  activeUrls.add(url);

  const img = new Image();

  img.decoding = "async";
  img.onload = () => {
    activeCount -= 1;
    activeUrls.delete(url);
    warmedUrls.add(url);
    stats.warmed += 1;
    pumpQueue();
  };
  img.onerror = () => {
    activeCount -= 1;
    activeUrls.delete(url);
    stats.failed += 1;
    pumpQueue();
  };
  img.src = url;
}

function pumpQueue() {
  clearScheduledIdleWork();

  if (!queue.length) return;

  if (shouldSkipForConnection()) {
    stats.skippedConnection += queue.length;
    queue.length = 0;
    queuedUrls.clear();
    return;
  }

  if (!canStartWarmup()) {
    scheduleIdleWork();
    return;
  }

  while (queue.length && activeCount < getConcurrency() && warmedUrls.size + activeCount < getSessionCap()) {
    const url = queue.shift();

    queuedUrls.delete(url);

    if (!url || warmedUrls.has(url)) {
      stats.skippedDuplicate += 1;
      continue;
    }

    warmUrl(url);
  }

  if (queue.length) {
    if (warmedUrls.size + activeCount >= getSessionCap()) {
      stats.skippedCap += queue.length;
      queue.length = 0;
      queuedUrls.clear();
      return;
    }

    scheduleIdleWork();
  }
}

function getWarmupLimit(limit) {
  return Math.min(Number(limit) || getDefaultBatchSize(), getDefaultBatchSize());
}

function scoreWarmupCard(card, set) {
  const category = card.rarityCategory || getRarityCategory(card, set);

  if (COMMON_PRIORITY.has(category)) return 0;
  if (["doubleRare", "megaDoubleRare", "illustrationRare"].includes(category)) return 1;
  if (["ultraRare", "specialIllustrationRare", "secretRare", "hyperRare"].includes(category)) return 2;

  return 3;
}

export function scheduleImageWarmup(urls, options = {}) {
  if (typeof window === "undefined" || !Array.isArray(urls) || !urls.length) return;

  if (shouldSkipForConnection()) {
    stats.skippedConnection += urls.length;
    return;
  }

  const limit = getWarmupLimit(options.limit);
  const availableSlots = Math.max(0, getSessionCap() - warmedUrls.size - activeCount - queue.length);
  const batch = [];
  let duplicateCount = 0;

  for (const url of urls) {
    if (!url) continue;

    if (warmedUrls.has(url) || queuedUrls.has(url) || activeUrls.has(url) || batch.includes(url)) {
      duplicateCount += 1;
      continue;
    }

    batch.push(url);

    if (batch.length >= Math.min(limit, availableSlots)) break;
  }

  batch.forEach((url) => {
    queue.push(url);
    queuedUrls.add(url);
    stats.queued += 1;
  });

  stats.skippedDuplicate += duplicateCount;

  if (options.source === "summary") {
    stats.summaryScreenWarmup += batch.length;
  } else if (options.source === "selected-set") {
    stats.initialSelectedSetWarmup += batch.length;
  }

  if (batch.length < urls.length && availableSlots <= 0) {
    stats.skippedCap += urls.length - batch.length;
  }

  scheduleIdleWork();
}

export function scheduleSelectedSetImageWarmup(set, options = {}) {
  if (!set?.cards?.length) return;

  currentSelectedSetId = set.id || set.name || "";

  const urls = [...set.cards]
    .sort((cardA, cardB) => scoreWarmupCard(cardA, set) - scoreWarmupCard(cardB, set))
    .map((card) => getCardImageUrl(card))
    .filter(Boolean);

  const isSummaryWarmup = options.source === "summary";
  const defaultLimit = isSummaryWarmup ? getSummaryBatchSize() : getDefaultBatchSize();

  scheduleImageWarmup(urls, {
    limit: options.limit ?? defaultLimit,
    source: isSummaryWarmup ? "summary" : "selected-set",
  });
}

export function pauseImageWarmup(options = {}) {
  isPaused = true;
  pausedBecausePackOpening = Boolean(options.packOpening);
  clearScheduledIdleWork();
}

export function resumeImageWarmup() {
  isPaused = false;
  pausedBecausePackOpening = false;
  scheduleIdleWork();
}

export function clearImageWarmupQueue() {
  queue.length = 0;
  queuedUrls.clear();
  currentSelectedSetId = "";
  clearScheduledIdleWork();
}

export function getImageWarmupStats() {
  return {
    queuedCount: queue.length,
    warmedCount: warmedUrls.size,
    failedWarmupCount: stats.failed,
    skippedDuplicateCount: stats.skippedDuplicate,
    skippedConnectionCount: stats.skippedConnection,
    skippedCapCount: stats.skippedCap,
    activeCount,
    paused: isPaused,
    pausedBecausePackOpening,
    sessionCap: getSessionCap(),
    sessionCapRemaining: Math.max(0, getSessionCap() - warmedUrls.size - activeCount - queue.length),
    concurrency: getConcurrency(),
    currentSelectedSetBeingWarmed: currentSelectedSetId || null,
    initialSelectedSetWarmupCount: stats.initialSelectedSetWarmup,
    summaryScreenWarmupCount: stats.summaryScreenWarmup,
  };
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearScheduledIdleWork();
      return;
    }

    scheduleIdleWork();
  });

  if (import.meta.env.DEV) {
    window.__packdexImageWarmupStats = getImageWarmupStats;
  }
}
