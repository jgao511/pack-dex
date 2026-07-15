let worker;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./scannerVisual.worker.js", import.meta.url), { type: "module", name: "packdex-scanner-visual" });
  worker.onmessage = ({ data }) => { const request = pending.get(data.id); if (!request) return; pending.delete(data.id); data.error ? request.reject(new Error(data.error)) : request.resolve(data.result); };
  worker.onerror = (event) => { for (const request of pending.values()) request.reject(new Error(event.message || "Local visual worker failed.")); pending.clear(); };
  return worker;
}
function request(type, payload, transfer = []) {
  return new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); getWorker().postMessage({ id, type, payload }, transfer); });
}
function canvasPayload(canvas, cardId) {
  const context = canvas.getContext("2d", { willReadFrequently: true }); const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { cardId, width: image.width, height: image.height, buffer: image.data.buffer };
}
function canvasFromResult(result) {
  const canvas = document.createElement("canvas"); canvas.width = result.width; canvas.height = result.height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(result.buffer), result.width, result.height), 0, 0); return canvas;
}
export function probeVisualWorker() { return request("probe", {}); }
export function prewarmVisualWorker() { return request("prewarm", {}); }
export async function rectifyCanvas(canvas, options) { const payload = canvasPayload(canvas); const result = await request("rectify", { ...payload, options }, [payload.buffer]); return { ...result, canvas: result.buffer ? canvasFromResult(result) : null, buffer: undefined }; }
export async function beginProposalScan(canvas, options = {}) {
  const payload = canvasPayload(canvas);
  return request("begin-proposal-scan", { ...payload, options }, [payload.buffer]);
}
export async function analyzeNextProposalBatch(sessionId, { batchSize = 1, limit = 40 } = {}) {
  const result = await request("analyze-next-proposal-batch", { sessionId, batchSize, limit });
  return {
    ...result,
    proposals: result.proposals.map((proposal) => ({ ...proposal, canvas: canvasFromResult(proposal), buffer: undefined })),
  };
}
export function releaseProposalSession(sessionId) { return request("release-proposal-session", { sessionId }); }
export async function analyzeProposalCanvases(canvas, options = {}, limit = 40) {
  const payload = canvasPayload(canvas);
  const result = await request("analyze-proposals", { ...payload, options, limit }, [payload.buffer]);
  return {
    ...result,
    proposals: result.proposals.map((proposal) => ({ ...proposal, canvas: canvasFromResult(proposal), buffer: undefined })),
  };
}
export async function searchVisualIndex(canvas, limit = 10) { const payload = canvasPayload(canvas); return request("search", { ...payload, limit }, [payload.buffer]); }
export async function rerankWithOrb(queryCanvas, candidates) {
  const query = canvasPayload(queryCanvas); const items = candidates.map(({ cardId, canvas }) => canvasPayload(canvas, cardId));
  return request("orb", { query, candidates: items }, [query.buffer, ...items.map((item) => item.buffer)]);
}
export function disposeVisualWorker() { worker?.terminate(); worker = undefined; for (const request of pending.values()) request.reject(new Error("Local visual worker disposed.")); pending.clear(); }
