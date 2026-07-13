import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { fuseHybridEvidence } from "../../src/lib/cardScanner/aiVisual/hybridRanking.js";

export const FUSION_OBSERVATION_SCHEMA_VERSION = 1;
export const FUSION_SCENARIO_VERSION = "packdex-fusion-validation-scenarios-v1";
export const DEFAULT_VALIDATION_IDENTITY_COUNT = 1875;

const round = (value) => Math.round(Number(value) * 1e6) / 1e6;
const interpolate = (start, end, position) => round(start + (end - start) * position);

export function corruptValidationName(value) {
  const source = String(value || "").trim();
  const letters = [...source].map((character, index) => /[a-z]/i.test(character) ? index : -1).filter((index) => index >= 0);
  if (letters.length >= 4) {
    const removeAt = letters[Math.floor(letters.length / 2)];
    return `${source.slice(0, removeAt)}${source.slice(removeAt + 1)}`;
  }
  if (source.length >= 2) return `${source.slice(0, -2)}${source.at(-1)}${source.at(-2)}`;
  return `${source}x`;
}

export function corruptValidationCollectorNumber(value) {
  const source = String(value || "");
  const position = [...source].findIndex((character) => /\d/.test(character));
  if (position < 0) return `${source}1`;
  const replacement = String((Number(source[position]) + 1) % 10);
  return `${source.slice(0, position)}${replacement}${source.slice(position + 1)}`;
}

function nameEvidence(row, raw = row?.name) {
  return raw ? [{ raw, sourcePass: "name-top", reliable: true }] : [];
}

function collectorEvidence(row, { number = row?.collectorNumber, includeTotal = true } = {}) {
  if (!number) return [];
  const total = includeTotal ? row?.printedTotal || null : null;
  return [{
    raw: `${number}${total ? `/${total}` : ""}`,
    cardNumber: number,
    printedSetTotal: total,
    sourcePass: "collector-bottom",
    reliable: true,
  }];
}

export function selectValidationWrongIdentity(row, rowsById, fallbackRows = []) {
  for (const hardNegative of row?.hardNegatives || []) {
    const candidate = rowsById.get(hardNegative.cardId);
    if (candidate && candidate.cardId !== row.cardId && candidate.normalizedName !== row.normalizedName) return candidate;
  }
  return fallbackRows.find((candidate) => candidate.cardId !== row?.cardId && candidate.normalizedName !== row?.normalizedName) || null;
}

export function buildValidationEvidenceScenarios(row, wrongRow) {
  const exactName = nameEvidence(row);
  const exactPair = collectorEvidence(row);
  const numberOnly = collectorEvidence(row, { includeTotal: false });
  const fuzzyName = nameEvidence(row, corruptValidationName(row.name));
  const wrongNumber = collectorEvidence(row, { number: corruptValidationCollectorNumber(row.collectorNumber), includeTotal: false });
  const scenarios = [
    { scenario: "strong-exact", expectConfirmation: true, evidence: { nameCandidates: exactName, collectorNumbers: exactPair } },
    { scenario: "number-total", expectConfirmation: true, evidence: { collectorNumbers: exactPair } },
    { scenario: "exact-name", expectConfirmation: true, evidence: { nameCandidates: exactName } },
    { scenario: "fuzzy-name-number-total", expectConfirmation: true, evidence: { nameCandidates: fuzzyName, collectorNumbers: exactPair } },
    { scenario: "exact-name-number-only", expectConfirmation: true, evidence: { nameCandidates: exactName, collectorNumbers: numberOnly } },
    { scenario: "exact-name-one-digit-number-error", expectConfirmation: true, evidence: { nameCandidates: exactName, collectorNumbers: wrongNumber } },
    { scenario: "full-catalog", expectConfirmation: true, evidence: {} },
  ];
  if (wrongRow) {
    const wrongName = nameEvidence(wrongRow);
    const wrongPair = collectorEvidence(wrongRow);
    scenarios.push(
      { scenario: "wrong-strong-identity", expectConfirmation: false, evidence: { nameCandidates: wrongName, collectorNumbers: wrongPair } },
      { scenario: "wrong-exact-name", expectConfirmation: false, evidence: { nameCandidates: wrongName } },
      { scenario: "conflicting-wrong-name-correct-number", expectConfirmation: false, evidence: { nameCandidates: wrongName, collectorNumbers: exactPair } },
    );
  }
  return scenarios;
}

export function projectCandidatePoolForFusion(candidatePool, visualCandidates, maxResults = 5) {
  const required = new Set([
    ...(candidatePool?.candidates || []).slice(0, maxResults).map(({ cardId }) => cardId),
    ...(visualCandidates || []).map(({ cardId }) => cardId),
  ]);
  const candidates = (candidatePool?.candidates || []).filter(({ cardId }) => required.has(cardId));
  return {
    mode: candidatePool?.mode,
    usedFullCatalogFallback: Boolean(candidatePool?.usedFullCatalogFallback),
    evidenceConflict: Boolean(candidatePool?.evidenceConflict),
    query: candidatePool?.query || {},
    stats: candidatePool?.stats || {},
    originalCandidateCount: candidatePool?.candidates?.length || 0,
    projectionPreservesFusionInputs: true,
    candidates,
  };
}

export function validationPartition(expectedId, auditPercent = 30) {
  const bucket = createHash("sha256").update(String(expectedId)).digest().readUInt32BE(0) % 100;
  return bucket < auditPercent ? "audit" : "calibration";
}

function emptySummary() {
  return {
    cases: 0,
    eligibleCases: 0,
    confirmed: 0,
    correct: 0,
    wrong: 0,
    safeNoResult: 0,
    eligibleCorrect: 0,
    negativeConfirmed: 0,
  };
}

export function evaluateFusionPolicy(cases, rankingPolicy, options = {}) {
  const partition = options.partition || null;
  const auditPercent = options.auditPercent ?? 30;
  const summary = emptySummary();
  const byScenario = {};
  const byCorpus = {};
  const wrongExamples = [];
  for (const item of cases) {
    if (partition && validationPartition(item.expectedId, auditPercent) !== partition) continue;
    const scenario = byScenario[item.scenario] ||= emptySummary();
    const corpus = item.corpusId ? (byCorpus[item.corpusId] ||= emptySummary()) : null;
    const result = fuseHybridEvidence({
      candidatePool: item.candidatePool,
      visualCandidates: item.visualCandidates,
      orbCandidates: [],
      catalog: [],
      thresholds: rankingPolicy,
    });
    const confirmedId = result.confirmedCardId;
    const correct = confirmedId === item.expectedId;
    const wrong = Boolean(confirmedId && !correct);
    for (const target of [summary, scenario, corpus].filter(Boolean)) {
      target.cases += 1;
      target.eligibleCases += item.expectConfirmation ? 1 : 0;
      target.confirmed += confirmedId ? 1 : 0;
      target.correct += correct ? 1 : 0;
      target.wrong += wrong ? 1 : 0;
      target.safeNoResult += confirmedId ? 0 : 1;
      target.eligibleCorrect += item.expectConfirmation && correct ? 1 : 0;
      target.negativeConfirmed += !item.expectConfirmation && confirmedId ? 1 : 0;
    }
    if (wrong && wrongExamples.length < (options.maxWrongExamples ?? 20)) {
      wrongExamples.push({ expectedId: item.expectedId, scenario: item.scenario, confirmedId, diagnostics: result.diagnostics });
    }
    if (options.stopAfterWrong && summary.wrong > 0) break;
  }
  summary.eligibleCoverage = summary.eligibleCases ? summary.eligibleCorrect / summary.eligibleCases : 0;
  summary.confirmationPrecision = summary.confirmed ? summary.correct / summary.confirmed : 1;
  summary.zeroWrongUpper95 = summary.wrong === 0 && summary.confirmed > 0
    ? 1 - (0.05 ** (1 / summary.confirmed))
    : null;
  for (const value of [...Object.values(byScenario), ...Object.values(byCorpus)]) {
    value.eligibleCoverage = value.eligibleCases ? value.eligibleCorrect / value.eligibleCases : 0;
    value.confirmationPrecision = value.confirmed ? value.correct / value.confirmed : 1;
  }
  return { summary, byScenario, byCorpus, wrongExamples };
}

function weightProfile(baseWeights, visualFactor, ocrFactor) {
  const weights = { ...baseWeights };
  const tunable = ["visual", "relativeOcr", "exactCollector", "printedTotal", "exactName", "fuzzyName", "set"];
  const targetTotal = tunable.reduce((sum, key) => sum + Number(baseWeights[key] || 0), 0);
  for (const key of tunable) weights[key] = Number(baseWeights[key] || 0) * (key === "visual" ? visualFactor : ocrFactor);
  const actualTotal = tunable.reduce((sum, key) => sum + weights[key], 0) || 1;
  for (const key of tunable) weights[key] = round(weights[key] * targetTotal / actualTotal);
  return weights;
}

function policyAtLevels(base, strongLevel, exactLevel, fullLevel, weights, gapLevel = Math.max(strongLevel, exactLevel, fullLevel) * 0.65) {
  return {
    ...base,
    weights,
    strongOcrAiSimilarity: interpolate(base.strongOcrAiSimilarity, 0.98, strongLevel),
    strongOcrAiMargin: interpolate(base.strongOcrAiMargin, 0.5, strongLevel),
    exactNameAiSimilarity: interpolate(base.exactNameAiSimilarity, 0.98, exactLevel),
    exactNameAiMargin: interpolate(base.exactNameAiMargin, 0.5, exactLevel),
    fullCatalogAiSimilarity: interpolate(base.fullCatalogAiSimilarity, 0.99, fullLevel),
    fullCatalogAiMargin: interpolate(base.fullCatalogAiMargin, 0.5, fullLevel),
    minimumConfirmedFusedGap: interpolate(base.minimumConfirmedFusedGap, 0.5, gapLevel),
  };
}

export function generateConservativePolicyCandidates(base) {
  const levels = [0, 0.25, 0.5, 0.75, 1];
  const weightProfiles = [
    weightProfile(base.weights, 1, 1),
    weightProfile(base.weights, 1.2, 0.9),
    weightProfile(base.weights, 1.4, 0.75),
  ];
  const candidates = [base];
  for (const weights of weightProfiles) {
    for (const strong of levels) for (const exact of levels) for (const full of levels) for (const gap of [0, 0.5, 1]) {
      candidates.push(policyAtLevels(base, strong, exact, full, weights, gap));
    }
    for (let step = 0; step <= 20; step += 1) {
      const level = step / 20;
      candidates.push(policyAtLevels(base, level, level, level, weights, level));
    }
  }
  const unique = new Map(candidates.map((policy) => [JSON.stringify(policy), policy]));
  return [...unique.values()];
}

export function searchConservativeFusionPolicy(cases, basePolicy, options = {}) {
  const policies = generateConservativePolicyCandidates(basePolicy);
  let best = null;
  let bestZeroWrong = null;
  let evaluated = 0;
  let zeroWrongPolicies = 0;
  let viablePolicies = 0;
  const minimumConfirmationsPerCorpus = options.minimumConfirmationsPerCorpus ?? 0;
  const betterThan = (evaluation, current) => {
    if (!current) return true;
    const corpusCoverages = Object.values(evaluation.byCorpus).map(({ eligibleCoverage }) => eligibleCoverage);
    const worstCorpusCoverage = corpusCoverages.length ? Math.min(...corpusCoverages) : evaluation.summary.eligibleCoverage;
    const currentCorpusCoverages = Object.values(current.evaluation.byCorpus).map(({ eligibleCoverage }) => eligibleCoverage);
    const currentWorstCorpusCoverage = currentCorpusCoverages.length
      ? Math.min(...currentCorpusCoverages)
      : current.evaluation.summary.eligibleCoverage;
    return worstCorpusCoverage > currentWorstCorpusCoverage
      || (worstCorpusCoverage === currentWorstCorpusCoverage && evaluation.summary.eligibleCorrect > current.evaluation.summary.eligibleCorrect)
      || (worstCorpusCoverage === currentWorstCorpusCoverage && evaluation.summary.eligibleCorrect === current.evaluation.summary.eligibleCorrect
        && evaluation.summary.confirmed > current.evaluation.summary.confirmed);
  };
  for (const policy of policies) {
    const evaluation = evaluateFusionPolicy(cases, policy, {
      partition: "calibration",
      auditPercent: options.auditPercent ?? 30,
      stopAfterWrong: true,
      maxWrongExamples: 1,
    });
    evaluated += 1;
    if (evaluation.summary.wrong > 0) continue;
    zeroWrongPolicies += 1;
    if (betterThan(evaluation, bestZeroWrong)) bestZeroWrong = { policy, evaluation };
    const corpusSummaries = Object.values(evaluation.byCorpus);
    if (minimumConfirmationsPerCorpus > 0
      && (!corpusSummaries.length || corpusSummaries.some(({ confirmed }) => confirmed < minimumConfirmationsPerCorpus))) continue;
    viablePolicies += 1;
    if (betterThan(evaluation, best)) best = { policy, evaluation };
  }
  return { evaluatedPolicies: evaluated, zeroWrongPolicies, viablePolicies, bestZeroWrong, best };
}

export async function readFusionObservationCorpus(path) {
  const input = readline.createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let metadata = null;
  const cases = [];
  for await (const line of input) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.recordType === "metadata") {
      if (metadata) throw new Error("Fusion observation corpus contains multiple metadata records.");
      metadata = record;
    } else if (record.recordType === "case") cases.push(record);
    else throw new Error(`Unknown fusion observation record type: ${record.recordType}`);
  }
  if (!metadata || metadata.schemaVersion !== FUSION_OBSERVATION_SCHEMA_VERSION) throw new Error("Fusion observation corpus metadata is missing or unsupported.");
  if (!cases.length || new Set(cases.map(({ expectedId }) => expectedId)).size !== metadata.identityCount) throw new Error("Fusion observation corpus identity count is inconsistent.");
  if (cases.length !== metadata.caseCount) throw new Error("Fusion observation corpus case count is inconsistent.");
  return { metadata, cases };
}
