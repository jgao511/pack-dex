import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const androidRoot = path.join(root, "mobile-app", "android");
const scannerAiAssets = path.join(androidRoot, "app", "src", "scannerAi", "assets");
const publicIndexRoot = path.join(scannerAiAssets, "public", "scanner-ai");
const modelPath = path.join(scannerAiAssets, "scanner-ai", "mobilenet_v3_small.tflite");
const requireIndex = process.argv.includes("--require-index");
const env = { ...process.env };
const requiredIndexEntries = [];

if (process.platform === "win32" && !env.JAVA_HOME) {
  const androidStudioJbr = path.join(env.ProgramFiles || "C:\\Program Files", "Android", "Android Studio", "jbr");
  if (existsSync(androidStudioJbr)) env.JAVA_HOME = androidStudioJbr;
}

if (!existsSync(modelPath)) throw new Error(`Scanner-AI model is missing: ${modelPath}`);
if (requireIndex) {
  const metadataPath = path.join(publicIndexRoot, "catalog-embeddings.meta.json");
  if (!existsSync(metadataPath)) throw new Error(`Scanner-AI index metadata is missing: ${metadataPath}`);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  for (const artifact of [metadata.vectorFile, metadata.metadataFile]) {
    if (artifact !== path.basename(artifact || "") || String(artifact).includes("..")) throw new Error(`Scanner-AI index artifact has an invalid filename: ${artifact || "<unnamed>"}`);
    if (!artifact || !existsSync(path.join(publicIndexRoot, artifact))) throw new Error(`Scanner-AI index artifact is missing: ${artifact || "<unnamed>"}`);
  }
  requiredIndexEntries.push(
    "assets/public/scanner-ai/catalog-embeddings.meta.json",
    `assets/public/scanner-ai/${metadata.vectorFile}`,
    `assets/public/scanner-ai/${metadata.metadataFile}`,
  );
}

const npmCli = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
].find((candidate) => candidate && existsSync(candidate));
if (!npmCli) throw new Error("Could not locate npm-cli.js beside the active Node.js runtime.");
const subprocessOptions = { env, stdio: "inherit" };
execFileSync(process.execPath, [npmCli, "--prefix", "mobile-app", "run", "cap:sync:android:scanner:ai"], { ...subprocessOptions, cwd: root });

const markerPath = path.join(androidRoot, "app", "src", "main", "assets", "public", "scanner-ai-build.json");
const marker = JSON.parse(readFileSync(markerPath, "utf8"));
if (marker.scannerAiPoc !== true || !/^[a-f0-9]{64}$/.test(marker.runtimeSourceSha256 || "")) {
  throw new Error("Synchronized scanner-AI web bundle marker is invalid.");
}

const java = env.JAVA_HOME
  ? path.join(env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
  : "java";
const gradleWrapperJar = path.join(androidRoot, "gradle", "wrapper", "gradle-wrapper.jar");
execFileSync(java, ["-classpath", gradleWrapperJar, "org.gradle.wrapper.GradleWrapperMain", "clean", "assembleDebug", "-PpackdexScannerAiPoc=true"], { ...subprocessOptions, cwd: androidRoot });

const dependencyGraph = execFileSync(java, [
  "-classpath", gradleWrapperJar, "org.gradle.wrapper.GradleWrapperMain",
  ":app:dependencies", "--configuration", "debugRuntimeClasspath", "-PpackdexScannerAiPoc=true",
], { env, cwd: androidRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
if (!/com\.google\.mlkit:text-recognition:16\.0\.1/.test(dependencyGraph)) {
  throw new Error("Scanner-AI APK did not resolve the bundled ML Kit Latin OCR model.");
}
if (!/com\.google\.android\.gms:play-services-mlkit-text-recognition:19\.0\.1/.test(dependencyGraph)) {
  throw new Error("Bundled ML Kit OCR did not resolve its required recognizer API classes.");
}

const mergedManifestCandidates = [
  path.join(androidRoot, "app", "build", "intermediates", "merged_manifest", "debug", "processDebugMainManifest", "AndroidManifest.xml"),
  path.join(androidRoot, "app", "build", "intermediates", "merged_manifests", "debug", "processDebugManifest", "AndroidManifest.xml"),
];
const mergedManifestPath = mergedManifestCandidates.find(existsSync);
if (!mergedManifestPath) throw new Error("Could not inspect the scanner-AI merged Android manifest.");
const mergedManifest = readFileSync(mergedManifestPath, "utf8");
if (mergedManifest.includes("com.google.mlkit.vision.DEPENDENCIES")) {
  throw new Error("Scanner-AI merged manifest still requests a downloadable Play Services OCR module.");
}

const apkPath = path.join(androidRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const apk = readFileSync(apkPath);
for (const entry of ["assets/public/scanner-ai-build.json", "assets/scanner-ai/mobilenet_v3_small.tflite", ...requiredIndexEntries]) {
  if (!apk.includes(Buffer.from(entry))) throw new Error(`Built APK is missing isolated scanner-AI entry: ${entry}`);
}
if (!apk.includes(Buffer.from("assets/mlkit-google-ocr-models/"))) {
  throw new Error("Scanner-AI APK is missing the statically bundled ML Kit OCR model assets.");
}
for (const forbidden of ["pixel-real", "here-comes-team-rocket-113-108", "diglett-55-108", "gardevoir-ex-111-114"]) {
  if (apk.includes(Buffer.from(forbidden))) throw new Error(`Built scanner-AI APK contains forbidden fixture marker: ${forbidden}`);
}

console.log(`Built isolated scanner-AI APK (${apk.length} bytes): ${apkPath}`);
console.log(`Runtime source SHA-256: ${marker.runtimeSourceSha256}`);
console.log("OCR runtime: bundled com.google.mlkit:text-recognition:16.0.1 (no Play Services model download)");
