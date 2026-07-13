import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, rename, rm, mkdir } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getScannerCatalog } from "../../src/lib/cardScanner/buildScannerCatalog.js";
import { createCatalogCandidateIndex, buildCatalogCandidates } from "../../src/lib/cardScanner/aiVisual/catalogCandidateIndex.js";
import { createTypedEmbeddingIndex } from "../../src/lib/cardScanner/aiVisual/embeddingSearch.js";
import { SCANNER_AI_RUNTIME_CONFIG } from "../../src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js";
import { readAndVerifyCatalogManifest, sha256Bytes } from "./runtime-freeze-lib.mjs";
import {
  buildValidationEvidenceScenarios,
  DEFAULT_VALIDATION_IDENTITY_COUNT,
  FUSION_OBSERVATION_SCHEMA_VERSION,
  FUSION_SCENARIO_VERSION,
  projectCandidatePoolForFusion,
  selectValidationWrongIdentity,
} from "./fusion-calibration-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const argument = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(name);
const resolveRoot = (value) => path.resolve(root, value);
const metadataPath = resolveRoot(argument("--index-metadata", "mobile-app/android/app/src/scannerAi/assets/public/scanner-ai/catalog-embeddings.meta.json"));
const queryMetadataPath = resolveRoot(argument("--query-metadata", "artifacts/scanner-ai/generated/validation-queries.meta.json"));
const trainingManifestPath = resolveRoot(argument("--manifest", "artifacts/scanner-ai/generated/training-manifest.jsonl"));
const catalogManifestPath = resolveRoot(argument("--catalog-manifest", "artifacts/scanner-ai/catalog-manifest.json"));
const outputPath = resolveRoot(argument("--output", "artifacts/scanner-ai/reports/fusion-validation-observations.jsonl"));
const expectedCount = Number(argument("--expected-count", String(DEFAULT_VALIDATION_IDENTITY_COUNT)));
const allowPartial = flag("--allow-partial");

function decodeFloat32LittleEndian(buffer) {
  if (buffer.byteLength % 4) throw new Error("Validation query vector bytes are not float32-aligned.");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const values = new Float32Array(buffer.byteLength / 4);
  for (let offset = 0; offset < buffer.byteLength; offset += 4) values[offset / 4] = view.getFloat32(offset, true);
  return values;
}

function scoreCandidateIds(query, index, candidateIds) {
  const scores = new Map();
  for (const cardId of candidateIds) {
    const position = index.cardIdToIndex.get(cardId);
    if (!Number.isInteger(position)) continue;
    const vectorOffset = position * index.dimensions;
    let score = 0;
    for (let dimension = 0; dimension < index.dimensions; dimension += 1) score += query[dimension] * index.vectors[vectorOffset + dimension];
    scores.set(cardId, score);
  }
  return scores;
}

function rankCandidatePool(candidatePool, scores) {
  const limit = Math.max(1, Math.min(candidatePool.candidateIds.length, SCANNER_AI_RUNTIME_CONFIG.search.narrowedPoolLimit));
  return candidatePool.candidateIds
    .map((cardId) => scores.has(cardId) ? ({ cardId, visualScore: scores.get(cardId) }) : null)
    .filter(Boolean)
    .sort((left, right) => right.visualScore - left.visualScore || left.cardId.localeCompare(right.cardId))
    .slice(0, limit);
}

async function writeLine(stream, value) {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, "drain");
}

const [indexMetadataBytes, queryMetadataBytes, trainingManifestBytes] = await Promise.all([
  readFile(metadataPath), readFile(queryMetadataPath), readFile(trainingManifestPath),
]);
const indexMetadata = JSON.parse(indexMetadataBytes.toString("utf8"));
const queryMetadata = JSON.parse(queryMetadataBytes.toString("utf8"));
if (queryMetadata.schemaVersion !== 1 || queryMetadata.kind !== "packdex-scanner-ai-validation-queries" || queryMetadata.lockedPixelInputsUsed !== false) {
  throw new Error("Validation query metadata is incomplete or unsafe.");
}
if (!Array.isArray(queryMetadata.expectedIds)
  || queryMetadata.expectedIds.length !== queryMetadata.count
  || new Set(queryMetadata.expectedIds).size !== queryMetadata.count) {
  throw new Error("Validation query identities are missing, duplicated, or inconsistent with count.");
}
if (!Array.isArray(indexMetadata.cardIds)
  || indexMetadata.cardIds.length !== indexMetadata.count
  || new Set(indexMetadata.cardIds).size !== indexMetadata.count) {
  throw new Error("Index card IDs are missing, duplicated, or inconsistent with count.");
}
if (queryMetadata.partial && !allowPartial) throw new Error("Partial validation queries cannot calibrate a freeze policy.");
if (!allowPartial && queryMetadata.count !== expectedCount) throw new Error(`Expected ${expectedCount} unseen validation identities, found ${queryMetadata.count}.`);
if (queryMetadata.indexMetadataSha256 !== sha256Bytes(indexMetadataBytes)) throw new Error("Validation queries were generated against different index metadata.");

for (const [label, fileName] of [["index vectorFile", indexMetadata.vectorFile], ["query vectorFile", queryMetadata.vectorFile]]) {
  if (typeof fileName !== "string" || !fileName || path.isAbsolute(fileName) || path.basename(fileName) !== fileName) {
    throw new Error(`${label} must be a sibling filename.`);
  }
}
const vectorPath = path.resolve(path.dirname(metadataPath), indexMetadata.vectorFile);
const queryVectorPath = path.resolve(path.dirname(queryMetadataPath), queryMetadata.vectorFile);
const [indexVectorBytes, queryVectorBytes] = await Promise.all([readFile(vectorPath), readFile(queryVectorPath)]);
if (sha256Bytes(indexVectorBytes) !== indexMetadata.vectorSha256 || queryMetadata.indexVectorSha256 !== indexMetadata.vectorSha256) {
  throw new Error("Validation queries or deployed vectors do not match the exact index.");
}
if (sha256Bytes(queryVectorBytes) !== queryMetadata.vectorSha256) throw new Error("Validation query vector checksum is invalid.");
if (sha256Bytes(trainingManifestBytes) !== queryMetadata.trainingManifestSha256) throw new Error("Validation query training-manifest binding is invalid.");
const { cardsSha256: catalogCardsSha256 } = await readAndVerifyCatalogManifest(catalogManifestPath);
if (queryMetadata.catalogCardsSha256 !== catalogCardsSha256) throw new Error("Validation queries do not match the current trusted catalog.");

const rows = trainingManifestBytes.toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const rowsById = new Map(rows.map((row) => [row.cardId, row]));
const validationRows = queryMetadata.expectedIds.map((cardId) => rowsById.get(cardId));
if (validationRows.some((row) => !row || row.split !== "validation")) throw new Error("Validation query IDs are not the exact unseen-identity split.");
const expectedIdsSha256 = sha256Bytes(Buffer.from(`${queryMetadata.expectedIds.join("\n")}\n`));
if (expectedIdsSha256 !== queryMetadata.expectedIdsSha256) throw new Error("Validation query identity ordering checksum is invalid.");
if (!Array.isArray(queryMetadata.fullCatalogCandidates) || queryMetadata.fullCatalogCandidates.length !== validationRows.length) {
  throw new Error("Validation query metadata is missing exact full-catalog rankings.");
}
const retrieval = queryMetadata.fullCatalogRetrieval;
const expectedRanks = queryMetadata.expectedIds.map((expectedId, index) => {
  const candidates = queryMetadata.fullCatalogCandidates[index];
  if (!Array.isArray(candidates) || candidates.length < 3
    || new Set(candidates.map(({ cardId }) => cardId)).size !== candidates.length
    || candidates.some(({ cardId, visualScore }) => typeof cardId !== "string" || !Number.isFinite(visualScore))) {
    throw new Error(`Validation query ${expectedId} has an invalid full-catalog ranking.`);
  }
  const position = candidates.findIndex(({ cardId }) => cardId === expectedId);
  return position < 0 ? null : position + 1;
});
const top1Correct = expectedRanks.filter((rank) => rank === 1).length;
const top3Correct = expectedRanks.filter((rank) => rank != null && rank <= 3).length;
if (!retrieval || retrieval.candidateLimit < 3
  || retrieval.top1Correct !== top1Correct || retrieval.top3Correct !== top3Correct
  || Math.abs(retrieval.top1Accuracy - top1Correct / validationRows.length) > 1e-12
  || Math.abs(retrieval.top3Accuracy - top3Correct / validationRows.length) > 1e-12) {
  throw new Error("Validation query full-catalog retrieval summary is missing or inconsistent.");
}

const catalog = getScannerCatalog();
const trustedIds = new Set(catalog.map(({ cardId }) => cardId));
if (indexMetadata.cardIds.length !== trustedIds.size || indexMetadata.cardIds.some((cardId) => !trustedIds.has(cardId))) {
  throw new Error("Calibration requires exact full trusted-catalog index coverage.");
}
if (queryMetadata.fullCatalogCandidates.some((candidates) => candidates.some(({ cardId }) => !trustedIds.has(cardId)))) {
  throw new Error("Validation query full-catalog rankings contain an untrusted card ID.");
}
const index = createTypedEmbeddingIndex({ ...indexMetadata, indexMetadataSha256: sha256Bytes(indexMetadataBytes) }, indexVectorBytes);
const queryVectors = decodeFloat32LittleEndian(queryVectorBytes);
if (queryVectors.length !== validationRows.length * index.dimensions || queryMetadata.dimensions !== index.dimensions) {
  throw new Error("Validation query dimensions do not match the deployed index.");
}
const candidateIndex = createCatalogCandidateIndex(catalog);
const plans = validationRows.map((row) => {
  const wrongRow = selectValidationWrongIdentity(row, rowsById, validationRows);
  return { row, scenarios: buildValidationEvidenceScenarios(row, wrongRow) };
});
const scenarioCounts = {};
for (const { scenarios } of plans) for (const { scenario } of scenarios) scenarioCounts[scenario] = (scenarioCounts[scenario] || 0) + 1;
const caseCount = Object.values(scenarioCounts).reduce((sum, count) => sum + count, 0);

await mkdir(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp`;
await rm(temporaryPath, { force: true });
const stream = createWriteStream(temporaryPath, { encoding: "utf8" });
const started = performance.now();
await writeLine(stream, {
  recordType: "metadata",
  schemaVersion: FUSION_OBSERVATION_SCHEMA_VERSION,
  scenarioVersion: FUSION_SCENARIO_VERSION,
  generatedAt: new Date().toISOString(),
  identityCount: validationRows.length,
  caseCount,
  scenarioCounts,
  partial: Boolean(queryMetadata.partial),
  lockedPixelInputsUsed: false,
  simulatedOcrEvidence: true,
  actualCandidateBuilder: "src/lib/cardScanner/aiVisual/catalogCandidateIndex.js",
  actualEmbeddingSearchContract: "normalized exact cosine over deployed float16 index",
  modelVersion: queryMetadata.modelVersion,
  modelFileSha256: queryMetadata.modelFileSha256,
  indexVersion: indexMetadata.indexVersion,
  indexMetadataSha256: sha256Bytes(indexMetadataBytes),
  indexVectorSha256: indexMetadata.vectorSha256,
  queryMetadataSha256: sha256Bytes(queryMetadataBytes),
  queryVectorSha256: queryMetadata.vectorSha256,
  fullCatalogRetrieval: queryMetadata.fullCatalogRetrieval || null,
  catalogCardsSha256,
});

for (let queryIndex = 0; queryIndex < plans.length; queryIndex += 1) {
  const { row, scenarios } = plans[queryIndex];
  const queryOffset = queryIndex * index.dimensions;
  const query = queryVectors.subarray(queryOffset, queryOffset + index.dimensions);
  let normSquared = 0;
  for (const value of query) {
    if (!Number.isFinite(value)) throw new Error(`Validation query ${row.cardId} contains a non-finite value.`);
    normSquared += value * value;
  }
  if (Math.abs(Math.sqrt(normSquared) - 1) > 0.005) throw new Error(`Validation query ${row.cardId} is not L2-normalized.`);
  const pools = scenarios.map((scenario) => ({ scenario, candidatePool: buildCatalogCandidates(candidateIndex, scenario.evidence) }));
  const narrowedIds = new Set(pools.filter(({ candidatePool }) => !candidatePool.usedFullCatalogFallback).flatMap(({ candidatePool }) => candidatePool.candidateIds));
  const scores = scoreCandidateIds(query, index, narrowedIds);
  for (const { scenario, candidatePool } of pools) {
    const visualCandidates = candidatePool.usedFullCatalogFallback
      ? queryMetadata.fullCatalogCandidates[queryIndex].slice(0, SCANNER_AI_RUNTIME_CONFIG.search.fullCatalogLimit)
      : rankCandidatePool(candidatePool, scores);
    if (!visualCandidates.length || visualCandidates.some(({ cardId, visualScore }) => !trustedIds.has(cardId) || !Number.isFinite(visualScore))) {
      throw new Error(`Validation scenario ${scenario.scenario}/${row.cardId} has an invalid visual ranking.`);
    }
    await writeLine(stream, {
      recordType: "case",
      expectedId: row.cardId,
      scenario: scenario.scenario,
      expectConfirmation: scenario.expectConfirmation,
      evidence: scenario.evidence,
      candidatePool: projectCandidatePoolForFusion(candidatePool, visualCandidates, SCANNER_AI_RUNTIME_CONFIG.ranking.maxResults),
      visualCandidates,
    });
  }
  if ((queryIndex + 1) % 100 === 0 || queryIndex + 1 === plans.length) console.log(`Built fusion observations ${queryIndex + 1}/${plans.length}`);
}

stream.end();
await once(stream, "finish");
await rename(temporaryPath, outputPath);
console.log(`Wrote ${caseCount} validation-only fusion cases to ${outputPath} in ${Math.round(performance.now() - started)} ms`);
