import { Capacitor } from "@capacitor/core";
import { getScannerCatalog } from "../../../src/lib/cardScanner/buildScannerCatalog.js";
import { isAndroidNative } from "./platform.js";
import { resolveScannerAssetUrl } from "./scannerAssetUrl.js";

export const FROZEN_A_MODEL_SHA256 = "62f2ff60cfdb09714a01fa74343e4dc1968601c2a43046979cbc548c28027c7c";
export const FROZEN_A_INDEX_SHA256 = "a851d797aef5c140d8918bb2ffa7dcafa2315cb1f0cbdb6ca4abbd91c3d61edb";
const MODEL_BYTES = 4490924;
const INDEX_BYTES = 4799232;
const DIMENSIONS = 128;
const CARD_COUNT = 18747;
let runtimePromise;

function assetUrl(path) { return resolveScannerAssetUrl(path, { baseUrl: import.meta.env.BASE_URL }); }

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Scanner checksum verification is unavailable.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function float16(value) {
  const sign = value & 0x8000 ? -1 : 1; const exponent = (value >>> 10) & 0x1f; const fraction = value & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function decodeIndex(metadata, buffer) {
  if (metadata?.schemaVersion !== 2 || metadata?.count !== CARD_COUNT || metadata?.dimensions !== DIMENSIONS || metadata?.dtype !== "float16-le" || metadata?.normalized !== true) throw new Error("Frozen scanner index metadata has an invalid tensor contract.");
  if (metadata?.vectorSha256 !== FROZEN_A_INDEX_SHA256 || metadata?.vectorBytes !== INDEX_BYTES || metadata?.model?.sha256 !== FROZEN_A_MODEL_SHA256) throw new Error("Frozen scanner model/index binding does not match the release artifacts.");
  if (!Array.isArray(metadata.cardIds) || metadata.cardIds.length !== CARD_COUNT || new Set(metadata.cardIds).size !== CARD_COUNT) throw new Error("Frozen scanner index card-ID order is invalid.");
  if (buffer.byteLength !== INDEX_BYTES) throw new Error("Frozen scanner index file size is invalid.");
  const view = new DataView(buffer); const vectors = new Float32Array(CARD_COUNT * DIMENSIONS);
  for (let index = 0; index < vectors.length; index += 1) {
    const value = float16(view.getUint16(index * 2, true));
    if (!Number.isFinite(value)) throw new Error("Frozen scanner index contains a non-finite value.");
    vectors[index] = value;
  }
  return { cardIds: metadata.cardIds, vectors, metadata };
}

async function loadIndex(fetchImpl = fetch) {
  const metadataResponse = await fetchImpl(assetUrl("catalog-embeddings.meta.json"), { cache: "force-cache" });
  if (!metadataResponse.ok) throw new Error("Frozen scanner metadata is unavailable.");
  const metadata = JSON.parse(await metadataResponse.text());
  const vectorResponse = await fetchImpl(assetUrl("catalog-embeddings-a851d797.f16"), { cache: "force-cache" });
  if (!vectorResponse.ok) throw new Error("Frozen scanner index is unavailable.");
  const buffer = await vectorResponse.arrayBuffer();
  if (await sha256Hex(buffer) !== FROZEN_A_INDEX_SHA256) throw new Error("Frozen scanner index checksum did not match.");
  return decodeIndex(metadata, buffer);
}

function normalize(values) {
  const result = Float32Array.from(values, Number); let sum = 0;
  for (const value of result) { if (!Number.isFinite(value)) throw new Error("Frozen scanner embedding contains a non-finite value."); sum += value * value; }
  const magnitude = Math.sqrt(sum); if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error("Frozen scanner embedding has no magnitude.");
  for (let index = 0; index < result.length; index += 1) result[index] /= magnitude;
  return result;
}

function search(query, index, limit = 20) {
  const embedding = normalize(query); if (embedding.length !== DIMENSIONS) throw new Error("Frozen scanner embedding dimensions did not match the catalog.");
  const best = [];
  for (let row = 0; row < CARD_COUNT; row += 1) {
    let score = 0; const offset = row * DIMENSIONS;
    for (let column = 0; column < DIMENSIONS; column += 1) score += embedding[column] * index.vectors[offset + column];
    best.push({ cardId: index.cardIds[row], score });
  }
  return best.sort((left, right) => right.score - left.score || left.cardId.localeCompare(right.cardId)).slice(0, limit);
}

function canvasToBase64(canvas) { return canvas.toDataURL("image/jpeg", .92).replace(/^data:image\/[^;]+;base64,/, ""); }

async function createBrowserEmbedder() {
  const loadScript = (file) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-packdex-frozen-a="${file}"]`);
    if (existing) { existing.addEventListener("load", resolve, { once: true }); existing.addEventListener("error", reject, { once: true }); return; }
    const script = document.createElement("script"); script.async = true; script.dataset.packdexFrozenA = file; script.src = assetUrl(file); script.onload = resolve; script.onerror = () => reject(new Error(`Frozen scanner runtime file ${file} failed to load.`)); document.head.append(script);
  });
  await loadScript("tf-core.min.js"); await loadScript("tf-backend-cpu.min.js"); await loadScript("tf-tflite.min.js");
  const tf = globalThis.tf; const tflite = globalThis.tflite;
  if (!tf?.tensor4d || !tflite?.loadTFLiteModel || !tflite?.setWasmPath) throw new Error("Frozen scanner WASM runtime did not initialize.");
  await tf.setBackend("cpu"); await tf.ready();
  tflite.setWasmPath(assetUrl("wasm/"));
  const modelResponse = await fetch(assetUrl("frozen-a-62f2ff60.tflite"), { cache: "force-cache" });
  if (!modelResponse.ok) throw new Error("Frozen scanner model is unavailable.");
  const modelBytes = await modelResponse.arrayBuffer();
  if (modelBytes.byteLength !== MODEL_BYTES || await sha256Hex(modelBytes) !== FROZEN_A_MODEL_SHA256) throw new Error("Frozen scanner model checksum did not match.");
  const model = await tflite.loadTFLiteModel(modelBytes, { numThreads: 1 });
  if (model.inputs?.[0]?.shape?.join(",") !== "1,224,224,3" || model.outputs?.[0]?.shape?.join(",") !== "1,128") throw new Error("Frozen scanner browser model tensor contract did not match.");
  return async (canvas) => {
    const inputCanvas = document.createElement("canvas"); inputCanvas.width = 224; inputCanvas.height = 224;
    inputCanvas.getContext("2d", { willReadFrequently: true }).drawImage(canvas, 0, 0, 224, 224);
    const pixels = inputCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, 224, 224).data;
    const input = new Float32Array(224 * 224 * 3);
    for (let source = 0, target = 0; source < pixels.length; source += 4) { input[target++] = pixels[source] / 255; input[target++] = pixels[source + 1] / 255; input[target++] = pixels[source + 2] / 255; }
    const tensor = tf.tensor4d(input, [1, 224, 224, 3], "float32"); const output = model.predict(tensor);
    try { return normalize(await output.data()); } finally { tensor.dispose(); output.dispose(); inputCanvas.width = 1; inputCanvas.height = 1; }
  };
}

async function createNativeEmbedder() {
  const plugin = Capacitor.Plugins?.PackDexAiEmbedder || globalThis.Capacitor?.Plugins?.PackDexAiEmbedder;
  if (!plugin?.initialize || !plugin?.embedImage) throw new Error("Frozen scanner Android bridge is unavailable.");
  const initialization = await plugin.initialize();
  if (initialization?.modelFileSha256 !== FROZEN_A_MODEL_SHA256 || initialization?.inputWidth !== 224 || initialization?.inputHeight !== 224 || initialization?.dimensions !== DIMENSIONS || initialization?.inputNormalization !== "zero-to-one") throw new Error("Frozen scanner Android model contract did not match.");
  return async (canvas) => {
    const result = await plugin.embedImage({ base64Image: canvasToBase64(canvas) });
    if (result?.modelFileSha256 !== FROZEN_A_MODEL_SHA256) throw new Error("Frozen scanner Android model checksum did not match.");
    return normalize(result?.embedding || []);
  };
}

export async function preloadFrozenAScanner({ fetchImpl = fetch } = {}) {
  if (!runtimePromise) runtimePromise = Promise.all([loadIndex(fetchImpl), isAndroidNative(Capacitor) ? createNativeEmbedder() : createBrowserEmbedder()])
    .then(([index, embed]) => ({ index, embed }));
  return runtimePromise;
}

export function resetFrozenAScannerForTests() { runtimePromise = undefined; }

export async function recognizeFrozenA(canvas, ocrMatch) {
  const started = performance.now(); const runtime = await preloadFrozenAScanner(); const candidates = search(await runtime.embed(canvas), runtime.index, 20);
  const catalog = new Map(getScannerCatalog().map((entry) => [entry.cardId, entry])); const ocrIds = new Set((ocrMatch?.results || []).map((entry) => entry.cardId));
  const results = candidates.slice(0, 3).map((candidate, index) => {
    const entry = catalog.get(candidate.cardId); if (!entry) throw new Error(`Frozen scanner index card ${candidate.cardId} is not in the trusted catalog.`);
    return { cardId: candidate.cardId, card: entry.card, setId: entry.setId, setName: entry.setName, printedSetTotal: entry.printedSetTotal, score: Math.round(candidate.score * 100), confidence: "low", reasons: ["frozen-A full-catalog cosine", ...(ocrIds.has(candidate.cardId) ? ["OCR evidence"] : [])], visualEvidence: { frozenA: candidate.score } };
  });
  return { candidates, fusedMatch: { ...(ocrMatch || {}), confidence: "low", primaryMatch: null, results, frozenA: { modelSha256: FROZEN_A_MODEL_SHA256, indexSha256: FROZEN_A_INDEX_SHA256, processingMs: performance.now() - started } } };
}
