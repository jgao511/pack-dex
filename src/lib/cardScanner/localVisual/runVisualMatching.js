import { getScannerCatalog } from "../buildScannerCatalog.js";
import { normalizeCardName } from "../normalizeScannerText.js";
import { getCardImageUrl } from "../../../utils/assetUrls.js";
import { probeVisualWorker, rerankWithOrb, searchVisualIndex } from "./visualWorkerClient.js";

const DEFAULT_VISUAL_RECALL_LIMIT = 40;
const DEFAULT_ORB_CANDIDATE_LIMIT = 20;
const DECODED_CANDIDATE_CACHE_LIMIT = 24;
const decodedCandidateCanvasCache = new Map();

async function imageUrlToCanvas(imageUrl, loadImageBlob, maxEdge = 520) {
  const started = performance.now(); const blobStarted = performance.now(); const blob = await loadImageBlob(imageUrl);
  const blobLoadMs = performance.now() - blobStarted; const decodeStarted = performance.now();
  const bitmap = await createImageBitmap(blob, { imageOrientation: "none" }); const decodeMs = performance.now() - decodeStarted;
  const drawStarted = performance.now();
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
  return { canvas, timing: { blobLoadMs, decodeMs, drawMs: performance.now() - drawStarted, totalMs: performance.now() - started } };
}

function releaseCanvas(canvas) { if (canvas) { canvas.width = 0; canvas.height = 0; } }
function evictDecodedCandidate(entry) {
  if (entry.canvas) releaseCanvas(entry.canvas);
  else entry.promise?.then(({ canvas }) => releaseCanvas(canvas)).catch(() => {});
}
function makeDecodedCandidateCacheRoom() {
  if (decodedCandidateCanvasCache.size < DECODED_CANDIDATE_CACHE_LIMIT) return true;
  for (const [url, entry] of decodedCandidateCanvasCache) {
    if (entry.users > 0) continue;
    decodedCandidateCanvasCache.delete(url); evictDecodedCandidate(entry); return true;
  }
  return false;
}
async function acquireDecodedCandidateCanvas(imageUrl, loadImageBlob) {
  let entry = decodedCandidateCanvasCache.get(imageUrl);
  const cacheHit = Boolean(entry);
  if (entry) {
    decodedCandidateCanvasCache.delete(imageUrl); decodedCandidateCanvasCache.set(imageUrl, entry);
  } else {
    const cached = Boolean(imageUrl) && makeDecodedCandidateCacheRoom();
    entry = { users: 0, canvas: null, cached, promise: null };
    entry.promise = imageUrlToCanvas(imageUrl, loadImageBlob).then((result) => { entry.canvas = result.canvas; return result; });
    if (cached) decodedCandidateCanvasCache.set(imageUrl, entry);
  }
  entry.users += 1;
  try {
    const result = await entry.promise;
    return {
      canvas: result.canvas,
      cacheHit,
      timing: cacheHit ? { blobLoadMs: 0, decodeMs: 0, drawMs: 0, totalMs: 0 } : result.timing,
      release() {
        entry.users = Math.max(0, entry.users - 1);
        if (!entry.cached && entry.users === 0) releaseCanvas(entry.canvas);
      },
    };
  } catch (error) {
    entry.users = Math.max(0, entry.users - 1);
    if (entry.cached && decodedCandidateCanvasCache.get(imageUrl) === entry) decodedCandidateCanvasCache.delete(imageUrl);
    throw error;
  }
}

export function clearDecodedCandidateCanvasCache() {
  for (const entry of decodedCandidateCanvasCache.values()) {
    entry.cached = false;
    if (entry.users === 0) evictDecodedCandidate(entry);
  }
  decodedCandidateCanvasCache.clear();
}

export function getDecodedCandidateCanvasCacheSize() { return decodedCandidateCanvasCache.size; }

function editDistance(left, right) {
  const row = [...Array(right.length + 1).keys()];
  for (let i = 1; i <= left.length; i += 1) { let previous = row[0]; row[0] = i; for (let j = 1; j <= right.length; j += 1) { const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + Number(left[i - 1] !== right[j - 1])); previous = old; } }
  return row[right.length];
}

function fuzzyNameScore(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.slice(0, 3) !== right.slice(0, 3) || Math.abs(left.length - right.length) > 4) return 0;
  const score = 1 - editDistance(left, right) / Math.max(left.length, right.length);
  return score >= .82 ? score : 0;
}

/**
 * Builds a broad recall pool, then selects the bounded set that is worth the
 * more expensive ORB pass. OCR signals can recover a card that lightweight
 * visual matching placed below the ORB cutoff.
 */
export function buildVisualCandidateShortlist({
  lightweight,
  ocrMatch,
  catalog = getScannerCatalog(),
  visualRecallLimit = DEFAULT_VISUAL_RECALL_LIMIT,
  orbCandidateLimit = DEFAULT_ORB_CANDIDATE_LIMIT,
} = {}) {
  const trustedById = new Map(catalog.map((entry) => [entry.cardId, entry]));
  const scores = new Map();
  const add = (cardId, amount, source) => {
    if (!trustedById.has(cardId)) return;
    const existing = scores.get(cardId) || { cardId, score: 0, sources: [] };
    existing.score += amount; existing.sources.push(source); scores.set(cardId, existing);
  };

  const boundedRecallLimit = Math.max(30, Math.min(50, Number(visualRecallLimit) || DEFAULT_VISUAL_RECALL_LIMIT));
  (lightweight?.candidates || []).slice(0, boundedRecallLimit).forEach((candidate, index) => {
    add(candidate.cardId, Number(candidate.score || 0) + Math.max(0, .12 - index * .002), `visual:${index + 1}`);
  });
  (ocrMatch?.results || []).forEach((candidate, index) => add(candidate.cardId, 1.2 + Math.min(.7, Number(candidate.score || 0) / 150), `ocr-result:${index + 1}`));
  (ocrMatch?.narrowedCardIds || []).forEach((cardId) => add(cardId, .65, "ocr-fuzzy-shortlist"));

  const collectors = ocrMatch?.collectorNumbers || [];
  const names = (ocrMatch?.nameCandidates || []).map((candidate) => normalizeCardName(candidate.normalized || candidate.raw)).filter(Boolean)
    .map((name) => ({ name, specificity: Math.min(1, .35 + name.length / 24 + Math.max(0, name.split(" ").length - 1) * .08) }));
  for (const entry of catalog) {
    for (const collector of collectors) {
      if (String(entry.normalizedNumber) !== String(collector.normalized)) continue;
      const totalMatches = collector.normalizedTotal && String(entry.printedSetTotal) === String(collector.normalizedTotal);
      add(entry.cardId, totalMatches ? 1.35 : .75, totalMatches ? "collector-and-total" : "collector-number");
    }
    if (!names.length) continue;
    const normalizedEntryName = normalizeCardName(entry.normalizedName || entry.card?.name);
    const matches = names.map(({ name, specificity }) => ({ similarity: fuzzyNameScore(name, normalizedEntryName), specificity }));
    const bestName = matches.sort((left, right) => right.similarity * right.specificity - left.similarity * left.specificity)[0];
    if (bestName?.similarity) {
      const amount = bestName.similarity === 1 ? .45 + .8 * bestName.specificity : .35 + .7 * bestName.similarity * bestName.specificity;
      add(entry.cardId, amount, bestName.similarity === 1 ? "ocr-exact-name" : "ocr-fuzzy-name");
    }
  }

  const pool = [...scores.values()].sort((left, right) => right.score - left.score || left.cardId.localeCompare(right.cardId));
  const boundedOrbLimit = Math.max(10, Math.min(24, Number(orbCandidateLimit) || DEFAULT_ORB_CANDIDATE_LIMIT));
  return {
    visualRecallLimit: boundedRecallLimit,
    orbCandidateLimit: boundedOrbLimit,
    pool,
    poolIds: pool.map(({ cardId }) => cardId),
    candidateIds: pool.slice(0, boundedOrbLimit).map(({ cardId }) => cardId),
  };
}

export async function runVisualMatching(queryCanvas, ocrMatch, {
  catalog = getScannerCatalog(),
  candidateLimit = DEFAULT_VISUAL_RECALL_LIMIT,
  orbCandidateLimit = DEFAULT_ORB_CANDIDATE_LIMIT,
  precomputedLightweight = null,
  knownWorkerRuntime = null,
  loadImageBlob = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`Candidate image HTTP ${response.status}`); return response.blob(); },
} = {}) {
  const started = performance.now(); const probeStarted = performance.now();
  const runtime = knownWorkerRuntime ?? await probeVisualWorker(); const workerProbeMs = performance.now() - probeStarted;
  const visualRecallLimit = Math.max(30, Math.min(50, Number(candidateLimit) || DEFAULT_VISUAL_RECALL_LIMIT));
  const lightweightStarted = performance.now();
  const lightweight = precomputedLightweight || await searchVisualIndex(queryCanvas, visualRecallLimit);
  const lightweightSearchMs = performance.now() - lightweightStarted;
  const byId = new Map(catalog.map((entry) => [entry.cardId, entry]));
  const shortlistStarted = performance.now();
  const shortlist = buildVisualCandidateShortlist({ lightweight, ocrMatch, catalog, visualRecallLimit, orbCandidateLimit });
  const shortlistMs = performance.now() - shortlistStarted;
  const candidateIds = shortlist.candidateIds;
  const loaded = []; const failures = []; const candidateTimings = []; const candidateLoadStarted = performance.now();
  await Promise.all(candidateIds.map(async (cardId) => {
    const imageUrl = getCardImageUrl(byId.get(cardId).card);
    try {
      const acquired = await acquireDecodedCandidateCanvas(imageUrl, loadImageBlob);
      loaded.push({ cardId, canvas: acquired.canvas, release: acquired.release });
      candidateTimings.push({ cardId, imageUrl, cacheHit: acquired.cacheHit, ...acquired.timing });
    }
    catch (error) { failures.push({ cardId, error: error.message }); }
  }));
  const candidateLoadWallMs = performance.now() - candidateLoadStarted;
  // Promise completion order is nondeterministic; restore shortlist order for
  // repeatable diagnostics and ORB tie-breaking.
  const order = new Map(candidateIds.map((cardId, index) => [cardId, index]));
  loaded.sort((left, right) => order.get(left.cardId) - order.get(right.cardId));
  candidateTimings.sort((left, right) => order.get(left.cardId) - order.get(right.cardId));
  let orb; const orbStarted = performance.now();
  try { orb = loaded.length ? await rerankWithOrb(queryCanvas, loaded) : { candidates: [], processingMs: 0 }; }
  finally { for (const item of loaded) item.release(); }
  const orbRoundTripMs = performance.now() - orbStarted;
  const trustedCandidates = candidateIds.map((cardId) => byId.get(cardId)).filter(Boolean).map((entry) => ({
    cardId: entry.cardId,
    card: entry.card,
    setId: entry.setId,
    setName: entry.setName,
    printedSetTotal: entry.printedSetTotal,
  }));
  const sumTiming = (field) => candidateTimings.reduce((total, item) => total + (item[field] || 0), 0);
  return {
    runtime,
    lightweight,
    orb,
    candidatePoolIds: shortlist.poolIds,
    candidatePool: shortlist.pool,
    candidateIds,
    trustedCandidates,
    candidateImageFailures: failures,
    timing: {
      workerProbeMs,
      workerProbeSkipped: knownWorkerRuntime != null,
      lightweightSearchMs,
      lightweightReused: Boolean(precomputedLightweight),
      shortlistMs,
      candidateLoadWallMs,
      candidateLoadWorkMs: sumTiming("totalMs"),
      candidateBlobLoadMs: sumTiming("blobLoadMs"),
      candidateDecodeMs: sumTiming("decodeMs"),
      candidateDrawMs: sumTiming("drawMs"),
      candidateCanvasCacheHits: candidateTimings.filter(({ cacheHit }) => cacheHit).length,
      candidateCanvasCacheMisses: candidateTimings.filter(({ cacheHit }) => !cacheHit).length,
      candidateCanvasCacheSize: decodedCandidateCanvasCache.size,
      candidateCanvasCacheLimit: DECODED_CANDIDATE_CACHE_LIMIT,
      orbRoundTripMs,
      orbWorkerMs: orb.processingMs || 0,
      candidateItems: candidateTimings,
    },
    totalProcessingMs: performance.now() - started,
  };
}
