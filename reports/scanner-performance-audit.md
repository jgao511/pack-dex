# PackDex mobile scanner performance audit — Phase 1

Scope: hidden mobile scanner only, exact Choose Photo `File`/`Blob` route. This is a read-only audit; it changes no matching behavior, thresholds, adapter, worker, catalog, scoring, or UI.

## Current measured baseline

The connected Pixel 6a acceptance report records 7,375.6 ms for the cold Team Rocket run, then 5,776.7 ms (Diglett), 6,106.5 ms (Gardevoir), and 6,055.5 ms (Mega Charizard). These are end-to-end values. The present `scannerTiming` object exposes only `preparationMs`, aggregate first-pass OCR, combined finalist OCR/visual, selected-pass OCR, selected visual, and total; it cannot attribute decode, worker boot, proposal detectors, individual catalog passes, image conversions, candidate I/O, ORB feature extraction, fusion, or preview serialization. The 1.3–1.6 second difference between the cold run and later runs is therefore not safely attributable to worker startup alone.

The scanner v2 index is 18,747/18,747 cards, 4,675,015 bytes raw and 2,313,488 bytes gzip.

## Exact critical path

1. `CardScannerDevPage.jsx:127` fetches a Pixel fixture, constructs a neutral `File`, and passes its object-URL wrapper to `recognizeCardText`. A user-selected photo enters at the same `recognizeCardText` boundary.
2. `prepareCardImage` (`src/lib/cardScanner/prepareCardImage.js:37`) fetches the object URL to a `Blob`, decodes it with `createImageBitmap`, downsizes/draws a full canvas, optionally draws the camera-outline canvas, then invokes rectification.
3. `nativeOcrAdapter.recognize` (`mobile-app/src/lib/nativeScannerAdapters.js:120`) calls `analyzeProposalCanvases` with the full capture, 500×700 proposal output, up to ten proposals, and 40 visual candidates.
4. `analyzeProposalCanvases` (`visualWorkerClient.js:25`) reads the 1350×1800 Pixel fixture canvas to RGBA (about 9.72 MB) and transfers it to the lazy scanner worker.
5. Worker `analyze-proposals` (`scannerVisual.worker.js:63`) initializes/parses the scanner-only index and OpenCV on the first request, generates proposals, rectifies each, computes each v2 descriptor, scores all 18,747 coarse descriptors, fully reranks 640, and returns the top 40. It also copies and transfers every 500×700 RGBA proposal (1.4 MB each; roughly 12.6–14 MB for 9–10 proposals).
6. The main thread recreates a canvas for every returned proposal with `putImageData` (`visualWorkerClient.js:20–31`).
7. The adapter serially invokes native ML Kit full-card OCR once for every proposal (`nativeScannerAdapters.js:151`). Each invocation first creates a canvas and synchronously JPEG/base64-encodes it in `createOcrPasses` (`prepareCardImage.js:25–33`), then crosses the Capacitor bridge.
8. `summarizeOcrPasses` runs `rankCardMatches` after each proposal; `rankProposalEvidence` chooses the top two finalists.
9. Each finalist receives three more serial ML Kit calls: `name-top`, `collector-bottom`, and `collector-bottom-edge` (`nativeScannerAdapters.js:160–163`). All four passes are summarized and catalog-ranked again.
10. `runVisualMatching` (`runVisualMatching.js:87`) probes the already-active worker, reuses the proposal's precomputed lightweight results, builds the OCR/visual union, loads up to 20 trusted candidate images, decodes/draws them to canvases, and transfers query plus candidate RGBA back to the worker. A typical 371×520 candidate is about 0.77 MB RGBA, or about 15.4 MB for 20, plus the 1.4 MB query.
11. Worker `orb` extracts up to 21 ORB feature sets and runs Hamming/RANSAC sequentially (`scannerVisual.worker.js:94–105`). Fusion then runs synchronously in `fuseCardMatches`; final proposal ranking runs in `rankFinalProposalRuns`.
12. Result preparation JPEG/base64-serializes every proposal preview and serializes the selected proposal again (`nativeScannerAdapters.js:184,202`), then releases proposal canvases.

## Redundant or repeated work

- `generateCardProposals` calls the exact contour detector, `minimumAreaProposals`, and `houghProposal` (`cardProposals.js:239–265`). Those paths independently repeat grayscale conversion, blur, Canny, and related edge work. A shared preprocessing result can preserve identical proposal scoring while removing repeated image passes.
- The worker traverses 18,747 descriptors once per proposal: about 168,723–187,470 coarse comparisons per photo, plus 5,760–6,400 full v2 reranks. All results are needed for current proposal evidence, but batching proposal descriptors into one catalog traversal should improve locality without changing scores or ranks.
- No OCR begins until all proposal descriptors/searches and all proposal pixel transfers finish. Streaming completed proposals could overlap ML Kit work with remaining worker searches while still waiting for every result before proposal ranking.
- A 9–10 proposal scan performs 9–10 serial full-card ML Kit calls plus as many as six enhanced calls for two finalists: up to 16 JPEG encodes, base64 bridge payloads, detections, and result conversions.
- `rankCardMatches` runs once after every full-card OCR and again for each finalist. Its catalog shortlisting is optimized, but OCR normalization and matching are repeated for overlapping accumulated text.
- `runVisualMatching` calls `probeVisualWorker` for each finalist even though successful proposal analysis proves that the same worker, index, OpenCV contour/perspective functions, and descriptor search are already ready.
- Finalist proposal pixels travel worker → transferred RGBA → main-thread canvas → `getImageData` → worker before ORB. A worker-owned proposal handle could avoid the return readback while retaining the exact pixels and ORB behavior.
- Candidate caching retains only the downloaded `Blob`. Overlapping finalist candidates still repeat `createImageBitmap`, resize/draw, canvas readback, transfer, and ORB feature extraction.
- Native `CapacitorHttp` returns candidate bytes as a base64 string; the adapter performs base64 → binary string → `Uint8Array` → `Blob` before bitmap decode.
- `prepareCardImage` always encodes `previewUrl`, `originalPreviewUrl`, and `outlinePreviewUrl` even with `includePasses: false`. For Choose Photo, outline and full canvas are the same object, so the same full image is encoded twice. The adapter later encodes every proposal and the selected proposal again.
- Positive existing optimization: finalist visual matching passes `precomputedLightweight`, so it does **not** repeat the 18,747-card search. Candidate image HTTP requests are parallel, and promise caching avoids repeated downloads.

## Recommended instrumentation schema

Record a single scanner-only diagnostic object. Use monotonic durations, integer byte counts, counts/IDs rather than image bytes, and a `cold` flag. Do not add card expectations to runtime diagnostics.

```js
{
  schemaVersion: 1,
  source: "photos" | "camera" | "fixture",
  totalMs,
  image: {
    fetchBlobMs, blobBytes, bitmapDecodeMs, originalWidth, originalHeight,
    canvasDrawMs, workingWidth, workingHeight, outlineDrawMs,
    initialPreviewEncodeMs, initialPreviewBytes
  },
  worker: {
    cold, createToFirstReplyMs, openCvReadyMs, indexEntryCount, indexReadyMs,
    requestQueueMs, mainReadbackMs, mainToWorkerBytes, workerToMainBytes,
    canvasRehydrateMs
  },
  proposals: {
    generationMs, count,
    detectorMs: { contour, minArea, hough, centered },
    warpMs, outputCopyMs,
    items: [{ id, source, descriptorMs, coarseSearchMs, rerankMs, topScore, lead }]
  },
  ocr: {
    firstPassWallMs, finalistWallMs, callCount,
    calls: [{ proposalId, label, cropDrawMs, jpegEncodeMs, base64Bytes,
      bridgeAndDetectMs, blockCount, textLength, matchRankMs }]
  },
  finalists: {
    requested, completed, earlyCompletionReason,
    items: [{ proposalId, shortlistMs, candidateCount, candidateCacheHits,
      candidateCacheMisses, candidateHttpMs, candidateDecodeDrawMs,
      candidateReadbackMs, candidateTransferBytes, orbQueueMs, orbFeatureMs,
      orbMatchMs, fusionMs, confidence, finalRankMs }]
  },
  output: { proposalPreviewEncodeMs, selectedPreviewEncodeMs, encodedBytes },
  cleanup: { canvasesReleased, bitmapsClosed, failedCandidateCount }
}
```

Worker timings must be measured inside the worker; client round-trip minus worker execution should be retained separately as queue/transfer/rehydration overhead. Candidate I/O should report max wall time and aggregate work time because its `Promise.all` calls overlap.

## Safe early-completion rule

The only defensible early completion with existing thresholds unchanged is:

> After the first-ranked finalist has completed enhanced OCR, the full current 20-candidate ORB pass, and `fuseCardMatches`, skip the second finalist only when `fusedMatch.confidence === "high"`.

This rule already exists as the first branch at `nativeScannerAdapters.js:178`. It preserves the complete current evidence requirement and saves three ML Kit calls, candidate loading/conversion, one ORB pass, and one fusion pass when triggered. Instrument `finalists.completed` and `earlyCompletionReason: "existing-high-confidence"` to measure its hit rate across the four Pixel fixtures before expanding it.

The neighboring shortcut, `topOrb.score >= .55 && topOrb.inliers >= 12`, is not equivalently safe by itself: it can stop on a medium-confidence result and does not require the existing fusion gaps, OCR compatibility, or high-confidence agreement. Likewise, pre-ORB fusion, stopping after a partial ORB candidate list, or stopping before all first-pass proposals are ranked can change the selected card. Those should not be called behavior-preserving optimizations without a fixture-by-fixture equivalence test.

## Recommended optimization order after instrumentation

1. Measure the schema above on cold and warm runs of all four Pixel fixtures.
2. Remove duplicate preview encodes and redundant post-analysis worker probes; neither contributes matching evidence.
3. Share proposal edge preprocessing and batch all proposal descriptors through one catalog traversal while preserving exact outputs.
4. Retain worker-side proposal pixels/handles through ORB to eliminate the large finalist round trip.
5. Cache decoded/resized candidate pixels or ORB features, scoped to the scanner session.
6. Only then evaluate streamed proposal OCR or more aggressive early completion against exact final-card/confidence equivalence on all four Pixel fixtures and the real-photo variants.
