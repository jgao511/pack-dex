import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Bytes } from "./runtime-freeze-lib.mjs";
import { DEFAULT_VALIDATION_IDENTITY_COUNT } from "./fusion-calibration-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const argument = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(name);
const baselinePath = path.resolve(root, argument("--baseline", "artifacts/scanner-ai/generated/trained-float32-validation/validation-queries.meta.json"));
const candidatePath = path.resolve(root, argument("--candidate", "artifacts/scanner-ai/generated/trained-float16-validation/validation-queries.meta.json"));
const outputPath = path.resolve(root, argument("--output", "artifacts/scanner-ai/reports/trained-float16-retrieval-preservation.json"));
const expectedCount = Number(argument("--expected-count", String(DEFAULT_VALIDATION_IDENTITY_COUNT)));
const allowPartial = flag("--allow-partial");

function decodeFloat32LittleEndian(bytes) {
  if (bytes.byteLength % 4) throw new Error("Validation query vector bytes are not float32-aligned.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(bytes.byteLength / 4);
  for (let offset = 0; offset < bytes.byteLength; offset += 4) values[offset / 4] = view.getFloat32(offset, true);
  return values;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

async function readQueries(metadataPath) {
  const metadataBytes = await readFile(metadataPath);
  const metadata = JSON.parse(metadataBytes.toString("utf8"));
  if (metadata.schemaVersion !== 1 || metadata.kind !== "packdex-scanner-ai-validation-queries"
    || metadata.lockedPixelInputsUsed !== false || (!allowPartial && metadata.partial)) {
    throw new Error(`Unsafe, partial, or unsupported validation queries: ${metadataPath}`);
  }
  if (!allowPartial && metadata.count !== expectedCount) throw new Error(`Expected ${expectedCount} identities in ${metadataPath}.`);
  if (!Array.isArray(metadata.expectedIds) || metadata.expectedIds.length !== metadata.count
    || new Set(metadata.expectedIds).size !== metadata.count
    || !Array.isArray(metadata.fullCatalogCandidates) || metadata.fullCatalogCandidates.length !== metadata.count) {
    throw new Error(`Validation identity/ranking arrays are inconsistent: ${metadataPath}`);
  }
  const vectorFile = metadata.vectorFile;
  if (typeof vectorFile !== "string" || !vectorFile || path.isAbsolute(vectorFile) || path.basename(vectorFile) !== vectorFile) {
    throw new Error(`Validation query vectorFile must be a sibling filename: ${metadataPath}`);
  }
  const vectorBytes = await readFile(path.resolve(path.dirname(metadataPath), vectorFile));
  if (sha256Bytes(vectorBytes) !== metadata.vectorSha256) throw new Error(`Validation query checksum failed: ${metadataPath}`);
  const vectors = decodeFloat32LittleEndian(vectorBytes);
  if (vectors.length !== metadata.count * metadata.dimensions) throw new Error(`Validation vector dimensions are inconsistent: ${metadataPath}`);
  return { metadataPath, metadataBytes, metadata, vectors };
}

const [baseline, candidate] = await Promise.all([readQueries(baselinePath), readQueries(candidatePath)]);
for (const field of ["count", "dimensions", "seed", "trainingManifestSha256", "catalogCardsSha256", "expectedIdsSha256"]) {
  if (baseline.metadata[field] !== candidate.metadata[field]) throw new Error(`Baseline and candidate differ in ${field}.`);
}
if (JSON.stringify(baseline.metadata.expectedIds) !== JSON.stringify(candidate.metadata.expectedIds)) {
  throw new Error("Baseline and candidate validation identity ordering differs.");
}

let top1Same = 0;
let top3OrderedSame = 0;
let top3SetSame = 0;
let top3IntersectionTotal = 0;
let top1BothCorrect = 0;
let top1BaselineOnlyCorrect = 0;
let top1CandidateOnlyCorrect = 0;
let top3BothCorrect = 0;
let top3BaselineOnlyCorrect = 0;
let top3CandidateOnlyCorrect = 0;
const queryCosines = [];
for (let index = 0; index < baseline.metadata.count; index += 1) {
  const expectedId = baseline.metadata.expectedIds[index];
  const baselineTop3 = baseline.metadata.fullCatalogCandidates[index].slice(0, 3).map(({ cardId }) => cardId);
  const candidateTop3 = candidate.metadata.fullCatalogCandidates[index].slice(0, 3).map(({ cardId }) => cardId);
  if (baselineTop3.length !== 3 || candidateTop3.length !== 3) throw new Error(`Top-3 ranking is incomplete for ${expectedId}.`);
  if (baselineTop3[0] === candidateTop3[0]) top1Same += 1;
  if (JSON.stringify(baselineTop3) === JSON.stringify(candidateTop3)) top3OrderedSame += 1;
  const baselineSet = new Set(baselineTop3);
  const candidateSet = new Set(candidateTop3);
  const intersection = [...baselineSet].filter((cardId) => candidateSet.has(cardId)).length;
  top3IntersectionTotal += intersection;
  if (intersection === 3) top3SetSame += 1;
  const baselineTop1Correct = baselineTop3[0] === expectedId;
  const candidateTop1Correct = candidateTop3[0] === expectedId;
  if (baselineTop1Correct && candidateTop1Correct) top1BothCorrect += 1;
  else if (baselineTop1Correct) top1BaselineOnlyCorrect += 1;
  else if (candidateTop1Correct) top1CandidateOnlyCorrect += 1;
  const baselineTop3Correct = baselineSet.has(expectedId);
  const candidateTop3Correct = candidateSet.has(expectedId);
  if (baselineTop3Correct && candidateTop3Correct) top3BothCorrect += 1;
  else if (baselineTop3Correct) top3BaselineOnlyCorrect += 1;
  else if (candidateTop3Correct) top3CandidateOnlyCorrect += 1;

  const offset = index * baseline.metadata.dimensions;
  let dot = 0;
  let baselineNorm = 0;
  let candidateNorm = 0;
  for (let dimension = 0; dimension < baseline.metadata.dimensions; dimension += 1) {
    const left = baseline.vectors[offset + dimension];
    const right = candidate.vectors[offset + dimension];
    if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error(`Non-finite query vector for ${expectedId}.`);
    dot += left * right;
    baselineNorm += left * left;
    candidateNorm += right * right;
  }
  queryCosines.push(dot / Math.sqrt(baselineNorm * candidateNorm));
}
queryCosines.sort((left, right) => left - right);
const count = baseline.metadata.count;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  purpose: "Deterministic unseen-validation retrieval preservation; no locked Pixel inputs.",
  validationOnly: true,
  lockedPixelInputsUsed: false,
  count,
  dataBindings: {
    baseline: {
      metadataPath: path.relative(root, baselinePath).replaceAll(path.sep, "/"),
      metadataSha256: sha256Bytes(baseline.metadataBytes),
      queryVectorSha256: baseline.metadata.vectorSha256,
      modelVersion: baseline.metadata.modelVersion,
      modelFileSha256: baseline.metadata.modelFileSha256,
      indexVersion: baseline.metadata.indexVersion,
      indexVectorSha256: baseline.metadata.indexVectorSha256,
    },
    candidate: {
      metadataPath: path.relative(root, candidatePath).replaceAll(path.sep, "/"),
      metadataSha256: sha256Bytes(candidate.metadataBytes),
      queryVectorSha256: candidate.metadata.vectorSha256,
      modelVersion: candidate.metadata.modelVersion,
      modelFileSha256: candidate.metadata.modelFileSha256,
      indexVersion: candidate.metadata.indexVersion,
      indexVectorSha256: candidate.metadata.indexVectorSha256,
    },
    catalogCardsSha256: baseline.metadata.catalogCardsSha256,
    trainingManifestSha256: baseline.metadata.trainingManifestSha256,
    expectedIdsSha256: baseline.metadata.expectedIdsSha256,
    seed: baseline.metadata.seed,
  },
  retrievalAccuracy: {
    baseline: baseline.metadata.fullCatalogRetrieval,
    candidate: candidate.metadata.fullCatalogRetrieval,
  },
  preservation: {
    queryEmbeddingCosine: {
      mean: queryCosines.reduce((sum, value) => sum + value, 0) / count,
      minimum: queryCosines[0],
      p01: percentile(queryCosines, 0.01),
      p05: percentile(queryCosines, 0.05),
      median: percentile(queryCosines, 0.5),
    },
    top1Same,
    top1Agreement: top1Same / count,
    top3OrderedSame,
    top3OrderedAgreement: top3OrderedSame / count,
    top3SetSame,
    top3SetAgreement: top3SetSame / count,
    meanTop3Intersection: top3IntersectionTotal / count,
    meanTop3IntersectionRate: top3IntersectionTotal / (count * 3),
    top1BothCorrect,
    top1BaselineOnlyCorrect,
    top1CandidateOnlyCorrect,
    top3BothCorrect,
    top3BaselineOnlyCorrect,
    top3CandidateOnlyCorrect,
  },
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote validation retrieval comparison to ${outputPath}`);
console.log(JSON.stringify({ retrievalAccuracy: report.retrievalAccuracy, preservation: report.preservation }, null, 2));
