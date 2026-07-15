import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("scanner-AI scan orchestration cannot initiate an artifact or candidate-image fetch", async () => {
  const source = await readFile(new URL("../mobile-app/src/lib/aiScannerPoc.js", import.meta.url), "utf8");
  const scanBody = source.slice(source.indexOf("export async function runAiScannerPoc"), source.indexOf("async function prepareCatalogCardForAi"));
  for (const forbidden of ["loadEmbeddingIndex(", "scannerAiFetch(", "CapacitorHttp", "fetch(", "preloadAiScannerPoc("]) {
    assert.equal(scanBody.includes(forbidden), false, `Scan path unexpectedly contains ${forbidden}`);
  }
  assert.match(scanBody, /requirePreloadedRuntime/);
  assert.match(source, /offline-reference-descriptor-cache-unavailable/);
});

test("scanner-AI screen preload skips the production OCR adapter network prewarm", async () => {
  const page = await readFile(new URL("../mobile-app/src/CardScannerDevPage.jsx", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../mobile-app/src/lib/aiScannerPoc.js", import.meta.url), "utf8");
  assert.match(page, /if \(aiPocEnabled\) return undefined;[\s\S]{0,160}activeOcrAdapter\?\.prewarm/);
  assert.match(page, /__PACKDEX_SCANNER_AI_PRELOAD__/);
  assert.match(runtime, /initializeBundledOcr/);
  assert.match(runtime, /scanner-open-warmup/);
  assert.match(runtime, /\^\(\?:blob\|data\):/);
  const preparation = runtime.slice(runtime.indexOf("async function prepareScanForAi"), runtime.indexOf("async function recognizeEarlyOcr"));
  assert.match(preparation, /fetchImpl:\s*\(url\) => scannerAiFetch\(url, image\.scannerInputBlob\)/);
  assert.match(runtime, /scannerInputBlob instanceof Blob/);
  assert.match(page, /temporaryImage\.scannerInputBlob = file/);
  assert.match(page, /bundledOcrReady/);
});

test("scanner-AI quality diagnostics and OCR budget preserve safe progressive results", async () => {
  const runtime = await readFile(new URL("../mobile-app/src/lib/aiScannerPoc.js", import.meta.url), "utf8");
  assert.match(runtime, /cropAreaFraction/);
  assert.match(runtime, /sharpnessEstimate/);
  assert.match(runtime, /meanLuminance/);
  assert.match(runtime, /glareFraction/);
  assert.match(runtime, /topGlareFraction/);
  assert.match(runtime, /glareWarning/);
  assert.match(runtime, /OCR_BUDGET_MS = 3_000/);
  assert.match(runtime, /ocr-budget-exhausted/);
  assert.match(runtime, /progressiveResult: Boolean\(ocr\.timedOut\)/);
});

test("scanner-AI native runtime uses the isolated raw LiteRT interpreter and public WebView index assets", async () => {
  const plugin = await readFile(
    new URL("../mobile-app/android/app/src/scannerAi/java/com/packdex/app/PackDexAiEmbedderPlugin.java", import.meta.url),
    "utf8",
  );
  const gradle = await readFile(new URL("../mobile-app/android/app/build.gradle", import.meta.url), "utf8");

  assert.match(plugin, /import org\.tensorflow\.lite\.Interpreter;/);
  assert.doesNotMatch(plugin, /com\.google\.mediapipe/);
  assert.match(plugin, /public\/scanner-ai\/catalog-embeddings\.meta\.json/);
  assert.match(plugin, /localUrl \+ "\/scanner-ai\/catalog-embeddings\.meta\.json"/);
  assert.match(plugin, /activeModelSha256 = sha256\(modelBytes\)/);

  const aiDependencyBlock = gradle.match(
    /if \(scannerAiPocEnabled\) \{[\s\S]*?implementation 'com\.google\.ai\.edge\.litert:litert:2\.1\.6'[\s\S]*?\n\s*}/,
  );
  assert.ok(aiDependencyBlock, "LiteRT must remain gated behind the scanner-AI Gradle property");
  assert.doesNotMatch(gradle, /tasks-vision|mediapipe/i);
});

test("locked baseline harness scores only the scanner primary result", async () => {
  const benchmark = await readFile(new URL("../scripts/scanner-ai/benchmark-holdout.mjs", import.meta.url), "utf8");
  assert.match(benchmark, /reading\.result\?\.primaryCardId \|\| null/);
  assert.doesNotMatch(benchmark, /reading\.result\?\.results\?\.\[0\]|reading\.result\.results\[0\]/);
  assert.ok(benchmark.indexOf("installedApkSha256") < benchmark.indexOf("Locked fixture checksum changed"));
  assert.match(benchmark, /installedApkSha256 !== runtimeFreeze\.apkSha256/);
  assert.match(benchmark, /try \{ appPid = runAdb\("shell", "pidof", "com\.packdex\.app"\)/);
  assert.match(benchmark, /preparationMs: reading\.timing\?\.preparationMs/);
  assert.match(benchmark, /candidateBuildMs: reading\.timing\?\.candidateBuildMs/);
  assert.match(benchmark, /fusionMs: reading\.timing\?\.fusionMs/);
});

test("one Android build command couples the scanner-AI web mode and native Gradle property", async () => {
  const wrapper = await readFile(new URL("../scripts/scanner-ai/build-android.mjs", import.meta.url), "utf8");
  const gradle = await readFile(new URL("../mobile-app/android/app/build.gradle", import.meta.url), "utf8");
  const vite = await readFile(new URL("../mobile-app/vite.config.js", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(packageJson.scripts["build:scanner-ai:android"], "node scripts/scanner-ai/build-android.mjs");
  assert.match(wrapper, /cap:sync:android:scanner:ai/);
  assert.match(wrapper, /-PpackdexScannerAiPoc=true/);
  assert.match(wrapper, /debugRuntimeClasspath/);
  assert.match(wrapper, /play-services-mlkit-text-recognition/);
  assert.ok(wrapper.includes("com\\.google\\.mlkit:text-recognition:16\\.0\\.1"));
  assert.match(vite, /scanner-ai-build\.json/);
  assert.match(gradle, /scannerAiPocEnabled != scannerAiWebMarker\.exists\(\)/);
  assert.match(gradle, /implementation 'com\.google\.mlkit:text-recognition:16\.0\.1'/);
  assert.doesNotMatch(gradle, /exclude group: 'com\.google\.android\.gms', module: 'play-services-mlkit-text-recognition'/);
  assert.match(wrapper, /assets\/mlkit-google-ocr-models\//);
  const activity = await readFile(new URL("../mobile-app/android/app/src/main/java/com/packdex/app/MainActivity.java", import.meta.url), "utf8");
  assert.match(activity, /BuildConfig\.PACKDEX_SCANNER_AI_POC && BuildConfig\.DEBUG/);
  assert.match(activity, /WebView\.setWebContentsDebuggingEnabled\(true\)/);
  assert.match(gradle, /ndk \{ abiFilters 'arm64-v8a' }/);
});
