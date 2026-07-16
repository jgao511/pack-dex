import { normalizeCardName } from "./normalizeScannerText.js";

// This policy is deliberately downstream of Frozen-A. It never changes the
// image, embedding, index, or cosine ordering; it only decides whether the
// already-computed nearest neighbours are safe to present to a person.
export const FROZEN_A_ACCEPTANCE_POLICY = Object.freeze({
  version: "frozen-a-acceptance-v1",
  mediumSimilarity: .60,
  mediumMargin: .015,
  highSimilarity: .70,
  highMargin: .035,
  visualOnlySimilarity: .85,
  visualOnlyMargin: .08,
  candidateFloor: .60,
  candidateDelta: .055,
});

const value = (candidate) => Number(candidate?.score ?? candidate?.visualEvidence?.frozenA);
const rawSimilarity = (candidate) => {
  const score = value(candidate);
  return Number.isFinite(score) ? (score > 1 ? score / 100 : score) : Number.NaN;
};
const hasReason = (result, expression) => (result?.reasons || []).some((reason) => expression.test(reason));
function normalizedName(result) { return normalizeCardName(result?.card?.name || ""); }

function getOcrEvidence(ocrMatch, primary) {
  const matching = (ocrMatch?.results || []).find((result) => result.cardId === primary?.cardId);
  const exactName = hasReason(matching, /exact normalized name/i);
  const strongName = exactName || hasReason(matching, /strong name similarity/i);
  const collector = hasReason(matching, /collector number/i);
  const printedSetTotal = hasReason(matching, /exact printed set total/i);
  const normalized = normalizedName(primary);
  const named = normalized && (ocrMatch?.nameCandidates || []).some((item) => item.normalized === normalized);
  return { matching, reliableName: Boolean(exactName || named), collector: Boolean(collector), frontText: Boolean(strongName || collector || printedSetTotal), agreement: Boolean(matching && (strongName || collector || printedSetTotal)) };
}

function plausibleGeometry(geometry) {
  const boundary = geometry?.boundaryDiagnostics || geometry;
  if (boundary?.found === true) return true;
  if (boundary?.selectedSource && !/fallback|centered/i.test(boundary.selectedSource)) return true;
  return Boolean(geometry?.proposal && !/centered/i.test(String(geometry.proposal.source || "")));
}

function candidateResults(match, candidates) {
  const listed = new Map((match?.results || []).map((result) => [result.cardId, result]));
  for (const result of match?.candidateResults || []) if (!listed.has(result.cardId)) listed.set(result.cardId, result);
  return candidates.map((candidate) => listed.get(candidate.cardId)).filter(Boolean);
}

function mediumResults(primary, ranked, topSimilarity, ocr) {
  const credible = ranked.filter((result) => {
    const similarity = rawSimilarity(result);
    return result.cardId !== primary.cardId && Number.isFinite(similarity) && similarity >= FROZEN_A_ACCEPTANCE_POLICY.candidateFloor && similarity >= topSimilarity - FROZEN_A_ACCEPTANCE_POLICY.candidateDelta;
  });
  const sameName = ocr.reliableName ? credible.filter((result) => normalizedName(result) === normalizedName(primary)) : [];
  // OCR may only refine secondary presentation; the Frozen-A winner stays first.
  return [primary, ...(sameName.length ? sameName : credible)].slice(0, 3);
}

function diagnostic(enabled, details) { return enabled ? { acceptanceDiagnostics: details } : {}; }

export function applyFrozenAAcceptancePolicy({ frozenMatch, frozenCandidates, ocrMatch, geometry, diagnostics = false } = {}) {
  const started = performance.now();
  const candidates = frozenCandidates || [];
  const ranked = candidateResults(frozenMatch, candidates);
  const primary = ranked[0] || frozenMatch?.results?.[0] || null;
  const top1 = rawSimilarity(candidates[0] || primary); const top2 = rawSimilarity(candidates[1]); const top3 = rawSimilarity(candidates[2]);
  const margin = Number.isFinite(top1) ? top1 - (Number.isFinite(top2) ? top2 : 0) : Number.NaN;
  const spread = Number.isFinite(top1) ? top1 - (Number.isFinite(top3) ? top3 : 0) : Number.NaN;
  const ocr = getOcrEvidence(ocrMatch, primary); const geometryPlausible = plausibleGeometry(geometry);
  const strictVisual = top1 >= FROZEN_A_ACCEPTANCE_POLICY.visualOnlySimilarity && margin >= FROZEN_A_ACCEPTANCE_POLICY.visualOnlyMargin && geometryPlausible;
  const highWithOcr = top1 >= FROZEN_A_ACCEPTANCE_POLICY.highSimilarity && margin >= FROZEN_A_ACCEPTANCE_POLICY.highMargin && ocr.agreement && (ocr.reliableName || ocr.collector);
  const mediumWithOcr = top1 >= FROZEN_A_ACCEPTANCE_POLICY.mediumSimilarity && margin >= FROZEN_A_ACCEPTANCE_POLICY.mediumMargin && ocr.frontText;
  const mediumVisual = top1 >= FROZEN_A_ACCEPTANCE_POLICY.highSimilarity && margin >= FROZEN_A_ACCEPTANCE_POLICY.highMargin && geometryPlausible;
  let mode = "low"; let reason = "insufficient-evidence"; let results = [];
  if (primary && (highWithOcr || strictVisual)) { mode = "high"; reason = highWithOcr ? "visual-ocr-agreement" : "exceptional-visual"; results = [primary]; }
  else if (primary && (mediumWithOcr || mediumVisual)) {
    const accepted = mediumResults(primary, ranked, top1, ocr);
    if (accepted.length >= 2) { mode = "medium"; reason = mediumWithOcr ? "plausible-front-with-ocr" : "plausible-visual"; results = accepted; }
    else reason = "no-credible-alternative";
  } else if (!primary || !Number.isFinite(top1) || top1 < FROZEN_A_ACCEPTANCE_POLICY.mediumSimilarity) reason = "weak-visual-similarity";
  else if (margin < FROZEN_A_ACCEPTANCE_POLICY.mediumMargin) reason = "ambiguous-visual-ranking";
  else if (!ocr.frontText && !geometryPlausible) reason = "no-card-front-evidence";
  else if (!ocr.frontText) reason = "unconfirmed-visual-only";
  const policyProcessingMs = performance.now() - started;
  const { candidateResults: _candidateResults, ...match } = frozenMatch || {};
  return { ...match, mode, confidence: mode, results, primaryMatch: mode === "high" ? primary : null, acceptance: { version: FROZEN_A_ACCEPTANCE_POLICY.version, policyProcessingMs }, ...diagnostic(diagnostics, { top1, top2, top1Top2Margin: margin, top1Top3Spread: spread, geometryPlausible, ocr, reason }) };
}
