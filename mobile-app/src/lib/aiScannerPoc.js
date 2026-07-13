import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { getScannerCatalog } from "../../../src/lib/cardScanner/buildScannerCatalog.js";
import { prepareCardImage, stripDataUrlPrefix } from "../../../src/lib/cardScanner/prepareCardImage.js";
import { rectifyCanvas } from "../../../src/lib/cardScanner/localVisual/visualWorkerClient.js";
import { searchEmbeddingIndex, summarizeEmbeddingRetrieval } from "../../../src/lib/cardScanner/aiVisual/embeddingSearch.js";

const AI_POC_STATUS = "scanner-ai-poc";

function getNativeEmbedder() {
  return globalThis.Capacitor?.Plugins?.PackDexAiEmbedder || globalThis.PackDexAiEmbedder || null;
}

async function loadEmbeddingIndex() {
  const response = await fetch("./scanner-ai/catalog-embeddings.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`AI embedding index was not available (${response.status}).`);
  return response.json();
}

function canvasBase64(canvas) {
  return stripDataUrlPrefix(canvas.toDataURL("image/jpeg", 0.92));
}

async function prepareScanForAi(image) {
  const started = performance.now();
  const prepared = await prepareCardImage(image, {
    includePasses: false,
    maxEdge: 1800,
    rectify: async ({ outlineCanvas }) => {
      try {
        const result = await rectifyCanvas(outlineCanvas, { output: { width: 500, height: 700 } });
        return result?.canvas ? { canvas: result.canvas, diagnostics: result.diagnostics || null } : null;
      } catch {
        return null;
      }
    },
  });
  return {
    ...prepared,
    base64Image: canvasBase64(prepared.canvas),
    aiPreparationMs: performance.now() - started,
  };
}

async function prepareCatalogCardForAi(card) {
  const temporaryImage = { imageUrl: card.imageUrl };
  const prepared = await prepareCardImage(temporaryImage, { includePasses: false, maxEdge: 700, fetchImpl: scannerAiFetch });
  return {
    ...prepared,
    base64Image: canvasBase64(prepared.canvas),
  };
}

async function scannerAiFetch(url) {
  if (!Capacitor.isNativePlatform()) return fetch(url);
  const response = await CapacitorHttp.get({ url, responseType: "blob", connectTimeout: 10_000, readTimeout: 20_000 });
  if (response.status < 200 || response.status >= 300 || typeof response.data !== "string") {
    throw new Error(`Candidate image HTTP ${response.status}`);
  }
  const binary = atob(response.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return {
    blob: async () => new Blob([bytes], { type: response.headers?.["Content-Type"] || response.headers?.["content-type"] || "image/png" }),
  };
}

async function embedBase64(base64Image, embedder = getNativeEmbedder()) {
  if (!embedder?.embedImage) {
    return { available: false, embedding: null, reason: "Native PackDexAiEmbedder bridge is not available in this build." };
  }
  await embedder.initialize?.();
  const result = await embedder.embedImage({ base64Image });
  return {
    available: true,
    embedding: result?.embedding || null,
    diagnostics: {
      ...(result?.diagnostics || {}),
      initMs: result?.initMs ?? null,
      inferenceMs: result?.inferenceMs ?? null,
      dimensions: result?.dimensions ?? null,
      l2Norm: result?.l2Norm ?? null,
    },
  };
}

export async function runAiScannerPoc(image, options = {}) {
  const startedAt = performance.now();
  const catalog = getScannerCatalog();
  let index = null;
  let embeddingResult = null;
  let candidates = [];
  let status = AI_POC_STATUS;
  let prepared = null;
  let indexSearchMs = 0;

  try {
    prepared = await prepareScanForAi(image);
    [index, embeddingResult] = await Promise.all([
      options.index ? Promise.resolve(options.index) : loadEmbeddingIndex(),
      embedBase64(prepared.base64Image, options.embedder),
    ]);

    if (embeddingResult.embedding) {
      const searchStarted = performance.now();
      candidates = searchEmbeddingIndex(embeddingResult.embedding, index, { limit: options.limit || 20 });
      indexSearchMs = performance.now() - searchStarted;
    } else {
      status = "scanner-ai-poc-unavailable";
    }
  } catch (error) {
    status = "scanner-ai-poc-unavailable";
    embeddingResult = { available: false, reason: error?.message || String(error) };
  }

  const catalogById = new Map(catalog.map((entry) => [entry.cardId, entry]));
  const results = candidates.map((candidate) => {
    const catalogEntry = catalogById.get(candidate.cardId);
    return {
      ...candidate,
      name: catalogEntry?.name || null,
      setName: catalogEntry?.setName || null,
      collectorNumber: catalogEntry?.cardNumber || null,
    };
  });

  return {
    status,
    architecture: "scanner-test-only native image embedding POC",
    modelAvailable: Boolean(embeddingResult?.available && embeddingResult?.embedding),
    indexAvailable: Boolean(index?.cards?.length),
    indexMetadata: index ? {
      modelVersion: index.modelVersion || null,
      indexVersion: index.indexVersion || null,
      dimensions: index.dimensions || null,
      cardCount: index.cards?.length || 0,
    } : null,
    retrieval: summarizeEmbeddingRetrieval(results),
    result: {
      confidence: "low",
      results,
    },
    ...(options.includeEmbedding ? { queryEmbedding: embeddingResult?.embedding || [] } : {}),
    error: embeddingResult?.reason || null,
    timing: {
      preparationMs: prepared?.aiPreparationMs ?? null,
      modelInitMs: embeddingResult?.diagnostics?.initMs ?? null,
      inferenceMs: embeddingResult?.diagnostics?.inferenceMs ?? null,
      indexSearchMs,
      totalMs: Math.round(performance.now() - startedAt),
    },
  };
}

export async function buildAiSmokeIndex(cards, options = {}) {
  const startedAt = performance.now();
  const embedder = options.embedder || getNativeEmbedder();
  const indexCards = [];
  const timings = [];
  const errors = [];
  for (const card of cards) {
    const itemStarted = performance.now();
    try {
      const prepared = await prepareCatalogCardForAi(card);
      const embedded = await embedBase64(prepared.base64Image, embedder);
      if (embedded.embedding?.length) {
        indexCards.push({ cardId: card.cardId, embedding: embedded.embedding });
      }
      timings.push({
        cardId: card.cardId,
        totalMs: performance.now() - itemStarted,
        inferenceMs: embedded.diagnostics?.inferenceMs ?? null,
      });
    } catch (error) {
      errors.push({ cardId: card.cardId, imageUrl: card.imageUrl, error: error?.message || String(error) });
      timings.push({
        cardId: card.cardId,
        totalMs: performance.now() - itemStarted,
        inferenceMs: null,
        error: error?.message || String(error),
      });
    }
  }
  return {
    schemaVersion: 1,
    mode: "scanner-ai-smoke-index",
    modelVersion: "mediapipe-mobilenet-v3-small-float32-latest",
    indexVersion: `smoke-${new Date().toISOString()}`,
    dimensions: indexCards[0]?.embedding?.length || 0,
    cards: indexCards,
    errors,
    timings,
    totalMs: performance.now() - startedAt,
  };
}
