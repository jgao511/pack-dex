import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCANNER_AI_RUNTIME_CONFIG } from "../../src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js";
import { fingerprintRuntimeConfig, readAndVerifyCatalogManifest, sha256Bytes, stableStringify } from "./runtime-freeze-lib.mjs";
import { DEFAULT_VALIDATION_IDENTITY_COUNT, FUSION_SCENARIO_VERSION } from "./fusion-calibration-lib.mjs";
import { fingerprintScannerAiRuntimeSources } from "./runtime-source-fingerprint.mjs";
import { verifyScannerAiApkRuntime } from "./apk-runtime-verifier.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
const metadataPath = path.resolve(root, argument("--index-metadata", "mobile-app/android/app/src/scannerAi/assets/public/scanner-ai/catalog-embeddings.meta.json"));
const modelPath = path.resolve(root, argument("--model", "mobile-app/android/app/src/scannerAi/assets/scanner-ai/mobilenet_v3_small.tflite"));
const catalogManifestPath = path.resolve(root, argument("--catalog-manifest", "artifacts/scanner-ai/catalog-manifest.json"));
const calibrationReportPath = path.resolve(root, argument("--calibration-report", "artifacts/scanner-ai/reports/fusion-calibration.json"));
const outputPath = path.resolve(root, argument("--output", "artifacts/scanner-ai/reports/runtime-freeze.json"));
const buildMarkerPath = path.resolve(root, "mobile-app/android/app/src/main/assets/public/scanner-ai-build.json");
const apkArgument = argument("--apk", null);
if (!apkArgument) throw new Error("Runtime freeze requires --apk pointing to the exact already-built scanner-AI APK.");
const apkPath = path.resolve(root, apkArgument);

const metadataBytes = await readFile(metadataPath);
const metadata = JSON.parse(metadataBytes.toString("utf8"));
if (metadata.schemaVersion !== 2) throw new Error("Embedding metadata must use schema version 2.");
const cardIds = Array.isArray(metadata.cardIds) ? metadata.cardIds.map(String) : [];
const count = Number(metadata.count);
const dimensions = Number(metadata.dimensions);
if (!Number.isInteger(count) || count <= 0 || cardIds.length !== count || new Set(cardIds).size !== count || cardIds.some((cardId) => !cardId)) {
  throw new Error("Embedding metadata must contain one unique ordered card ID per vector row.");
}
if (!Number.isInteger(dimensions) || dimensions <= 0 || metadata.normalized !== true) {
  throw new Error("Embedding metadata must declare positive dimensions and normalized vectors.");
}
const vectorPath = path.resolve(path.dirname(metadataPath), metadata.vectorFile || "catalog-embeddings.f16");
const catalogMetadataPath = path.resolve(path.dirname(metadataPath), metadata.metadataFile || "catalog-metadata.json");
const [vectorBytes, modelBytes, catalogMetadataBytes, apkBytes, buildMarkerBytes] = await Promise.all([
  readFile(vectorPath), readFile(modelPath), readFile(catalogMetadataPath), readFile(apkPath), readFile(buildMarkerPath),
]);
const bytesPerComponent = metadata.dtype === "float16-le" ? 2 : metadata.dtype === "float32-le" ? 4 : 0;
if (!bytesPerComponent || vectorBytes.byteLength !== count * dimensions * bytesPerComponent
  || (metadata.vectorBytes != null && Number(metadata.vectorBytes) !== vectorBytes.byteLength)) {
  throw new Error("Embedding vector bytes do not match the declared count, dimensions, and dtype.");
}
const vectorSha256 = sha256Bytes(vectorBytes);
const modelFileSha256 = sha256Bytes(modelBytes);
if (!metadata.vectorSha256 || metadata.vectorSha256 !== vectorSha256) throw new Error("Embedding vector checksum does not match its metadata.");
const cardIdsSha256 = sha256Bytes(`${cardIds.join("\n")}\n`);
if (!metadata.cardIdsSha256 || metadata.cardIdsSha256 !== cardIdsSha256) throw new Error("Ordered embedding card-ID checksum does not match its metadata.");
const catalogMetadataSha256 = sha256Bytes(catalogMetadataBytes);
if (!metadata.metadataSha256 || metadata.metadataSha256 !== catalogMetadataSha256) throw new Error("Catalog metadata checksum does not match embedding metadata.");
const catalogMetadata = JSON.parse(catalogMetadataBytes.toString("utf8"));
const catalogMetadataCardIds = Array.isArray(catalogMetadata.cards) ? catalogMetadata.cards.map(({ cardId }) => String(cardId || "")) : [];
if (catalogMetadata.schemaVersion !== 2 || Number(catalogMetadata.count) !== count
  || JSON.stringify(catalogMetadataCardIds) !== JSON.stringify(cardIds)) {
  throw new Error("Separate catalog metadata does not match the ordered embedding rows.");
}
const { manifest: catalogManifest, cardsSha256: catalogCardsSha256 } = await readAndVerifyCatalogManifest(catalogManifestPath);
const trustedCardIds = catalogManifest.cards.map(({ cardId }) => String(cardId || ""));
const indexedCardIds = new Set(cardIds);
if (trustedCardIds.length !== count || new Set(trustedCardIds).size !== count
  || trustedCardIds.some((cardId) => !cardId || !indexedCardIds.has(cardId))) {
  throw new Error("Embedding rows do not exactly cover the current trusted catalog card IDs.");
}
const declaredCatalogCardsSha256 = metadata.source?.catalogCardsSha256 || metadata.catalog?.manifestSha256;
if (!declaredCatalogCardsSha256 || declaredCatalogCardsSha256 !== catalogCardsSha256) {
  throw new Error("Embedding metadata does not match the current trusted catalog manifest.");
}
const expectedModelSha256 = metadata.model?.fileSha256 || metadata.model?.sha256;
if (!expectedModelSha256 || expectedModelSha256 !== modelFileSha256) throw new Error("Model checksum does not match embedding metadata.");
if (Number(metadata.model?.output?.dimensions) !== dimensions) throw new Error("Model output dimensions do not match the embedding index.");
const calibrationReportBytes = await readFile(calibrationReportPath);
const calibrationReport = JSON.parse(calibrationReportBytes.toString("utf8"));
const configSha256 = fingerprintRuntimeConfig(SCANNER_AI_RUNTIME_CONFIG);
const rankingSha256 = sha256Bytes(stableStringify(SCANNER_AI_RUNTIME_CONFIG.ranking));
const calibrationBindings = Array.isArray(calibrationReport.dataBindings) ? calibrationReport.dataBindings : [];
if (calibrationReport.schemaVersion !== 1 || calibrationReport.mode !== "evaluate-current" || calibrationReport.status !== "pass"
  || calibrationReport.validationOnly !== true || calibrationReport.lockedPixelInputsUsed !== false
  || calibrationReport.validatedConfigVersion !== SCANNER_AI_RUNTIME_CONFIG.configVersion
  || calibrationReport.validatedConfigSha256 !== configSha256
  || calibrationReport.validatedRankingSha256 !== rankingSha256) {
  throw new Error("A passing validation-only audit of the exact runtime fusion policy is required before freeze.");
}
const calibrationBinding = calibrationBindings.find((binding) => binding.modelFileSha256 === modelFileSha256
  && binding.indexMetadataSha256 === sha256Bytes(metadataBytes));
if (calibrationReport.calibrationProtocol !== "trained-float32-runtime-only-v1"
  || calibrationReport.runtimeModelRole !== "trained-float32"
  || calibrationReport.corpusCount !== 1 || calibrationBindings.length !== 1
  || calibrationBindings.some((binding) => binding.scenarioVersion !== FUSION_SCENARIO_VERSION
    || binding.identityCount !== DEFAULT_VALIDATION_IDENTITY_COUNT
    || binding.caseCount !== DEFAULT_VALIDATION_IDENTITY_COUNT * 10
    || binding.catalogCardsSha256 !== catalogCardsSha256
    || !binding.queryMetadataSha256 || !binding.queryVectorSha256)
  || !calibrationBinding
  || calibrationBinding.modelVersion !== (metadata.model?.version || metadata.modelVersion)
  || calibrationBinding.indexVersion !== metadata.indexVersion
  || calibrationBinding.indexVectorSha256 !== vectorSha256) {
  throw new Error("Fusion calibration audit does not match the exact model, index, catalog, and complete validation corpus.");
}
const auditCorpusSummaries = Object.values(calibrationReport.auditByCorpus || {}).map(({ summary }) => summary);
if (calibrationReport.audit?.summary?.wrong !== 0
  || auditCorpusSummaries.length !== 1
  || auditCorpusSummaries.some((summary) => summary?.wrong !== 0 || summary?.confirmed < 300
    || summary?.zeroWrongUpper95 == null || summary.zeroWrongUpper95 > 0.01)
  || calibrationReport.requirements?.minimumConfirmationsPerCorpus < 300
  || calibrationReport.requirements?.maximumOneSided95WrongRatePerCorpus > 0.01
  || !calibrationReport.preAuditPolicyFreeze?.sha256
  || calibrationReport.preAuditPolicyFreeze?.recommendedRankingSha256 !== rankingSha256) {
  throw new Error("Fusion calibration audit did not meet the conservative zero-wrong statistical gate.");
}
const calibrationRelativePath = path.relative(root, calibrationReportPath).replaceAll(path.sep, "/");
if (calibrationRelativePath.startsWith("../") || path.isAbsolute(calibrationRelativePath)) throw new Error("Fusion calibration report must remain inside the repository artifact tree.");

const runtimeSources = fingerprintScannerAiRuntimeSources(root);
verifyScannerAiApkRuntime(apkBytes, [
  {
    name: "assets/public/scanner-ai-build.json",
    bytes: buildMarkerBytes.byteLength,
    sha256: sha256Bytes(buildMarkerBytes),
  },
  { name: `assets/public/scanner-ai/${path.basename(metadataPath)}`, bytes: metadataBytes.byteLength, sha256: sha256Bytes(metadataBytes) },
  { name: `assets/public/scanner-ai/${path.basename(vectorPath)}`, bytes: vectorBytes.byteLength, sha256: vectorSha256 },
  { name: `assets/public/scanner-ai/${path.basename(catalogMetadataPath)}`, bytes: catalogMetadataBytes.byteLength, sha256: catalogMetadataSha256 },
  { name: `assets/scanner-ai/${path.basename(modelPath)}`, bytes: modelBytes.byteLength, sha256: modelFileSha256 },
], runtimeSources.sha256);

let gitHead = null;
try { gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}
const freeze = {
  schemaVersion: 1,
  frozenAt: new Date().toISOString(),
  purpose: "Locked 16-photo Pixel holdout benchmark; changing the model, index, fusion weights, or safety thresholds requires a new freeze.",
  configVersion: SCANNER_AI_RUNTIME_CONFIG.configVersion,
  configSha256,
  config: SCANNER_AI_RUNTIME_CONFIG,
  runtimeSourceSha256: runtimeSources.sha256,
  runtimeSourceFiles: runtimeSources.files,
  indexVersion: metadata.indexVersion,
  indexMetadataSha256: sha256Bytes(metadataBytes),
  catalogMetadataSha256,
  catalogCardsSha256,
  cardIdsSha256,
  vectorFile: path.basename(vectorPath),
  vectorSha256,
  modelVersion: metadata.model?.version || metadata.modelVersion,
  modelFile: path.basename(modelPath),
  modelFileSha256,
  calibrationReportPath: calibrationRelativePath,
  calibrationReportSha256: sha256Bytes(calibrationReportBytes),
  calibrationAudit: calibrationReport.audit.summary,
  calibrationQueryMetadataSha256: calibrationBinding.queryMetadataSha256,
  calibrationQueryVectorSha256: calibrationBinding.queryVectorSha256,
  apkFile: path.basename(apkPath),
  apkBytes: apkBytes.byteLength,
  apkSha256: sha256Bytes(apkBytes),
  catalogManifestSha256: catalogCardsSha256,
  gitHead,
};
for (const field of ["indexVersion", "modelVersion"]) if (!freeze[field]) throw new Error(`Embedding metadata is missing ${field}.`);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(freeze, null, 2)}\n`);
console.log(`Frozen ${freeze.configVersion} + ${freeze.modelVersion} + ${freeze.indexVersion}`);
console.log(`Wrote ${outputPath}`);
