/**
 * Versioned scanner-AI POC policy. The deployed runtime is trained float32;
 * the generic model is retrieval-benchmark-only. Freeze a trained-float32
 * calibration policy, audit it once, then freeze the Android artifact before
 * opening the locked holdout benchmark.
 */
export const SCANNER_AI_RUNTIME_CONFIG = Object.freeze({
  schemaVersion: 1,
  configVersion: "packdex-hybrid-runtime-2026-07-13-trained-float32-v2",
  ocr: Object.freeze({
    labels: Object.freeze(["name-top", "collector-bottom", "collector-bottom-edge"]),
  }),
  search: Object.freeze({
    fullCatalogLimit: 20,
    narrowedPoolLimit: 100,
  }),
  ranking: Object.freeze({
    maxResults: 5,
    weights: Object.freeze({
      visual: 0.619057,
      relativeOcr: 0.057676,
      exactCollector: 0.115352,
      printedTotal: 0.086514,
      exactName: 0.079305,
      fuzzyName: 0.050467,
      set: 0.021629,
      orb: 0.12,
    }),
    // Enabled only after a reviewed, bundled reference-descriptor cache exists.
    // Canvas/image fetching and scan-time descriptor construction are forbidden.
    orbEnabled: false,
    orbMaxCandidatePool: 20,
    orbMinCandidates: 3,
    orbMaxCandidates: 5,
    orbMaxAiMargin: 0.03,
    orbMaxOcrEvidenceGap: 12,
    strongOcrAiSimilarity: 0.98,
    strongOcrAiMargin: 0.5,
    exactNameAiSimilarity: 0.98,
    exactNameAiMargin: 0.5,
    fullCatalogAiSimilarity: 0.82,
    fullCatalogAiMargin: 0.08,
    minimumConfirmedFusedGap: 0.025,
  }),
});

export default SCANNER_AI_RUNTIME_CONFIG;
