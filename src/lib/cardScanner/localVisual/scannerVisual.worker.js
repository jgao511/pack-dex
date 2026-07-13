import visualIndex from "../generated/scannerVisualIndex.json";
import { detectCardBoundary, rectifyCardPerspective } from "./cardBoundary.js";
import { generateCardProposals, releaseCardProposals } from "./cardProposals.js";
import { loadOpenCv, inspectOpenCvCapabilities } from "./opencvRuntime.js";
import { calculateVisualDescriptorFromRgba, compareVisualDescriptors, scoreVisualDescriptors, scoreVisualDescriptorsCoarse } from "./visualDescriptors.js";

const visualIndexEntries = Object.entries(visualIndex.cards);

function post(id, result, transfer = []) { self.postMessage({ id, result }, transfer); }
function postError(id, error) { self.postMessage({ id, error: String(error?.message || error) }); }
function rgbaMat(cv, payload) { return cv.matFromArray(payload.height, payload.width, cv.CV_8UC4, new Uint8Array(payload.buffer)); }
function orbFeatures(cv, source) {
  const gray = new cv.Mat(); const mask = new cv.Mat(); const keypoints = new cv.KeyPointVector(); const descriptors = new cv.Mat(); const orb = new cv.ORB(700);
  try { cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY); orb.detectAndCompute(gray, mask, keypoints, descriptors); return { keypoints, descriptors }; }
  catch (error) { keypoints.delete(); descriptors.delete(); throw error; }
  finally { orb.delete(); mask.delete(); gray.delete(); }
}
function deleteFeatures(features) { features?.keypoints?.delete(); features?.descriptors?.delete(); }
function searchDescriptor(descriptor, limit) {
  const coarseLimit = Math.max(640, limit * 16);
  const heap = [];
  const swap = (left, right) => { [heap[left], heap[right]] = [heap[right], heap[left]]; };
  const siftUp = (start) => { let index = start; while (index > 0) { const parent = Math.floor((index - 1) / 2); if (heap[parent].score <= heap[index].score) break; swap(parent, index); index = parent; } };
  const siftDown = () => { let index = 0; while (true) { const left = index * 2 + 1; const right = left + 1; let smallest = index; if (left < heap.length && heap[left].score < heap[smallest].score) smallest = left; if (right < heap.length && heap[right].score < heap[smallest].score) smallest = right; if (smallest === index) break; swap(index, smallest); index = smallest; } };
  for (const [cardId, candidate] of visualIndexEntries) {
    const score = scoreVisualDescriptorsCoarse(descriptor, candidate);
    if (heap.length < coarseLimit) { heap.push({ cardId, candidate, score }); siftUp(heap.length - 1); }
    else if (score > heap[0].score) { heap[0] = { cardId, candidate, score }; siftDown(); }
  }
  return heap.map((item) => ({ ...item, score: scoreVisualDescriptors(descriptor, item.candidate) }))
    .sort((a, b) => b.score - a.score || a.cardId.localeCompare(b.cardId)).slice(0, limit)
    .map(({ cardId, candidate }) => ({ cardId, ...compareVisualDescriptors(descriptor, candidate) }));
}
function orbScore(cv, query, candidate) {
  if (query.descriptors.empty() || candidate.descriptors.empty()) return { score: 0, goodMatches: 0, inliers: 0 };
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false); const matches = new cv.DMatchVectorVector();
  let sourcePoints; let destinationPoints; let mask; let homography;
  try {
    matcher.knnMatch(query.descriptors, candidate.descriptors, matches, 2); const good = [];
    for (let index = 0; index < matches.size(); index += 1) { const row = matches.get(index); if (row.size() >= 2 && row.get(0).distance < .75 * row.get(1).distance) good.push(row.get(0)); row.delete?.(); }
    if (good.length < 4) return { score: Math.min(.12, good.length / 30), goodMatches: good.length, inliers: 0 };
    const from = []; const to = [];
    for (const match of good) { const a = query.keypoints.get(match.queryIdx).pt; const b = candidate.keypoints.get(match.trainIdx).pt; from.push(a.x, a.y); to.push(b.x, b.y); }
    sourcePoints = cv.matFromArray(good.length, 1, cv.CV_32FC2, from); destinationPoints = cv.matFromArray(good.length, 1, cv.CV_32FC2, to); mask = new cv.Mat();
    homography = cv.findHomography(sourcePoints, destinationPoints, cv.RANSAC, 3, mask);
    const inliers = [...mask.data].reduce((total, value) => total + Number(value > 0), 0); const ratio = inliers / good.length;
    return { score: Math.min(1, good.length / 90) * .25 + Math.min(1, inliers / 55) * .5 + ratio * .25, goodMatches: good.length, inliers };
  } finally { homography?.delete(); mask?.delete(); destinationPoints?.delete(); sourcePoints?.delete(); matches.delete(); matcher.delete(); }
}

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data;
  try {
    if (type === "probe") {
      const started = performance.now(); const cv = await loadOpenCv(); post(id, { ...inspectOpenCvCapabilities(cv), loadMs: performance.now() - started, indexedCards: Object.keys(visualIndex.cards).length }); return;
    }
    if (type === "search") {
      const started = performance.now(); const rgba = new Uint8Array(payload.buffer); const descriptor = calculateVisualDescriptorFromRgba(rgba, payload.width, payload.height);
      const candidates = searchDescriptor(descriptor, payload.limit || 40);
      post(id, { descriptor, candidates, processingMs: performance.now() - started }); return;
    }
    const cv = await loadOpenCv();
    if (type === "analyze-proposals") {
      const started = performance.now(); const source = rgbaMat(cv, payload); let proposals = [];
      try {
        proposals = generateCardProposals(cv, source, payload.options);
        const outputs = []; const transfers = [];
        for (const proposal of proposals) {
          const buffer = new Uint8ClampedArray(proposal.mat.data);
          const descriptorStarted = performance.now();
          const descriptor = calculateVisualDescriptorFromRgba(buffer, proposal.width, proposal.height);
          const candidates = searchDescriptor(descriptor, payload.limit || 40);
          outputs.push({
            id: proposal.id, source: proposal.source, corners: proposal.corners,
            geometryScore: proposal.geometryScore, quality: proposal.quality,
            detector: proposal.detector, isFallback: proposal.isFallback,
            width: proposal.width, height: proposal.height, buffer: buffer.buffer,
            lightweight: { descriptor, candidates, processingMs: performance.now() - descriptorStarted },
          });
          transfers.push(buffer.buffer);
        }
        post(id, { proposals: outputs, processingMs: performance.now() - started }, transfers);
      } finally { releaseCardProposals(proposals); source.delete(); }
      return;
    }
    if (type === "rectify") {
      const started = performance.now(); const source = rgbaMat(cv, payload); let rectified;
      try {
        const detection = detectCardBoundary(cv, source, payload.options?.detection);
        if (!detection.found) { post(id, { detection, processingMs: performance.now() - started }); return; }
        rectified = rectifyCardPerspective(cv, source, detection.expandedCorners, payload.options?.output);
        const output = new Uint8ClampedArray(rectified.data);
        post(id, { detection, width: rectified.cols, height: rectified.rows, buffer: output.buffer, processingMs: performance.now() - started }, [output.buffer]);
      } finally { rectified?.delete(); source.delete(); }
      return;
    }
    if (type === "orb") {
      const started = performance.now(); const queryMat = rgbaMat(cv, payload.query); const query = orbFeatures(cv, queryMat); const results = [];
      try {
        for (const item of payload.candidates) { const candidateMat = rgbaMat(cv, item); let candidate;
          try { candidate = orbFeatures(cv, candidateMat); results.push({ cardId: item.cardId, ...orbScore(cv, query, candidate) }); }
          finally { deleteFeatures(candidate); candidateMat.delete(); }
        }
      } finally { deleteFeatures(query); queryMat.delete(); }
      results.sort((a, b) => b.score - a.score); post(id, { candidates: results, processingMs: performance.now() - started }); return;
    }
    throw new Error(`Unknown scanner visual task: ${type}`);
  } catch (error) { postError(id, error); }
};
