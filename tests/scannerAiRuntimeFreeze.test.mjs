import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCANNER_AI_RUNTIME_CONFIG } from "../src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js";
import { fingerprintRuntimeConfig, readAndVerifyRuntimeFreeze, sha256Bytes, stableStringify } from "../scripts/scanner-ai/runtime-freeze-lib.mjs";
import { fingerprintScannerAiRuntimeSources, SCANNER_AI_RUNTIME_SOURCE_FILES } from "../scripts/scanner-ai/runtime-source-fingerprint.mjs";
import { verifyScannerAiApkRuntime } from "../scripts/scanner-ai/apk-runtime-verifier.mjs";

function storedZip(entries) {
  const locals = [];
  const central = [];
  let localOffset = 0;
  for (const [name, contentValue] of entries) {
    const nameBytes = Buffer.from(name);
    const content = Buffer.from(contentValue);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(content.length, 18);
    local.writeUInt16LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, content);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(content.length, 20);
    record.writeUInt16LE(content.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(localOffset, 42);
    central.push(record, nameBytes);
    localOffset += local.length + nameBytes.length + content.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

test("APK freeze verifies embedded runtime bytes and build source marker", () => {
  const runtimeSourceSha256 = "a".repeat(64);
  const marker = Buffer.from(JSON.stringify({ scannerAiPoc: true, runtimeSourceSha256 }));
  const model = Buffer.from("exact-model");
  const apk = storedZip([
    ["assets/public/scanner-ai-build.json", marker],
    ["assets/scanner-ai/mobilenet_v3_small.tflite", model],
  ]);
  const expected = [
    { name: "assets/public/scanner-ai-build.json", bytes: marker.length, sha256: createHash("sha256").update(marker).digest("hex") },
    { name: "assets/scanner-ai/mobilenet_v3_small.tflite", bytes: model.length, sha256: createHash("sha256").update(model).digest("hex") },
  ];
  assert.equal(verifyScannerAiApkRuntime(apk, expected, runtimeSourceSha256).runtimeSourceSha256, runtimeSourceSha256);
  assert.throws(
    () => verifyScannerAiApkRuntime(apk, [{ ...expected[1], sha256: "b".repeat(64) }, expected[0]], runtimeSourceSha256),
    /does not match the loose freeze input/,
  );
});

test("runtime freeze fingerprints the transitive OCR, rectification, asset, and catalog sources", () => {
  for (const expected of [
    "mobile-app/android/app/src/main/AndroidManifest.xml",
    "mobile-app/android/app/src/scannerAi/AndroidManifest.xml",
    "mobile-app/android/settings.gradle",
    "mobile-app/android/gradle/wrapper/gradle-wrapper.properties",
    "mobile-app/node_modules/@pantrist/capacitor-plugin-ml-kit-text-recognition/android/src/main/java/com/pantrist/ml/CapacitorPluginMlKitTextRecognition.kt",
    "src/lib/cardScanner/prepareCardImage.js",
    "src/lib/cardScanner/extractCollectorNumbers.js",
    "src/lib/cardScanner/extractNameCandidates.js",
    "src/lib/cardScanner/localVisual/scannerVisual.worker.js",
    "src/utils/assetUrls.js",
    "src/data/sets.js",
    "src/data/mega-evolution.json",
  ]) {
    assert.ok(SCANNER_AI_RUNTIME_SOURCE_FILES.includes(expected), `Missing runtime dependency ${expected}`);
  }
});

test("locked holdout requires matching versioned weights, thresholds, model, and index metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "packdex-ai-freeze-"));
  const freezePath = path.join(directory, "freeze.json");
  const catalogManifestPath = path.join(directory, "catalog-manifest.json");
  const calibrationReportPath = path.join(directory, "fusion-calibration.json");
  const cards = [{ cardId: "card-a", name: "Card A" }];
  const catalogCardsSha256 = sha256Bytes(stableStringify(cards));
  const configSha256 = fingerprintRuntimeConfig(SCANNER_AI_RUNTIME_CONFIG);
  try {
    await writeFile(catalogManifestPath, JSON.stringify({ schemaVersion: 2, count: cards.length, cardsSha256: catalogCardsSha256, cards }));
    const calibrationReportBytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      mode: "evaluate-current",
      status: "pass",
      validatedConfigSha256: configSha256,
    }));
    await writeFile(calibrationReportPath, calibrationReportBytes);
    const options = { catalogManifestPath, calibrationReportPath };
    await assert.rejects(() => readAndVerifyRuntimeFreeze(freezePath, SCANNER_AI_RUNTIME_CONFIG, options), /requires runtime freeze metadata/);
    await writeFile(freezePath, JSON.stringify({
      schemaVersion: 1,
      frozenAt: "2026-07-13T00:00:00.000Z",
      configVersion: SCANNER_AI_RUNTIME_CONFIG.configVersion,
      configSha256,
      indexVersion: "index-v1",
      indexMetadataSha256: "metadata",
      catalogMetadataSha256: "catalog-metadata",
      catalogCardsSha256,
      cardIdsSha256: "card-ids",
      vectorSha256: "vectors",
      modelVersion: "model-v1",
      modelFileSha256: "model",
      runtimeSourceSha256: fingerprintScannerAiRuntimeSources().sha256,
      apkFile: "scanner-ai.apk",
      apkBytes: 123,
      apkSha256: "apk",
      calibrationReportPath: "artifacts/scanner-ai/reports/fusion-calibration.json",
      calibrationReportSha256: sha256Bytes(calibrationReportBytes),
    }));
    const verified = await readAndVerifyRuntimeFreeze(freezePath, SCANNER_AI_RUNTIME_CONFIG, options);
    assert.equal(verified.indexVersion, "index-v1");
    await assert.rejects(() => readAndVerifyRuntimeFreeze(freezePath, { ...SCANNER_AI_RUNTIME_CONFIG, configVersion: "changed" }, options), /changed after/);
    const changedCards = [{ cardId: "card-a", name: "Changed Card A" }];
    await writeFile(catalogManifestPath, JSON.stringify({ schemaVersion: 2, count: changedCards.length, cardsSha256: sha256Bytes(stableStringify(changedCards)), cards: changedCards }));
    await assert.rejects(() => readAndVerifyRuntimeFreeze(freezePath, SCANNER_AI_RUNTIME_CONFIG, options), /Trusted catalog changed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
