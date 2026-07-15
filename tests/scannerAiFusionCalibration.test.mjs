import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SCANNER_AI_RUNTIME_CONFIG } from "../src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js";
import {
  buildValidationEvidenceScenarios,
  corruptValidationCollectorNumber,
  corruptValidationName,
  evaluateFusionPolicy,
  generateConservativePolicyCandidates,
  projectCandidatePoolForFusion,
  searchConservativeFusionPolicy,
  validationPartition,
} from "../scripts/scanner-ai/fusion-calibration-lib.mjs";

function identityFor(partition) {
  for (let index = 0; index < 10_000; index += 1) {
    const cardId = `calibration-card-${index}`;
    if (validationPartition(cardId) === partition) return cardId;
  }
  throw new Error(`Could not find ${partition} fixture identity`);
}

function candidate(cardId, evidenceScore = 80) {
  return { cardId, evidenceScore, reasons: [{ code: "name-exact", family: "name", weight: 80 }] };
}

test("validation evidence scenarios are deterministic and include positive and adversarial OCR channels", () => {
  const row = { cardId: "expected", name: "Charizard", normalizedName: "charizard", collectorNumber: "13", printedTotal: "94" };
  const wrong = { cardId: "wrong", name: "Pikachu", normalizedName: "pikachu", collectorNumber: "58", printedTotal: "102" };
  const scenarios = buildValidationEvidenceScenarios(row, wrong);
  assert.equal(scenarios.length, 10);
  assert.equal(scenarios.filter(({ expectConfirmation }) => expectConfirmation).length, 7);
  assert.equal(corruptValidationName("Charizard"), corruptValidationName("Charizard"));
  assert.notEqual(corruptValidationName("Charizard"), "Charizard");
  assert.equal(corruptValidationCollectorNumber("TG13"), "TG23");
});

test("candidate-pool projection preserves every candidate the real fusion scorer can consume", () => {
  const pool = { mode: "exact-name", candidates: [candidate("a"), candidate("b"), candidate("c"), candidate("d"), candidate("e"), candidate("f")] };
  const projected = projectCandidatePoolForFusion(pool, [{ cardId: "f", visualScore: 0.9 }, { cardId: "outside", visualScore: 0.8 }], 5);
  assert.deepEqual(projected.candidates.map(({ cardId }) => cardId), ["a", "b", "c", "d", "e", "f"]);
  assert.equal(projected.originalCandidateCount, 6);
});

test("calibration search uses only calibration identities and finds a zero-wrong conservative policy", () => {
  const expectedId = identityFor("calibration");
  const wrongId = "wrong-card";
  const positive = {
    expectedId,
    scenario: "exact-name",
    expectConfirmation: true,
    candidatePool: { mode: "exact-name", usedFullCatalogFallback: false, candidates: [candidate(expectedId), candidate(wrongId, 70)] },
    visualCandidates: [{ cardId: expectedId, visualScore: 0.9 }, { cardId: wrongId, visualScore: 0.6 }],
  };
  const adversarial = {
    expectedId,
    scenario: "wrong-exact-name",
    expectConfirmation: false,
    candidatePool: { mode: "exact-name", usedFullCatalogFallback: false, candidates: [candidate(wrongId)] },
    visualCandidates: [{ cardId: wrongId, visualScore: 0.4 }],
  };
  const unsafe = {
    ...SCANNER_AI_RUNTIME_CONFIG.ranking,
    exactNameAiSimilarity: 0.1,
    exactNameAiMargin: 0,
    minimumConfirmedFusedGap: 0,
  };
  assert.equal(evaluateFusionPolicy([positive, adversarial], unsafe, { partition: "calibration" }).summary.wrong, 1);
  const search = searchConservativeFusionPolicy([positive, adversarial], unsafe);
  assert.ok(search.best);
  assert.equal(search.best.evaluation.summary.wrong, 0);
  assert.equal(search.best.evaluation.summary.eligibleCorrect, 1);
  assert.ok(search.best.policy.exactNameAiSimilarity > 0.4);
  // The policy grid is intentionally bounded; its size is not a safety gate.
  assert.ok(generateConservativePolicyCandidates(unsafe).length > 0);
});

test("shared calibration selection preserves zero-wrong coverage in both model corpora", () => {
  const expectedId = identityFor("calibration");
  const wrongId = "wrong-card";
  const positive = {
    expectedId,
    scenario: "exact-name",
    expectConfirmation: true,
    candidatePool: { mode: "exact-name", usedFullCatalogFallback: false, candidates: [candidate(expectedId), candidate(wrongId, 70)] },
    visualCandidates: [{ cardId: expectedId, visualScore: 0.9 }, { cardId: wrongId, visualScore: 0.6 }],
  };
  const adversarial = {
    expectedId,
    scenario: "wrong-exact-name",
    expectConfirmation: false,
    candidatePool: { mode: "exact-name", usedFullCatalogFallback: false, candidates: [candidate(wrongId)] },
    visualCandidates: [{ cardId: wrongId, visualScore: 0.4 }],
  };
  const cases = ["generic-model", "trained-model"].flatMap((corpusId) => [
    { ...positive, corpusId },
    { ...adversarial, corpusId },
  ]);
  const unsafe = {
    ...SCANNER_AI_RUNTIME_CONFIG.ranking,
    exactNameAiSimilarity: 0.1,
    exactNameAiMargin: 0,
    minimumConfirmedFusedGap: 0,
  };
  const search = searchConservativeFusionPolicy(cases, unsafe);
  assert.ok(search.best);
  assert.equal(search.best.evaluation.summary.wrong, 0);
  assert.deepEqual(Object.keys(search.best.evaluation.byCorpus).sort(), ["generic-model", "trained-model"]);
  for (const summary of Object.values(search.best.evaluation.byCorpus)) {
    assert.equal(summary.wrong, 0);
    assert.equal(summary.eligibleCorrect, 1);
    assert.equal(summary.eligibleCoverage, 1);
  }
  assert.equal(searchConservativeFusionPolicy(cases, unsafe, { minimumConfirmationsPerCorpus: 2 }).best, null);
});

test("calibration tooling is validation-catalog-only and keeps audit evaluation separate", async () => {
  const producer = await readFile(new URL("../scripts/scanner-ai/build-validation-query-embeddings.py", import.meta.url), "utf8");
  const builder = await readFile(new URL("../scripts/scanner-ai/build-fusion-validation-observations.mjs", import.meta.url), "utf8");
  const calibrator = await readFile(new URL("../scripts/scanner-ai/calibrate-fusion.mjs", import.meta.url), "utf8");
  for (const source of [producer, builder, calibrator]) assert.doesNotMatch(source, /tests[\\/]fixtures[\\/]scanner/i);
  assert.match(producer, /row\.get\("split"\) == "validation"/);
  assert.match(builder, /row\.split !== "validation"/);
  assert.match(calibrator, /auditPartitionEvaluated: false/);
  assert.match(calibrator, /--mode evaluate-current/);
  assert.match(calibrator, /trained-float32-runtime-only-v1/);
  assert.match(calibrator, /observationPaths\.length !== 1/);
  assert.match(calibrator, /--policy-freeze/);
  assert.match(calibrator, /auditByCorpus/);
  const freeze = await readFile(new URL("../scripts/scanner-ai/freeze-runtime.mjs", import.meta.url), "utf8");
  assert.match(freeze, /calibrationReport\.corpusCount !== 1/);
  assert.match(freeze, /summary\?\.wrong !== 0 \|\| summary\?\.confirmed < 300/);
});
