import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { CapacitorPluginMlKitTextRecognition } from "@pantrist/capacitor-plugin-ml-kit-text-recognition";
import { getScannerCatalog } from "../../../src/lib/cardScanner/buildScannerCatalog.js";
import { extractCollectorNumbers } from "../../../src/lib/cardScanner/extractCollectorNumbers.js";
import { extractNameCandidates } from "../../../src/lib/cardScanner/extractNameCandidates.js";
import { createOcrPasses, prepareCardImage, stripDataUrlPrefix } from "../../../src/lib/cardScanner/prepareCardImage.js";
import { rectifyCanvas, rerankWithOrb } from "../../../src/lib/cardScanner/localVisual/visualWorkerClient.js";
import {
  createTypedEmbeddingIndex,
  searchEmbeddingIndex,
  summarizeEmbeddingRetrieval,
} from "../../../src/lib/cardScanner/aiVisual/embeddingSearch.js";
import { buildCatalogCandidates, createCatalogCandidateIndex } from "../../../src/lib/cardScanner/aiVisual/catalogCandidateIndex.js";
import { fuseHybridEvidence, selectBoundedOrbCandidates } from "../../../src/lib/cardScanner/aiVisual/hybridRanking.js";
import { SCANNER_AI_RUNTIME_CONFIG } from "../../../src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js";

const AI_POC_STATUS = "scanner-ai-poc";
const INDEX_METADATA_PATH = "./scanner-ai/catalog-embeddings.meta.json";
const RUNTIME_SOURCE_SHA256 = typeof __PACKDEX_SCANNER_AI_SOURCE_SHA256__ !== "undefined" ? __PACKDEX_SCANNER_AI_SOURCE_SHA256__ : null;
let preloadPromise;
let preloadedRuntime;

function getNativeEmbedder() {
  return globalThis.Capacitor?.Plugins?.PackDexAiEmbedder || globalThis.PackDexAiEmbedder || null;
}

function localArtifactUrl(relativePath, baseUrl = globalThis.location?.href || "https://localhost/") {
  const base = new URL(baseUrl);
  const url = new URL(relativePath, base);
  if (url.origin !== base.origin || !url.pathname.includes("/scanner-ai/")) {
    throw new Error("Scanner-AI artifacts must be bundled with the local application.");
  }
  return url;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Scanner-AI checksum validation is unavailable in this WebView.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function loadEmbeddingIndex({ fetchImpl = globalThis.fetch, metadataPath = INDEX_METADATA_PATH, embedder = getNativeEmbedder() } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Local scanner-AI artifact loading is unavailable.");
  const nativeAssets = Capacitor.isNativePlatform() && embedder?.getIndexAssetUrls ? await embedder.getIndexAssetUrls() : null;
  const metadataUrl = localArtifactUrl(nativeAssets?.metadataUrl || metadataPath);
  const metadataResponse = await fetchImpl(metadataUrl.href, { cache: "force-cache" });
  if (!metadataResponse.ok) throw new Error(`Bundled AI embedding metadata was not available (${metadataResponse.status}).`);
  const metadataBuffer = await metadataResponse.arrayBuffer();
  const indexMetadataSha256 = await sha256Hex(metadataBuffer);
  const metadata = JSON.parse(new TextDecoder().decode(metadataBuffer));
  if (!Array.isArray(metadata.cardIds) || !metadata.cardIdsSha256) throw new Error("Bundled AI embedding metadata is missing its ordered card-ID checksum.");
  if (!metadata.source?.catalogCardsSha256 && !metadata.catalog?.manifestSha256) throw new Error("Bundled AI embedding metadata is missing its trusted catalog checksum.");
  const cardIdsBytes = new TextEncoder().encode(`${metadata.cardIds.map(String).join("\n")}\n`);
  const cardIdsSha256 = await sha256Hex(cardIdsBytes);
  if (cardIdsSha256 !== metadata.cardIdsSha256) throw new Error("Bundled AI embedding card-ID ordering checksum did not match its metadata.");
  const vectorUrl = localArtifactUrl(nativeAssets?.vectorUrl || new URL(metadata.vectorFile || "catalog-embeddings.f16", metadataUrl).href);
  const vectorResponse = await fetchImpl(vectorUrl.href, { cache: "force-cache" });
  if (!vectorResponse.ok) throw new Error(`Bundled AI embedding vectors were not available (${vectorResponse.status}).`);
  const vectorBuffer = await vectorResponse.arrayBuffer();
  const checksum = await sha256Hex(vectorBuffer);
  if (!metadata.vectorSha256 || checksum !== metadata.vectorSha256) throw new Error("Bundled AI embedding vector checksum did not match its metadata.");
  return createTypedEmbeddingIndex({ ...metadata, indexMetadataSha256, cardIdsSha256 }, vectorBuffer);
}

function canvasBase64(canvas) {
  return stripDataUrlPrefix(canvas.toDataURL("image/jpeg", 0.92));
}

const POKEMON_CARD_ASPECT_RATIO = 63 / 88;
const CENTERED_FALLBACK_HEIGHT_FRACTION = 0.78;
const OCR_BUDGET_MS = 3_000;

function cropArea(boundary) {
  if (Number.isFinite(boundary?.metrics?.areaFraction)) return boundary.metrics.areaFraction;
  if (Number.isFinite(boundary?.crop?.retainedAreaFraction)) return boundary.crop.retainedAreaFraction;
  return 1;
}

function measureCropQuality(canvas, boundary) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let bright = 0; let topBright = 0; let samples = 0; let topSamples = 0; let lumaTotal = 0; let laplacian = 0; let laplacianSamples = 0;
  const lumaAt = (x, y) => { const i = (y * width + x) * 4; return (data[i] * 0.2126) + (data[i + 1] * 0.7152) + (data[i + 2] * 0.0722); };
  for (let y = 1; y < height - 1; y += 2) for (let x = 1; x < width - 1; x += 2) {
    const i = (y * width + x) * 4; const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const maximum = Math.max(r, g, b); const minimum = Math.min(r, g, b); const isReflective = maximum >= 238 && (maximum - minimum) <= 72;
    samples += 1; lumaTotal += (r * 0.2126) + (g * 0.7152) + (b * 0.0722); if (isReflective) bright += 1;
    if (y < height * .3) { topSamples += 1; if (isReflective) topBright += 1; }
    const center = lumaAt(x, y); laplacian += Math.abs((4 * center) - lumaAt(x - 1, y) - lumaAt(x + 1, y) - lumaAt(x, y - 1) - lumaAt(x, y + 1)); laplacianSamples += 1;
  }
  const glareFraction = bright / Math.max(1, samples); const topGlareFraction = topBright / Math.max(1, topSamples);
  return {
    cropAreaFraction: cropArea(boundary), sharpnessEstimate: laplacian / Math.max(1, laplacianSamples), meanLuminance: lumaTotal / Math.max(1, samples), glareFraction, topGlareFraction,
    glareWarning: glareFraction >= .005 || topGlareFraction >= .004,
  };
}

function dimReflectiveHighlights(source) {
  const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext("2d"); context.filter = "brightness(.84) contrast(1.16) saturate(.92)";
  context.drawImage(source, 0, 0); context.filter = "none";
  return canvas;
}

function withinBudget(promise, milliseconds) {
  let timeout;
  return new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("ocr-budget-exhausted")), milliseconds);
    Promise.resolve(promise).then(resolve, reject);
  }).finally(() => clearTimeout(timeout));
}

function centeredPokemonCardFallback(sourceCanvas) {
  const cropHeight = Math.round(sourceCanvas.height * CENTERED_FALLBACK_HEIGHT_FRACTION);
  const cropWidth = Math.round(cropHeight * POKEMON_CARD_ASPECT_RATIO);
  if (!(cropWidth > 0 && cropHeight > 0 && cropWidth <= sourceCanvas.width && cropHeight <= sourceCanvas.height)) return null;
  const x = Math.round((sourceCanvas.width - cropWidth) / 2);
  const y = Math.round((sourceCanvas.height - cropHeight) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 500; canvas.height = 700;
  canvas.getContext("2d").drawImage(sourceCanvas, x, y, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  return {
    canvas,
    diagnostics: {
      found: false,
      fallback: "centered-pokemon-card-aspect",
      source: "unchanged-full-frame",
      crop: { x, y, width: cropWidth, height: cropHeight, retainedAreaFraction: (cropWidth * cropHeight) / (sourceCanvas.width * sourceCanvas.height) },
    },
  };
}

async function prepareScanForAi(image, { foilMode = false } = {}) {
  const started = performance.now();
  const prepared = await prepareCardImage(image, {
    includePasses: false,
    maxEdge: 1800,
    // A scanner File is already resident in this WebView. Android WebView
    // cannot reliably re-fetch its blob: URL, so retain that input locally.
    fetchImpl: (url) => scannerAiFetch(url, image.scannerInputBlob),
    rectify: async ({ outlineCanvas, fullCanvas, mappedCrop }) => {
      try {
        const result = await rectifyCanvas(outlineCanvas, { output: { width: 500, height: 700 } });
        if (result?.detection?.found && result.canvas) return { canvas: result.canvas, diagnostics: result.detection };
        // Only recover the demonstrated detector miss: no mapped camera outline
        // and no actual rectified boundary crop (or an unchanged full frame).
        const unchangedFullFrame = !result?.canvas || result.canvas === fullCanvas
          || (result.canvas.width === fullCanvas.width && result.canvas.height === fullCanvas.height);
        if (!mappedCrop && unchangedFullFrame) return centeredPokemonCardFallback(fullCanvas);
        return null;
      } catch {
        return null;
      }
    },
  });
  const quality = measureCropQuality(prepared.canvas, prepared.boundaryDiagnostics);
  const canvas = foilMode === "dim-highlights" && quality.glareWarning ? dimReflectiveHighlights(prepared.canvas) : prepared.canvas;
  return { ...prepared, canvas, scanQuality: quality, foilModeApplied: canvas !== prepared.canvas ? "dim-highlights" : null, base64Image: canvasBase64(canvas), aiPreparationMs: performance.now() - started };
}

async function recognizeEarlyOcr(canvas, options = {}) {
  const started = performance.now();
  if (options.ocrEvidence) return { ...options.ocrEvidence, processingMs: performance.now() - started, injected: true };
  const labels = options.ocrLabels || SCANNER_AI_RUNTIME_CONFIG.ocr.labels;
  const passes = createOcrPasses(canvas, { labels });
  const results = [];
  let error = null;
  let timedOut = false;
  for (const pass of passes) {
    const passStarted = performance.now();
    try {
      const remaining = Math.max(0, (options.ocrBudgetMs ?? OCR_BUDGET_MS) - (performance.now() - started));
      if (!remaining) { timedOut = true; break; }
      const recognition = options.ocrRecognizer
        ? options.ocrRecognizer({ ...pass })
        : CapacitorPluginMlKitTextRecognition.detectText({ base64Image: pass.base64Image, rotation: 0 });
      const detected = await withinBudget(recognition, remaining);
      results.push({
        label: pass.label,
        text: detected?.text || detected?.fullText || "",
        blocks: detected?.blocks || detected?.textBlocks || [],
        diagnosticImage: options.includeDiagnostics ? `data:image/jpeg;base64,${pass.base64Image}` : null,
        processingMs: performance.now() - passStarted,
      });
    } catch (cause) {
      if (String(cause?.message || cause) === "ocr-budget-exhausted") { timedOut = true; break; }
      error ||= cause?.message || String(cause);
      results.push({ label: pass.label, text: "", blocks: [], processingMs: performance.now() - passStarted, error: cause?.message || String(cause) });
    } finally {
      pass.base64Image = "";
    }
  }
  const rawText = results.map(({ text }) => text).filter(Boolean).join("\n");
  const textBlocks = results.flatMap((pass) => pass.blocks.map((block) => ({ ...block, sourcePass: pass.label })));
  return {
    rawText,
    textBlocks,
    passes: results,
    nameCandidates: extractNameCandidates(rawText, textBlocks),
    collectorNumbers: extractCollectorNumbers(rawText, textBlocks),
    error, timedOut,
    processingMs: performance.now() - started,
  };
}

async function initializeEmbedder(embedder) {
  if (!embedder?.embedImage) throw new Error("Native PackDexAiEmbedder bridge is not available in this build.");
  const result = await embedder.initialize?.();
  return result || { ready: true };
}

async function initializeBundledOcr(options = {}) {
  if (!Capacitor.isNativePlatform() && !options.ocrRecognizer) {
    return { ready: true, skipped: true, warmupMs: 0 };
  }
  const recognize = options.ocrRecognizer
    ? (payload) => options.ocrRecognizer({ label: "scanner-open-warmup", ...payload })
    : (payload) => CapacitorPluginMlKitTextRecognition.detectText(payload);
  if (typeof document === "undefined") throw new Error("Bundled OCR warmup requires the scanner document.");
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const started = performance.now();
  await recognize({ base64Image: stripDataUrlPrefix(canvas.toDataURL("image/jpeg", 0.8)), rotation: 0, warmup: true });
  canvas.width = 1;
  canvas.height = 1;
  return { ready: true, skipped: false, warmupMs: performance.now() - started };
}

function validateRuntimeArtifacts(index, initialization, catalog, { requireComplete = false } = {}) {
  const declaredModelSha256 = index.model?.fileSha256 || index.model?.sha256 || null;
  if (declaredModelSha256 && initialization?.modelFileSha256 !== declaredModelSha256) {
    throw new Error("Bundled scanner-AI model checksum does not match the embedding index.");
  }
  if (initialization?.dimensions && Number(index.dimensions) !== Number(initialization.dimensions)) {
    throw new Error("Bundled scanner-AI model output dimensions do not match the embedding index.");
  }
  const trustedIds = new Set(catalog.map(({ cardId }) => cardId));
  const indexIds = index.cardIds || index.cards?.map(({ cardId }) => cardId) || [];
  const unknownId = indexIds.find((cardId) => !trustedIds.has(cardId));
  if (unknownId) throw new Error(`Embedding index contains an untrusted card ID: ${unknownId}.`);
  if (requireComplete && (indexIds.length !== trustedIds.size || new Set(indexIds).size !== trustedIds.size)) {
    throw new Error(`Bundled AI index does not exactly cover the ${trustedIds.size} trusted catalog card IDs.`);
  }
}

/** Starts only from the hidden scanner-AI page. All artifact reads finish or are
 * already in flight before runAiScannerPoc accepts a scan. */
export function preloadAiScannerPoc(options = {}) {
  if (preloadedRuntime && !options.force) return Promise.resolve(preloadedRuntime);
  if (preloadPromise && !options.force) return preloadPromise;
  const started = performance.now();
  const embedder = options.embedder || getNativeEmbedder();
  const catalog = options.catalog || getScannerCatalog();
  preloadPromise = Promise.all([
    options.index ? Promise.resolve(options.index) : loadEmbeddingIndex({ ...options, embedder }),
    initializeEmbedder(embedder),
    initializeBundledOcr(options),
  ]).then(([index, initialization, ocrInitialization]) => {
    validateRuntimeArtifacts(index, initialization, catalog, { requireComplete: !options.index });
    preloadedRuntime = {
      index,
      embedder,
      catalog,
      candidateIndex: options.candidateIndex || createCatalogCandidateIndex(catalog),
      orbReferenceCache: options.orbReferenceCache || null,
      initialization,
      ocrInitialization,
      preloadMs: performance.now() - started,
      preloadedAt: Date.now(),
    };
    return preloadedRuntime;
  }).catch((error) => {
    preloadPromise = undefined;
    throw error;
  });
  return preloadPromise;
}

export function resetAiScannerPocPreloadForTests() {
  preloadPromise = undefined;
  preloadedRuntime = undefined;
}

async function requirePreloadedRuntime(options) {
  if (options.index) {
    const embedder = options.embedder || getNativeEmbedder();
    const initialization = await initializeEmbedder(embedder);
    const catalog = options.catalog || getScannerCatalog();
    validateRuntimeArtifacts(options.index, initialization, catalog);
    return {
      index: options.index,
      embedder,
      catalog,
      candidateIndex: options.candidateIndex || createCatalogCandidateIndex(catalog),
      orbReferenceCache: options.orbReferenceCache || null,
      initialization,
      preloadMs: 0,
    };
  }
  if (preloadedRuntime) return preloadedRuntime;
  if (preloadPromise) return preloadPromise;
  throw new Error("Scanner-AI model and index were not preloaded when the Scanner opened.");
}

async function embedBase64(base64Image, embedder, { includeDiagnostics = false } = {}) {
  const result = await embedder.embedImage({ base64Image, includeInputDiagnostics: includeDiagnostics });
  return {
    embedding: result?.embedding || null,
    diagnostics: {
      initMs: result?.initMs ?? null,
      inferenceMs: result?.inferenceMs ?? null,
      dimensions: result?.dimensions ?? null,
      l2Norm: result?.l2Norm ?? null,
      modelFileSha256: result?.modelFileSha256 ?? null,
      modelInputPngBase64: result?.modelInputPngBase64 ?? null,
    },
  };
}

async function runCachedOrb(queryCanvas, gate, referenceCache) {
  const started = performance.now();
  if (!gate.shouldRun) return { ...gate, ran: false, processingMs: 0, candidates: [] };
  if (!SCANNER_AI_RUNTIME_CONFIG.ranking.orbEnabled) {
    return { ...gate, ran: false, reason: "offline-reference-descriptor-cache-unavailable", processingMs: 0, candidates: [] };
  }
  if (!referenceCache?.has || !referenceCache?.get) {
    return { ...gate, ran: false, reason: "offline-reference-cache-unavailable", processingMs: 0, candidates: [] };
  }
  const references = gate.candidateIds.filter((cardId) => referenceCache.has(cardId)).map((cardId) => ({ cardId, canvas: referenceCache.get(cardId) }));
  if (references.some(({ canvas }) => !canvas || typeof canvas.then === "function")) {
    return { ...gate, ran: false, reason: "offline-reference-cache-invalid", processingMs: 0, candidates: [] };
  }
  if (references.length < SCANNER_AI_RUNTIME_CONFIG.ranking.orbMinCandidates) {
    return { ...gate, ran: false, reason: "offline-reference-cache-incomplete", processingMs: 0, candidates: [] };
  }
  const result = await rerankWithOrb(queryCanvas, references);
  return { ...gate, ran: true, processingMs: performance.now() - started, workerMs: result.processingMs || 0, candidates: result.candidates || [] };
}

export async function runAiScannerPoc(image, options = {}) {
  const startedAt = performance.now();
  let prepared;
  let runtime;
  let ocr = { rawText: "", nameCandidates: [], collectorNumbers: [], processingMs: 0 };
  let candidatePool;
  let embeddingResult;
  let visualCandidates = [];
  let orb = { ran: false, reason: "not-evaluated", candidates: [], processingMs: 0 };
  let fused = { confidence: "low", confirmedCardId: null, safeNoResult: true, primaryMatch: null, results: [] };
  const timing = { preparationMs: null, ocrMs: 0, candidateBuildMs: 0, modelInitMs: null, inferenceMs: null, candidateSearchMs: 0, fusionMs: 0, orbMs: 0 };
  try {
    runtime = await requirePreloadedRuntime(options);
    prepared = options.preparedScan || await prepareScanForAi(image, options);
    timing.preparationMs = prepared.aiPreparationMs;

    ocr = await recognizeEarlyOcr(prepared.canvas, options);
    timing.ocrMs = ocr.processingMs || 0;
    const candidateStarted = performance.now();
    candidatePool = options.candidatePool || buildCatalogCandidates(runtime.candidateIndex, {
      nameCandidates: ocr.nameCandidates,
      collectorNumbers: ocr.collectorNumbers,
      setId: options.setId,
      setIds: options.setIds,
    });
    timing.candidateBuildMs = performance.now() - candidateStarted;

    embeddingResult = await embedBase64(prepared.base64Image, runtime.embedder, options);
    timing.modelInitMs = embeddingResult.diagnostics.initMs;
    timing.inferenceMs = embeddingResult.diagnostics.inferenceMs;
    const searchStarted = performance.now();
    const visualLimit = candidatePool.usedFullCatalogFallback
      ? SCANNER_AI_RUNTIME_CONFIG.search.fullCatalogLimit
      : Math.min(candidatePool.candidateIds.length, SCANNER_AI_RUNTIME_CONFIG.search.narrowedPoolLimit);
    visualCandidates = searchEmbeddingIndex(embeddingResult.embedding, runtime.index, {
      candidateIds: candidatePool.candidateIds,
      limit: Math.max(1, visualLimit),
    });
    timing.candidateSearchMs = performance.now() - searchStarted;

    const fusionStarted = performance.now();
    fused = fuseHybridEvidence({ visualCandidates, candidatePool, catalog: runtime.catalog });
    timing.fusionMs += performance.now() - fusionStarted;
    const orbGate = selectBoundedOrbCandidates({ visualCandidates, candidatePool });
    orb = await runCachedOrb(prepared.canvas, orbGate, options.orbReferenceCache || runtime.orbReferenceCache);
    timing.orbMs = orb.processingMs || 0;
    if (orb.ran) {
      const finalFusionStarted = performance.now();
      fused = fuseHybridEvidence({ visualCandidates, candidatePool, orbCandidates: orb.candidates, catalog: runtime.catalog });
      timing.fusionMs += performance.now() - finalFusionStarted;
    }
  } catch (error) {
    return {
      status: "scanner-ai-poc-unavailable",
      architecture: "offline OCR-narrowed native embedding hybrid",
      configVersion: SCANNER_AI_RUNTIME_CONFIG.configVersion,
      runtimeSourceSha256: RUNTIME_SOURCE_SHA256,
      modelAvailable: false,
      indexAvailable: false,
      error: error?.message || String(error),
      result: fused,
      ocr: { rawText: ocr.rawText || "", nameCandidates: ocr.nameCandidates || [], collectorNumbers: ocr.collectorNumbers || [], error: ocr.error || null },
      timing: { ...timing, totalMs: Math.round(performance.now() - startedAt) },
    };
  }

  const indexCount = runtime.index.count || runtime.index.cards?.length || 0;
  return {
    status: AI_POC_STATUS,
    architecture: "rectified image -> early local OCR -> trusted catalog narrowing -> one native embedding -> local cosine -> evidence fusion -> optional cached 3-5 card ORB",
    configVersion: SCANNER_AI_RUNTIME_CONFIG.configVersion,
    runtimeSourceSha256: RUNTIME_SOURCE_SHA256,
    modelAvailable: Boolean(embeddingResult?.embedding?.length),
    indexAvailable: indexCount > 0,
    indexMetadata: {
      modelVersion: runtime.index.modelVersion || runtime.index.model?.version || null,
      modelFileSha256: embeddingResult.diagnostics.modelFileSha256 || runtime.initialization?.modelFileSha256 || null,
      indexVersion: runtime.index.indexVersion || null,
      vectorSha256: runtime.index.vectorSha256 || null,
      indexMetadataSha256: runtime.index.indexMetadataSha256 || null,
      catalogMetadataSha256: runtime.index.metadataSha256 || null,
      catalogCardsSha256: runtime.index.source?.catalogCardsSha256 || runtime.index.catalog?.manifestSha256 || null,
      cardIdsSha256: runtime.index.cardIdsSha256 || null,
      dimensions: runtime.index.dimensions || null,
      cardCount: indexCount,
      dtype: runtime.index.dtype || "json-float32",
    },
    ocr: {
      rawText: ocr.rawText || "",
      nameCandidates: (ocr.nameCandidates || []).map(({ raw, normalized, sourcePass, reliable }) => ({ raw, normalized, sourcePass, reliable })),
      collectorNumbers: (ocr.collectorNumbers || []).map(({ raw, normalized, normalizedTotal, sourcePass, reliable }) => ({ raw, normalized, normalizedTotal, sourcePass, reliable })),
      error: ocr.error || null,
      timedOut: Boolean(ocr.timedOut),
    },
    candidatePool: {
      mode: candidatePool.mode,
      size: candidatePool.candidateIds.length,
      usedFullCatalogFallback: candidatePool.usedFullCatalogFallback,
      stats: candidatePool.stats,
      ...(options.includeCandidateIds ? { candidateIds: candidatePool.candidateIds } : {}),
    },
    visualRanking: visualCandidates.map(({ cardId, visualScore }) => ({ cardId, visualScore })),
    retrieval: summarizeEmbeddingRetrieval(visualCandidates),
    orb: {
      ran: orb.ran,
      reason: orb.reason,
      candidateIds: orb.candidateIds || [],
      candidates: orb.candidates || [],
    },
    result: fused,
    scanQuality: {
      ...prepared.scanQuality,
      foilModeApplied: prepared.foilModeApplied,
      glareAdvice: prepared.scanQuality?.glareWarning ? "Reflection may obscure the card name. Tilt the card or reduce overhead glare, then retake." : null,
      progressiveResult: Boolean(ocr.timedOut),
      userGuidance: ocr.timedOut ? "Scan budget reached; review the candidates or retake with less glare." : null,
    },
    ...(options.includeDiagnostics ? {
      diagnostics: {
        uprightInput: prepared.originalPreviewUrl,
        detectedCardCrop: prepared.previewUrl,
        outlineInput: prepared.outlinePreviewUrl,
        boundary: prepared.boundaryDiagnostics,
        ocrRegions: ocr.passes.map(({ label, diagnosticImage, width, height }) => ({ label, image: diagnosticImage, width, height })),
        finalModelInput: embeddingResult.diagnostics.modelInputPngBase64 ? `data:image/png;base64,${embeddingResult.diagnostics.modelInputPngBase64}` : null,
      },
    } : {}),
    ...(options.includeEmbedding ? { queryEmbedding: embeddingResult.embedding || [] } : {}),
    error: null,
    timing: { ...timing, totalMs: Math.round(performance.now() - startedAt) },
  };
}

async function prepareCatalogCardForAi(card) {
  const temporaryImage = { imageUrl: card.imageUrl };
  const prepared = await prepareCardImage(temporaryImage, { includePasses: false, maxEdge: 700, fetchImpl: scannerAiFetch });
  return { ...prepared, base64Image: canvasBase64(prepared.canvas) };
}

async function scannerAiFetch(url, scannerInputBlob = null) {
  // The scanner-only File bridge provides its original Blob directly. This
  // avoids attempting either CapacitorHttp or WebView fetch against blob:.
  if (scannerInputBlob instanceof Blob) return { blob: async () => scannerInputBlob };
  if (!Capacitor.isNativePlatform() || /^(?:blob|data):/i.test(String(url))) return fetch(url);
  const response = await CapacitorHttp.get({ url, responseType: "blob", connectTimeout: 10_000, readTimeout: 20_000 });
  if (response.status < 200 || response.status >= 300 || typeof response.data !== "string") throw new Error(`Candidate image HTTP ${response.status}`);
  const binary = atob(response.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { blob: async () => new Blob([bytes], { type: response.headers?.["Content-Type"] || response.headers?.["content-type"] || "image/png" }) };
}

/** Development-only generic baseline index builder. It may access trusted
 * catalog assets before benchmarking; runAiScannerPoc itself never calls it. */
export async function buildAiSmokeIndex(cards, options = {}) {
  const startedAt = performance.now();
  const embedder = options.embedder || getNativeEmbedder();
  await initializeEmbedder(embedder);
  const indexCards = [];
  const timings = [];
  const errors = [];
  for (const card of cards) {
    const itemStarted = performance.now();
    try {
      const prepared = await prepareCatalogCardForAi(card);
      const embedded = await embedBase64(prepared.base64Image, embedder);
      if (embedded.embedding?.length) indexCards.push({ cardId: card.cardId, embedding: embedded.embedding });
      timings.push({ cardId: card.cardId, totalMs: performance.now() - itemStarted, inferenceMs: embedded.diagnostics?.inferenceMs ?? null });
    } catch (error) {
      errors.push({ cardId: card.cardId, imageUrl: card.imageUrl, error: error?.message || String(error) });
      timings.push({ cardId: card.cardId, totalMs: performance.now() - itemStarted, inferenceMs: null, error: error?.message || String(error) });
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
