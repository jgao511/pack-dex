import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintScannerAiRuntimeSources } from "./runtime-source-fingerprint.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprintRuntimeConfig(config) {
  return sha256Bytes(stableStringify(config));
}

export async function readAndVerifyCatalogManifest(manifestPath) {
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) { throw new Error(`Trusted catalog manifest is required at ${manifestPath}: ${error.message}`); }
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.cards) || manifest.count <= 0 || manifest.count !== manifest.cards.length || !manifest.cardsSha256) {
    throw new Error("Trusted catalog manifest is incomplete.");
  }
  const cardsSha256 = sha256Bytes(stableStringify(manifest.cards));
  if (cardsSha256 !== manifest.cardsSha256) throw new Error("Trusted catalog manifest card checksum is invalid.");
  return { manifest, cardsSha256 };
}

export async function readAndVerifyRuntimeFreeze(freezePath, config, options = {}) {
  let freeze;
  try { freeze = JSON.parse(await readFile(freezePath, "utf8")); }
  catch (error) { throw new Error(`Locked benchmark requires runtime freeze metadata at ${freezePath}: ${error.message}`); }
  const expectedConfigSha256 = fingerprintRuntimeConfig(config);
  if (freeze.schemaVersion !== 1 || !freeze.frozenAt) throw new Error("Runtime freeze metadata is incomplete.");
  if (freeze.configVersion !== config.configVersion || freeze.configSha256 !== expectedConfigSha256) {
    throw new Error("Runtime weights or thresholds changed after the benchmark freeze was created.");
  }
  const root = options.root || defaultRoot;
  const currentSources = fingerprintScannerAiRuntimeSources(root);
  if (freeze.runtimeSourceSha256 !== currentSources.sha256) throw new Error("Scanner-AI runtime source changed after the benchmark freeze was created.");
  for (const field of ["indexVersion", "indexMetadataSha256", "catalogMetadataSha256", "catalogCardsSha256", "cardIdsSha256", "vectorSha256", "modelVersion", "modelFileSha256", "runtimeSourceSha256", "calibrationReportPath", "calibrationReportSha256", "apkFile", "apkBytes", "apkSha256"]) {
    if (!freeze[field]) throw new Error(`Runtime freeze metadata is missing ${field}.`);
  }
  const catalogManifestPath = options.catalogManifestPath || path.resolve(root, "artifacts/scanner-ai/catalog-manifest.json");
  const { cardsSha256 } = await readAndVerifyCatalogManifest(catalogManifestPath);
  if (freeze.catalogCardsSha256 !== cardsSha256) throw new Error("Trusted catalog changed after the benchmark freeze was created.");
  const calibrationReportPath = options.calibrationReportPath || path.resolve(root, freeze.calibrationReportPath);
  const relativeCalibrationPath = path.relative(root, calibrationReportPath).replaceAll(path.sep, "/");
  if (!options.calibrationReportPath && (relativeCalibrationPath.startsWith("../") || path.isAbsolute(relativeCalibrationPath))) throw new Error("Fusion calibration report escaped the repository artifact tree.");
  let calibrationReportBytes;
  try { calibrationReportBytes = await readFile(calibrationReportPath); }
  catch (error) { throw new Error(`Locked benchmark requires the frozen fusion calibration report: ${error.message}`); }
  if (sha256Bytes(calibrationReportBytes) !== freeze.calibrationReportSha256) throw new Error("Fusion calibration report changed after the benchmark freeze was created.");
  const calibrationReport = JSON.parse(calibrationReportBytes.toString("utf8"));
  if (calibrationReport.status !== "pass" || calibrationReport.mode !== "evaluate-current"
    || calibrationReport.validatedConfigSha256 !== expectedConfigSha256) {
    throw new Error("Frozen fusion calibration report does not validate the current runtime policy.");
  }
  return freeze;
}
