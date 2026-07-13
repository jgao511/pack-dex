import { getScannerCatalog } from "../buildScannerCatalog.js";
import { normalizeCardName } from "../normalizeScannerText.js";
import { getCardImageUrl } from "../../../utils/assetUrls.js";
import { probeVisualWorker, rerankWithOrb, searchVisualIndex } from "./visualWorkerClient.js";

const DEFAULT_VISUAL_RECALL_LIMIT = 40;
const DEFAULT_ORB_CANDIDATE_LIMIT = 20;

async function imageUrlToCanvas(imageUrl, loadImageBlob, maxEdge = 520) {
  const bitmap = await createImageBitmap(await loadImageBlob(imageUrl), { imageOrientation: "none" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.(); return canvas;
}

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
  loadImageBlob = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`Candidate image HTTP ${response.status}`); return response.blob(); },
} = {}) {
  const started = performance.now(); const runtime = await probeVisualWorker();
  const visualRecallLimit = Math.max(30, Math.min(50, Number(candidateLimit) || DEFAULT_VISUAL_RECALL_LIMIT));
  const lightweight = precomputedLightweight || await searchVisualIndex(queryCanvas, visualRecallLimit);
  const byId = new Map(catalog.map((entry) => [entry.cardId, entry]));
  const shortlist = buildVisualCandidateShortlist({ lightweight, ocrMatch, catalog, visualRecallLimit, orbCandidateLimit });
  const candidateIds = shortlist.candidateIds;
  const loaded = []; const failures = [];
  await Promise.all(candidateIds.map(async (cardId) => {
    try { loaded.push({ cardId, canvas: await imageUrlToCanvas(getCardImageUrl(byId.get(cardId).card), loadImageBlob) }); }
    catch (error) { failures.push({ cardId, error: error.message }); }
  }));
  // Promise completion order is nondeterministic; restore shortlist order for
  // repeatable diagnostics and ORB tie-breaking.
  const order = new Map(candidateIds.map((cardId, index) => [cardId, index]));
  loaded.sort((left, right) => order.get(left.cardId) - order.get(right.cardId));
  let orb;
  try { orb = loaded.length ? await rerankWithOrb(queryCanvas, loaded) : { candidates: [], processingMs: 0 }; }
  finally { for (const item of loaded) { item.canvas.width = 0; item.canvas.height = 0; } }
  return {
    runtime,
    lightweight,
    orb,
    candidatePoolIds: shortlist.poolIds,
    candidatePool: shortlist.pool,
    candidateIds,
    candidateImageFailures: failures,
    totalProcessingMs: performance.now() - started,
  };
}
