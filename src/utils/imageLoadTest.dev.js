import { sets } from "../data/sets.js";
import { getCardImageUrl } from "./assetUrls.js";
import { preloadImage } from "./imageCache.js";
import { generatePack, getDisplayCardName, getDisplayRarity } from "./packGenerator.js";

const SLOW_IMAGE_MS = 1000;
const VERY_SLOW_IMAGE_MS = 2500;

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

function normalizeUrl(url) {
  if (!url || typeof window === "undefined") return "";

  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return String(url || "");
  }
}

function getResourceTiming(url, startTime = 0) {
  if (!import.meta.env.DEV || typeof performance === "undefined" || !url) return null;

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

function toTableRecord(record) {
  return {
    pack: record.packIndex,
    slot: record.slot + 1,
    card: record.cardName,
    set: record.setId,
    rarity: record.rarity,
    ext: record.fileExtension,
    status: record.status,
    preloadMs: Math.round(record.preloadDurationMs ?? 0),
    natural: record.naturalWidth && record.naturalHeight ? `${record.naturalWidth}x${record.naturalHeight}` : "",
    transferSize: record.resourceTiming?.transferSize ?? "",
    encodedBodySize: record.resourceTiming?.encodedBodySize ?? "",
    decodedBodySize: record.resourceTiming?.decodedBodySize ?? "",
    ttfb: record.resourceTiming?.ttfb ?? "",
    download: record.resourceTiming?.download ?? "",
    preloadUrl: record.preloadUrl,
    renderedUrl: record.renderedUrl || "",
  };
}

async function loadImageForTest(record) {
  record.preloadStartTime = now();

  const didLoad = await preloadImage(record.preloadUrl, {
    timeoutMs: 0,
    onStart: () => {
      record.preloadStartTime = now();
    },
    onLoad: (detail) => {
      record.preloadFinishTime = now();
      record.preloadDurationMs = record.preloadFinishTime - record.preloadStartTime;
      record.status = "success";
      record.naturalWidth = detail.img?.naturalWidth || "";
      record.naturalHeight = detail.img?.naturalHeight || "";
    },
    onError: () => {
      record.preloadFinishTime = now();
      record.preloadDurationMs = record.preloadFinishTime - record.preloadStartTime;
      record.status = "failed";
    },
  });

  if (!record.preloadFinishTime) {
    record.preloadFinishTime = now();
    record.preloadDurationMs = record.preloadFinishTime - record.preloadStartTime;
    record.status = didLoad ? "success" : "failed";
  }

  record.resourceTiming = getResourceTiming(record.preloadUrl, record.preloadStartTime);
  return record;
}

export async function runImageLoadTest(count = 20, options = {}) {
  if (!import.meta.env.DEV) {
    return { refused: true, reason: "PackDex image load testing is only available in development." };
  }

  const packCount = Math.max(1, Math.min(Number(count) || 20, 100));
  const candidateSets = sets.filter((set) => Array.isArray(set.cards) && set.cards.length > 0);
  const selectedSetId = options.setId || "";
  const testSets = selectedSetId
    ? candidateSets.filter((set) => set.id === selectedSetId)
    : candidateSets;

  if (!testSets.length) {
    return { refused: true, reason: "No safe set data was available for image load testing." };
  }

  const startedAt = now();
  const records = [];

  for (let packIndex = 0; packIndex < packCount; packIndex += 1) {
    const set = testSets[packIndex % testSets.length];
    const pack = generatePack(set);
    const packRecords = pack.map((card, cardIndex) => {
      const preloadUrl = getCardImageUrl(card);

      return {
        packIndex: packIndex + 1,
        slot: cardIndex,
        cardName: getDisplayCardName(card, set),
        setName: set.name || "",
        setId: set.id || "",
        rarity: getDisplayRarity(card, set),
        preloadUrl,
        renderedUrl: preloadUrl,
        fileExtension: getFileExtension(preloadUrl),
        status: "pending",
      };
    });

    await Promise.all(packRecords.map(loadImageForTest));
    records.push(...packRecords);
  }

  const slowImages = records.filter((record) => (record.preloadDurationMs || 0) > SLOW_IMAGE_MS);
  const verySlowImages = records.filter((record) => (record.preloadDurationMs || 0) > VERY_SLOW_IMAGE_MS);
  const failures = records.filter((record) => record.status !== "success");
  const rows = records.map(toTableRecord);
  const summary = {
    packs: packCount,
    images: records.length,
    slowOver1000ms: slowImages.length,
    verySlowOver2500ms: verySlowImages.length,
    failures: failures.length,
    durationMs: Math.round(now() - startedAt),
    records,
    slowImages,
    verySlowImages,
    failures,
  };

  console.groupCollapsed(`[PackDex image load test] ${packCount} packs, ${records.length} images`);
  console.table(rows);
  console.log(summary);
  console.groupEnd();

  return summary;
}
