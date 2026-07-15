import { SCANNER_AI_RUNTIME_CONFIG } from "./scannerAiRuntimeConfig.js";

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export const DEFAULT_HYBRID_THRESHOLDS = SCANNER_AI_RUNTIME_CONFIG.ranking;

function reasonCode(reason) {
  return String(typeof reason === "string" ? reason : reason?.code || reason?.reason || "").toLowerCase();
}

function includesEvery(code, tokens) { return tokens.every((token) => code.includes(token)); }

export function summarizeCandidateEvidence(candidate) {
  const reasons = (candidate?.reasons || []).map(reasonCode);
  const exactCollector = reasons.some((code) => includesEvery(code, ["collector", "exact"]) || includesEvery(code, ["exact", "number"]));
  const printedTotal = reasons.some((code) => code.includes("total") && (code.includes("exact") || code.includes("collector")));
  const exactName = reasons.some((code) => code.includes("name") && (code.includes("exact") || code.includes("normalized")));
  const fuzzyName = exactName || reasons.some((code) => code.includes("name") && (code.includes("fuzzy") || code.includes("ocr") || code.includes("spacing") || code.includes("alias")));
  const set = reasons.some((code) => code.includes("set") && !code.includes("full-catalog"));
  return {
    exactCollector,
    printedTotal,
    exactName,
    fuzzyName,
    set,
    fullCatalogFallback: reasons.some((code) => code.includes("full-catalog")),
  };
}

function scoreCandidate({ candidate, visual, orb, maximumEvidenceScore, weights }) {
  const evidence = summarizeCandidateEvidence(candidate);
  const relativeOcr = maximumEvidenceScore > 0 ? clamp01(candidate?.evidenceScore / maximumEvidenceScore) : 0;
  const cosine = visual?.visualScore;
  const visualScore = Number.isFinite(cosine) ? clamp01((cosine + 1) / 2) : 0;
  const orbScore = clamp01(orb?.score);
  let score = visualScore * weights.visual + relativeOcr * weights.relativeOcr;
  if (evidence.exactCollector) score += weights.exactCollector;
  if (evidence.printedTotal) score += weights.printedTotal;
  if (evidence.exactName) score += weights.exactName;
  else if (evidence.fuzzyName) score += weights.fuzzyName;
  if (evidence.set) score += weights.set;
  if (orb) score += orbScore * weights.orb;
  return { score: clamp01(score), evidence, visualScore: cosine ?? null, orbScore: orb?.score ?? null };
}

export function fuseHybridEvidence({
  visualCandidates = [],
  candidatePool,
  orbCandidates = [],
  catalog = [],
  thresholds = {},
} = {}) {
  const config = { ...DEFAULT_HYBRID_THRESHOLDS, ...thresholds };
  const poolCandidates = candidatePool?.candidates || [];
  const poolById = new Map(poolCandidates.map((candidate) => [candidate.cardId, candidate]));
  const catalogById = new Map(catalog.map((entry) => [entry.cardId, entry]));
  const visualById = new Map(visualCandidates.map((candidate) => [candidate.cardId, candidate]));
  const orbById = new Map(orbCandidates.map((candidate) => [candidate.cardId, candidate]));
  const maximumEvidenceScore = Math.max(0, ...poolCandidates.map(({ evidenceScore }) => Number(evidenceScore) || 0));
  const ids = [...new Set([
    ...visualCandidates.map(({ cardId }) => cardId),
    ...poolCandidates.slice(0, config.maxResults).map(({ cardId }) => cardId),
    ...orbCandidates.map(({ cardId }) => cardId),
  ])];
  const ranked = ids.map((cardId) => {
    const candidate = poolById.get(cardId);
    if (!candidate) return null;
    const visual = visualById.get(cardId);
    const orb = orbById.get(cardId);
    const scored = scoreCandidate({ candidate, visual, orb, maximumEvidenceScore, weights: config.weights });
    const catalogEntry = catalogById.get(cardId);
    return {
      cardId,
      score: scored.score,
      visualScore: scored.visualScore,
      orbScore: scored.orbScore,
      orbInliers: orb?.inliers ?? null,
      evidenceScore: Number(candidate.evidenceScore) || 0,
      evidence: scored.evidence,
      reasons: candidate.reasons || [],
      name: candidate.name || catalogEntry?.name || null,
      setId: candidate.setId || catalogEntry?.setId || null,
      setName: candidate.setName || catalogEntry?.setName || null,
      collectorNumber: candidate.collectorNumber || candidate.cardNumber || catalogEntry?.cardNumber || null,
      printedSetTotal: candidate.printedTotal || catalogEntry?.printedSetTotal || null,
      rarity: candidate.rarity || catalogEntry?.rarity || null,
      imageUrl: candidate.imageUrl || catalogEntry?.imageUrl || null,
    };
  }).filter(Boolean).sort((left, right) => right.score - left.score || right.evidenceScore - left.evidenceScore || left.cardId.localeCompare(right.cardId));

  const top = ranked[0];
  const second = ranked[1];
  const fusedGap = top ? top.score - (second?.score ?? 0) : 0;
  const visualRank = top ? visualCandidates.findIndex(({ cardId }) => cardId === top.cardId) + 1 : 0;
  const [visualFirst, visualSecond] = visualCandidates;
  const aiMargin = visualFirst && visualSecond ? visualFirst.visualScore - visualSecond.visualScore : null;
  const orbFirst = orbCandidates[0];
  const orbSecond = orbCandidates[1];
  const orbMargin = orbFirst && orbSecond ? orbFirst.score - orbSecond.score : null;
  const strongOcrIdentity = Boolean(top?.evidence.exactCollector && top.evidence.printedTotal && (top.evidence.exactName || top.evidence.fuzzyName));
  const strongOcrAiAgreement = Boolean(
    strongOcrIdentity
    && visualFirst?.cardId === top?.cardId
    && visualFirst.visualScore >= config.strongOcrAiSimilarity
    && (!visualSecond || aiMargin >= config.strongOcrAiMargin),
  );
  const numberAiAgreement = Boolean(
    top?.evidence.exactCollector && top.evidence.printedTotal
    && visualFirst?.cardId === top.cardId
    && visualFirst.visualScore >= config.strongOcrAiSimilarity
    && (!visualSecond || aiMargin >= config.strongOcrAiMargin),
  );
  const exactNameAiAgreement = Boolean(
    top?.evidence.exactName
    && visualFirst?.cardId === top.cardId
    && visualFirst.visualScore >= config.exactNameAiSimilarity
    && (aiMargin == null || aiMargin >= config.exactNameAiMargin),
  );
  const orbAgreement = Boolean(
    top && orbFirst?.cardId === top.cardId && orbFirst.score >= 0.35 && (orbFirst.inliers || 0) >= 8 && (orbMargin == null || orbMargin >= 0.06)
    && (top.evidence.exactName || top.evidence.exactCollector),
  );
  const fullCatalogAi = Boolean(
    candidatePool?.usedFullCatalogFallback
    && top && visualFirst?.cardId === top.cardId
    && visualFirst.visualScore >= config.fullCatalogAiSimilarity
    && aiMargin != null && aiMargin >= config.fullCatalogAiMargin,
  );
  const gapSafe = ranked.length === 1 || fusedGap >= config.minimumConfirmedFusedGap;
  const confirmed = gapSafe && (
    strongOcrAiAgreement
    || numberAiAgreement
    || exactNameAiAgreement
    || orbAgreement
    || fullCatalogAi
  );
  const confidence = confirmed ? "high" : top && (strongOcrIdentity || exactNameAiAgreement || orbAgreement) ? "medium" : "low";
  return {
    confidence,
    confirmedCardId: confirmed ? top.cardId : null,
    safeNoResult: !confirmed,
    primaryMatch: confirmed ? top : null,
    results: ranked.slice(0, config.maxResults),
    diagnostics: {
      fusedGap,
      aiMargin,
      orbMargin,
      visualRank: visualRank || null,
      strongOcrIdentity,
      strongOcrAiAgreement,
      numberAiAgreement,
      exactNameAiAgreement,
      orbAgreement,
      fullCatalogAi,
    },
  };
}

export function selectBoundedOrbCandidates({ visualCandidates = [], candidatePool, thresholds = {} } = {}) {
  const config = { ...DEFAULT_HYBRID_THRESHOLDS, ...thresholds };
  const pool = candidatePool?.candidates || [];
  if (candidatePool?.usedFullCatalogFallback) return { shouldRun: false, reason: "full-catalog-pool", candidateIds: [] };
  if (pool.length > config.orbMaxCandidatePool) return { shouldRun: false, reason: "candidate-pool-too-large", candidateIds: [] };
  if (visualCandidates.length < config.orbMinCandidates) return { shouldRun: false, reason: "too-few-ai-candidates", candidateIds: [] };
  const aiMargin = visualCandidates[0].visualScore - visualCandidates[1].visualScore;
  if (aiMargin > config.orbMaxAiMargin) return { shouldRun: false, reason: "ai-winner-not-close", candidateIds: [] };
  const evidenceScores = pool.slice(0, 2).map(({ evidenceScore }) => Number(evidenceScore) || 0);
  const evidenceGap = evidenceScores[0] == null || evidenceScores[1] == null ? 0 : evidenceScores[0] - evidenceScores[1];
  const topEvidence = summarizeCandidateEvidence(pool[0]);
  if (topEvidence.exactCollector && topEvidence.printedTotal && evidenceGap > config.orbMaxOcrEvidenceGap) {
    return { shouldRun: false, reason: "ocr-distinguishes-winner", candidateIds: [] };
  }
  if (evidenceGap > config.orbMaxOcrEvidenceGap) return { shouldRun: false, reason: "ocr-distinguishes-winner", candidateIds: [] };
  return {
    shouldRun: true,
    reason: "close-ai-and-ambiguous-ocr",
    aiMargin,
    evidenceGap,
    candidateIds: visualCandidates.slice(0, config.orbMaxCandidates).map(({ cardId }) => cardId),
  };
}
