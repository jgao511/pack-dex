import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCANNER_AI_RUNTIME_CONFIG } from "../../src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js";
import { fingerprintRuntimeConfig, sha256Bytes, stableStringify } from "./runtime-freeze-lib.mjs";
import {
  DEFAULT_VALIDATION_IDENTITY_COUNT,
  evaluateFusionPolicy,
  FUSION_SCENARIO_VERSION,
  readFusionObservationCorpus,
  searchConservativeFusionPolicy,
} from "./fusion-calibration-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const argument = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(name);
const mode = argument("--mode", "search");
if (!new Set(["search", "evaluate-current"]).has(mode)) throw new Error("Use --mode search or evaluate-current.");
const protocol = argument("--protocol", "trained-float32-runtime-only-v1");
if (protocol !== "trained-float32-runtime-only-v1") throw new Error("This POC only permits the trained-float32-runtime-only-v1 calibration protocol.");
const observationPaths = argument("--observations", "artifacts/scanner-ai/reports/trained-fusion-validation-observations.jsonl")
  .split(",").map((value) => path.resolve(root, value.trim())).filter(Boolean);
const outputPath = path.resolve(root, argument("--output", mode === "search"
  ? "artifacts/scanner-ai/reports/trained-float32-calibration-policy.json"
  : "artifacts/scanner-ai/reports/fusion-calibration.json"));
const policyFreezePath = mode === "evaluate-current"
  ? path.resolve(root, argument("--policy-freeze", ""))
  : null;
const auditPercent = Number(argument("--audit-percent", "30"));
const expectedCount = Number(argument("--expected-count", String(DEFAULT_VALIDATION_IDENTITY_COUNT)));
const minAuditConfirmations = Number(argument("--min-audit-confirmations", "300"));
const maxZeroWrongUpper95 = Number(argument("--max-zero-wrong-upper95", "0.01"));
const allowPartial = flag("--allow-partial");

if (!Number.isInteger(auditPercent) || auditPercent < 10 || auditPercent > 50) throw new Error("--audit-percent must be an integer from 10 through 50.");
if (!Number.isInteger(minAuditConfirmations) || minAuditConfirmations < 1) throw new Error("--min-audit-confirmations must be positive.");
if (allowPartial) throw new Error("The trained-float32 runtime calibration protocol does not allow partial corpora.");
if (observationPaths.length !== 1) throw new Error("Trained-float32 runtime calibration requires exactly one trained observation corpus.");
if (mode === "evaluate-current" && !argument("--policy-freeze", "")) throw new Error("The untouched audit requires --policy-freeze from the completed calibration search.");
const corpora = await Promise.all(observationPaths.map(async (observationPath) => {
  const corpus = await readFusionObservationCorpus(observationPath);
  if (corpus.metadata.scenarioVersion !== FUSION_SCENARIO_VERSION || corpus.metadata.lockedPixelInputsUsed !== false || corpus.metadata.simulatedOcrEvidence !== true) {
    throw new Error(`Fusion observations do not use the reviewed validation-only scenario contract: ${observationPath}`);
  }
  if (corpus.metadata.partial || corpus.metadata.identityCount !== expectedCount) {
    throw new Error(`Freeze calibration requires exactly ${expectedCount} complete unseen validation identities per model.`);
  }
  if (corpus.metadata.modelVersion !== "packdex-mnv3s-d128-20260713-float32"
    || corpus.metadata.modelFileSha256 !== "62f2ff60cfdb09714a01fa74343e4dc1968601c2a43046979cbc548c28027c7c"
    || corpus.metadata.indexVersion !== "packdex-index-20260713-float32") {
    throw new Error("Trained-float32 runtime calibration must use the selected deployed float32 model and index.");
  }
  const corpusId = `${corpus.metadata.modelVersion}::${corpus.metadata.indexVersion}`;
  return { ...corpus, corpusId, cases: corpus.cases.map((item) => ({ ...item, corpusId })) };
}));
if (new Set(corpora.map(({ metadata }) => metadata.catalogCardsSha256)).size !== 1) throw new Error("All fusion corpora must use the same trusted catalog.");
const cases = corpora.flatMap((corpus) => corpus.cases);

const configSha256 = fingerprintRuntimeConfig(SCANNER_AI_RUNTIME_CONFIG);
const dataBindings = corpora.map(({ corpusId, metadata }) => ({
  corpusId,
  scenarioVersion: metadata.scenarioVersion,
  identityCount: metadata.identityCount,
  caseCount: metadata.caseCount,
  modelVersion: metadata.modelVersion,
  modelFileSha256: metadata.modelFileSha256,
  indexVersion: metadata.indexVersion,
  indexMetadataSha256: metadata.indexMetadataSha256,
  indexVectorSha256: metadata.indexVectorSha256,
  queryMetadataSha256: metadata.queryMetadataSha256,
  queryVectorSha256: metadata.queryVectorSha256,
  catalogCardsSha256: metadata.catalogCardsSha256,
}));
const evaluateByCorpus = (policy, partition) => Object.fromEntries(corpora.map(({ corpusId, cases: corpusCases }) => [
  corpusId,
  evaluateFusionPolicy(corpusCases, policy, { partition, auditPercent }),
]));
let policyFreeze = null;
if (policyFreezePath) {
  const bytes = await readFile(policyFreezePath);
  policyFreeze = JSON.parse(bytes.toString("utf8"));
  const frozenRankingSha256 = sha256Bytes(stableStringify(policyFreeze.recommendedRanking));
  if (policyFreeze.schemaVersion !== 1 || policyFreeze.mode !== "search"
    || policyFreeze.status !== "trained-float32-policy-predeclared"
    || policyFreeze.calibrationProtocol !== protocol
    || policyFreeze.auditPartitionEvaluated !== false
    || policyFreeze.lockedPixelInputsUsed !== false
    || policyFreeze.recommendedRankingSha256 !== frozenRankingSha256
    || frozenRankingSha256 !== sha256Bytes(stableStringify(SCANNER_AI_RUNTIME_CONFIG.ranking))
    || JSON.stringify(policyFreeze.dataBindings) !== JSON.stringify(dataBindings)) {
    throw new Error("The audit runtime policy or trained-float32 corpus does not match the frozen pre-audit policy record.");
  }
}
let report;
let failed = false;

if (mode === "search") {
  const currentCalibration = evaluateFusionPolicy(cases, SCANNER_AI_RUNTIME_CONFIG.ranking, { partition: "calibration", auditPercent });
  const currentCalibrationByCorpus = evaluateByCorpus(SCANNER_AI_RUNTIME_CONFIG.ranking, "calibration");
  const search = searchConservativeFusionPolicy(cases, SCANNER_AI_RUNTIME_CONFIG.ranking, {
    auditPercent,
    minimumConfirmationsPerCorpus: minAuditConfirmations,
  });
  failed = !search.best;
  report = {
    schemaVersion: 1,
    mode,
    status: search.best ? "trained-float32-policy-predeclared" : "no-policy-meets-calibration-safety-and-support-gates",
    generatedAt: new Date().toISOString(),
    purpose: "Validation-only recommendation. The audit partition is intentionally not evaluated in search mode.",
    validationOnly: true,
    calibrationProtocol: protocol,
    runtimeModelRole: "trained-float32",
    lockedPixelInputsUsed: false,
    auditPartitionEvaluated: false,
    auditPercent,
    corpusCount: corpora.length,
    baseConfigVersion: SCANNER_AI_RUNTIME_CONFIG.configVersion,
    baseConfigSha256: configSha256,
    dataBindings,
    search: {
      evaluatedPolicies: search.evaluatedPolicies,
      zeroWrongPolicies: search.zeroWrongPolicies,
      viablePolicies: search.viablePolicies,
      minimumCalibrationConfirmationsPerCorpus: minAuditConfirmations,
      selectionRule: "zero observed wrong confirmations and minimum trained-float32 confirmation support on calibration identities, then maximum eligible coverage, eligible correct confirmations, and confirmations",
    },
    currentCalibration,
    currentCalibrationByCorpus,
    recommendedRanking: search.best?.policy || null,
    recommendedRankingSha256: search.best ? sha256Bytes(stableStringify(search.best.policy)) : null,
    recommendedCalibration: search.best?.evaluation || null,
    blockerDiagnostics: search.best ? null : {
      reason: "Every zero-wrong policy falls below the predeclared minimum calibration confirmation support in at least one corpus.",
      bestZeroWrongRanking: search.bestZeroWrong?.policy || null,
      bestZeroWrongCalibration: search.bestZeroWrong?.evaluation || null,
    },
    nextStep: search.best
      ? "This file is the frozen pre-audit policy record. Apply its exact recommended ranking, bump configVersion, then run --mode evaluate-current with --policy-freeze exactly once on the untouched audit partition."
      : "Do not evaluate the untouched audit partition. Improve the pre-audit model/fusion design or predeclare a new independent validation design, then rebuild the trained-float32 corpus and search again.",
  };
} else {
  const audit = evaluateFusionPolicy(cases, SCANNER_AI_RUNTIME_CONFIG.ranking, { partition: "audit", auditPercent });
  const auditByCorpus = evaluateByCorpus(SCANNER_AI_RUNTIME_CONFIG.ranking, "audit");
  const corpusPass = Object.values(auditByCorpus).every(({ summary }) => summary.wrong === 0
    && summary.confirmed >= minAuditConfirmations
    && summary.zeroWrongUpper95 != null
    && summary.zeroWrongUpper95 <= maxZeroWrongUpper95);
  const pass = corpusPass && audit.summary.wrong === 0;
  failed = !pass;
  report = {
    schemaVersion: 1,
    mode,
    status: pass ? "pass" : "fail",
    generatedAt: new Date().toISOString(),
    purpose: "One-time untouched validation audit of the exact versioned runtime fusion policy before holdout freeze.",
    validationOnly: true,
    calibrationProtocol: protocol,
    runtimeModelRole: "trained-float32",
    lockedPixelInputsUsed: false,
    auditPercent,
    corpusCount: corpora.length,
    validatedConfigVersion: SCANNER_AI_RUNTIME_CONFIG.configVersion,
    validatedConfigSha256: configSha256,
    validatedRankingSha256: sha256Bytes(stableStringify(SCANNER_AI_RUNTIME_CONFIG.ranking)),
    preAuditPolicyFreeze: {
      path: path.relative(root, policyFreezePath).replaceAll(path.sep, "/"),
      sha256: sha256Bytes(await readFile(policyFreezePath)),
      recommendedRankingSha256: policyFreeze.recommendedRankingSha256,
    },
    dataBindings,
    requirements: {
      wrongConfirmations: 0,
      minimumConfirmationsPerCorpus: minAuditConfirmations,
      maximumOneSided95WrongRatePerCorpus: maxZeroWrongUpper95,
    },
    audit,
    auditByCorpus,
    limitations: [
      "OCR evidence is deterministic simulation through the real candidate builder, not device ML Kit output.",
      "Queries are seeded camera-like transforms of trusted in-catalog cards; non-card and out-of-catalog negatives are not represented.",
      "ORB is disabled and is not calibrated by this report.",
    ],
  };
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${mode} fusion calibration report to ${outputPath}`);
console.log(JSON.stringify(mode === "search" ? report.recommendedCalibration?.summary || report.status : report.audit.summary, null, 2));
if (failed && !allowPartial) process.exitCode = 1;
