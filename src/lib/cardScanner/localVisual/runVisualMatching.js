import { getScannerCatalog } from "../buildScannerCatalog.js";
import { getCardImageUrl } from "../../../utils/assetUrls.js";
import { probeVisualWorker, rerankWithOrb, searchVisualIndex } from "./visualWorkerClient.js";

async function imageUrlToCanvas(imageUrl, loadImageBlob, maxEdge = 520) {
  const bitmap = await createImageBitmap(await loadImageBlob(imageUrl), { imageOrientation: "none" });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.(); return canvas;
}

export async function runVisualMatching(queryCanvas, ocrMatch, { catalog = getScannerCatalog(), candidateLimit = 8, loadImageBlob = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`Candidate image HTTP ${response.status}`); return response.blob(); } } = {}) {
  const started = performance.now(); const runtime = await probeVisualWorker();
  const lightweight = await searchVisualIndex(queryCanvas, Math.max(candidateLimit, 10));
  const byId = new Map(catalog.map((entry) => [entry.cardId, entry]));
  const candidateIds = [...new Set([...lightweight.candidates.slice(0, candidateLimit).map(({ cardId }) => cardId), ...(ocrMatch?.results || []).slice(0, 3).map(({ cardId }) => cardId)])].filter((cardId) => byId.has(cardId)).slice(0, 10);
  const loaded = []; const failures = [];
  await Promise.all(candidateIds.map(async (cardId) => {
    try { loaded.push({ cardId, canvas: await imageUrlToCanvas(getCardImageUrl(byId.get(cardId).card), loadImageBlob) }); }
    catch (error) { failures.push({ cardId, error: error.message }); }
  }));
  const orb = loaded.length ? await rerankWithOrb(queryCanvas, loaded) : { candidates: [], processingMs: 0 };
  return { runtime, lightweight, orb, candidateIds, candidateImageFailures: failures, totalProcessingMs: performance.now() - started };
}
