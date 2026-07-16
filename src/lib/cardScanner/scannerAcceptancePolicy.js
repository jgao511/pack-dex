import { normalizeCardName, normalizeCollectorNumber } from "./normalizeScannerText.js";
import { scoreTextBlockLayout } from "./proposalEvidence.js";

export const SCANNER_ACCEPTANCE_MODES = Object.freeze({
  SINGLE: "accepted-single",
  CANDIDATES: "accepted-candidates",
  NO_MATCH: "no-match",
});

const STRONG_ORB_MIN_INLIERS = 12;
const STRONG_ORB_MIN_SCORE = .55;
const STRONG_NAME_SIMILARITY = .82;
const COMPLETE_CARD_TEXT_LAYOUT = .7;
const INDEPENDENT_VISUAL_MIN_SCORE = .72;
const DISTINCT_FROZEN_MIN_SCORE = .85;
const DISTINCT_FROZEN_MIN_LEAD = .08;
const FAMILY_NAME_MIN_LENGTH = 6;

function editDistance(left, right) {
  const row = [...Array(right.length + 1).keys()];
  for (let index = 1; index <= left.length; index += 1) {
    let previous = row[0]; row[0] = index;
    for (let other = 1; other <= right.length; other += 1) {
      const old = row[other];
      row[other] = Math.min(row[other] + 1, row[other - 1] + 1, previous + Number(left[index - 1] !== right[other - 1]));
      previous = old;
    }
  }
  return row[right.length];
}

function nameSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.slice(0, 3) !== right.slice(0, 3) || Math.abs(left.length - right.length) > 4) return 0;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function selectedProposal(imageDiagnostics) {
  return imageDiagnostics?.proposals?.find(({ selected }) => selected)
    || imageDiagnostics?.proposals?.find(({ id }) => id === imageDiagnostics?.boundary?.selectedProposalId)
    || null;
}

function normalizeNameEvidence(ocrMatch) {
  return (ocrMatch?.nameCandidates || []).map((candidate) => ({
    raw: String(candidate?.raw || ""),
    normalized: normalizeCardName(candidate?.normalized || candidate?.raw),
    sourcePass: candidate?.sourcePass || null,
  })).filter(({ normalized }) => normalized);
}

function normalizeNumberEvidence(ocrMatch) {
  return (ocrMatch?.collectorNumbers || []).map((candidate) => ({
    raw: String(candidate?.raw || ""),
    normalized: normalizeCollectorNumber(candidate?.normalized || candidate?.raw),
    normalizedTotal: candidate?.normalizedTotal ? String(candidate.normalizedTotal).toUpperCase() : null,
    sourcePass: candidate?.sourcePass || null,
  })).filter(({ normalized }) => normalized);
}

export function normalizeScannerEvidence(recognized = {}, selectedMatch = {}) {
  const imageDiagnostics = recognized.imageDiagnostics || {};
  const proposal = selectedProposal(imageDiagnostics);
  const preparedWidth = Number(imageDiagnostics.preparedWidth || proposal?.width || 0);
  const preparedHeight = Number(imageDiagnostics.preparedHeight || proposal?.height || 0);
  const measuredLayout = Number(proposal?.evidence?.textClusterScore);
  const textLayoutScore = Number.isFinite(measuredLayout)
    ? measuredLayout
    : scoreTextBlockLayout(recognized.blocks || [], preparedWidth, preparedHeight);
  const boundary = imageDiagnostics.boundary || imageDiagnostics || null;
  const proposalSource = proposal?.source || boundary?.selectedSource || boundary?.source || null;
  const isFallback = Boolean(proposal?.isFallback || proposalSource === "full-fallback");
  const visualCandidates = recognized.visualMatch?.lightweight?.candidates || [];
  const orbCandidates = recognized.visualMatch?.orb?.candidates || [];
  const legacyFusedCandidates = proposal?.fusedCandidates || recognized.legacyFusedMatch?.results || [];

  return {
    schemaVersion: 1,
    frozenCandidates: recognized.frozenA?.candidates || [],
    fusedCandidates: selectedMatch?.results || [],
    ocrNames: normalizeNameEvidence(recognized.ocrMatch),
    ocrNumbers: normalizeNumberEvidence(recognized.ocrMatch),
    ocrCandidates: recognized.ocrMatch?.results || [],
    visualCandidates,
    orbCandidates,
    trustedVisualCandidates: recognized.visualMatch?.trustedCandidates || [],
    legacyFusedCandidates,
    crop: {
      selectedSource: proposalSource,
      geometryScore: Number(proposal?.geometryScore || boundary?.score || 0),
      areaFraction: Number(proposal?.quality?.areaFraction || 0),
      textLayoutScore,
      isFallback,
      completeCard: !isFallback && textLayoutScore >= COMPLETE_CARD_TEXT_LAYOUT,
    },
  };
}

function nameSupport(candidate, evidence) {
  const normalizedName = normalizeCardName(candidate?.card?.name || candidate?.name);
  let best = 0;
  let family = false;
  for (const name of evidence.ocrNames) {
    best = Math.max(best, nameSimilarity(name.normalized, normalizedName));
    family ||= name.normalized.length >= FAMILY_NAME_MIN_LENGTH
      && (` ${normalizedName} `).includes(` ${name.normalized} `);
  }
  const ocrCandidate = evidence.ocrCandidates.find(({ cardId }) => cardId === candidate.cardId);
  const reasonSupport = ocrCandidate?.reasons?.some((reason) => reason === "exact normalized name" || reason === "strong name similarity");
  return { strong: Boolean(reasonSupport || best >= STRONG_NAME_SIMILARITY), exact: Boolean(best === 1), family, similarity: best };
}

function collectorSupport(candidate, evidence) {
  const candidateNumber = normalizeCollectorNumber(candidate?.card?.number || "");
  const candidateTotal = candidate?.printedSetTotal ? String(candidate.printedSetTotal).toUpperCase() : null;
  if (!candidateNumber) return false;
  return evidence.ocrNumbers.some((number) => {
    if (number.normalized !== candidateNumber) return false;
    if (number.normalizedTotal) return Boolean(candidateTotal && number.normalizedTotal === candidateTotal);
    return /^[A-Z]/.test(number.normalized) && /^collector-bottom/.test(number.sourcePass || "");
  });
}

function candidateSupport(candidate, evidence) {
  const orb = evidence.orbCandidates.find(({ cardId }) => cardId === candidate.cardId);
  const strongOrb = Boolean(orb && Number(orb.score) >= STRONG_ORB_MIN_SCORE && Number(orb.inliers) >= STRONG_ORB_MIN_INLIERS);
  const name = nameSupport(candidate, evidence);
  const exactCollector = collectorSupport(candidate, evidence);
  const visualTop = evidence.visualCandidates[0];
  const visualAgreement = Boolean(visualTop?.cardId === candidate.cardId && Number(visualTop.score) >= INDEPENDENT_VISUAL_MIN_SCORE);
  const legacyAgreement = evidence.legacyFusedCandidates.some((legacy, index) => legacy.cardId === candidate.cardId
    && (index === 0 || legacy.confidence === "medium" || legacy.confidence === "high"));
  const matcherAgreement = visualAgreement || legacyAgreement;
  const completeCard = evidence.crop.completeCard;
  const frozenIndex = evidence.frozenCandidates.findIndex(({ cardId }) => cardId === candidate.cardId);
  const frozen = frozenIndex >= 0 ? evidence.frozenCandidates[frozenIndex] : null;
  const nextFrozenScore = Number(evidence.frozenCandidates[frozenIndex + 1]?.score || 0);
  const distinctFrozenProposal = Boolean(frozenIndex === 0
    && Number(frozen?.score) >= DISTINCT_FROZEN_MIN_SCORE
    && Number(frozen.score) - nextFrozenScore >= DISTINCT_FROZEN_MIN_LEAD);
  const familyLayoutAgreement = name.family && completeCard && distinctFrozenProposal;
  const supported = strongOrb
    || (name.strong && completeCard)
    || (exactCollector && (name.strong || completeCard))
    || (matcherAgreement && (name.strong || completeCard))
    || familyLayoutAgreement;
  const reasons = [];
  if (strongOrb) reasons.push("strong-orb");
  if (name.strong) reasons.push(name.exact ? "exact-name" : "strong-name");
  if (exactCollector) reasons.push("exact-collector");
  if (matcherAgreement) reasons.push("independent-matcher-agreement");
  if (familyLayoutAgreement) reasons.push("family-name-distinct-proposal");
  if (completeCard) reasons.push("complete-card-layout");
  return {
    supported, reasons, strongOrb, strongName: name.strong, exactName: name.exact, familyName: name.family,
    nameSimilarity: name.similarity, exactCollector, matcherAgreement, distinctFrozenProposal,
  };
}

function decisionMatch(selectedMatch, mode, results) {
  return {
    ...(selectedMatch || {}),
    acceptanceMode: mode,
    confidence: mode === SCANNER_ACCEPTANCE_MODES.SINGLE ? "high" : mode === SCANNER_ACCEPTANCE_MODES.CANDIDATES ? "medium" : "low",
    primaryMatch: mode === SCANNER_ACCEPTANCE_MODES.SINGLE ? results[0] : null,
    results,
  };
}

export function decideScannerAcceptance(recognized = {}, selectedMatch = {}) {
  const evidence = normalizeScannerEvidence(recognized, selectedMatch);
  let candidates = evidence.fusedCandidates.slice(0, 3);
  if (!candidates.length) {
    const mode = SCANNER_ACCEPTANCE_MODES.NO_MATCH;
    return { mode, match: decisionMatch(selectedMatch, mode, []), evidence, candidateEvidence: [] };
  }

  let candidateEvidence = candidates.map((candidate) => ({ candidate, ...candidateSupport(candidate, evidence) }));
  if (!candidateEvidence[0].supported) {
    const trustedById = new Map(evidence.trustedVisualCandidates.map((candidate) => [candidate.cardId, candidate]));
    candidates = evidence.orbCandidates.filter(({ score, inliers }) => Number(score) >= STRONG_ORB_MIN_SCORE && Number(inliers) >= STRONG_ORB_MIN_INLIERS)
      .map((orb) => {
        const trusted = trustedById.get(orb.cardId);
        return trusted ? {
          ...trusted,
          score: Math.round(Number(orb.score) * 100),
          confidence: "low",
          reasons: [`ORB/RANSAC ${(Number(orb.score) * 100).toFixed(1)}% (${orb.inliers} inliers)`],
          visualEvidence: { orb: Number(orb.score), inliers: Number(orb.inliers) },
        } : null;
      }).filter(Boolean).slice(0, 3);
    candidateEvidence = candidates.map((candidate) => ({ candidate, ...candidateSupport(candidate, evidence) }));
    if (!candidateEvidence[0]?.supported) {
      const mode = SCANNER_ACCEPTANCE_MODES.NO_MATCH;
      return { mode, match: decisionMatch(selectedMatch, mode, []), evidence, candidateEvidence };
    }
  }

  let credible = candidateEvidence.filter(({ supported }) => supported);
  if (candidateEvidence[0].exactCollector && candidateEvidence[0].strongName) credible = [candidateEvidence[0]];
  const results = credible.map(({ candidate, reasons }) => ({
    ...candidate,
    acceptanceReasons: reasons,
  }));
  const mode = results.length === 1 ? SCANNER_ACCEPTANCE_MODES.SINGLE : SCANNER_ACCEPTANCE_MODES.CANDIDATES;
  return { mode, match: decisionMatch(selectedMatch, mode, results), evidence, candidateEvidence };
}
