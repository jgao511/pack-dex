import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCANNER_AI_RUNTIME_SOURCE_SEEDS = Object.freeze([
  "mobile-app/android/app/src/main/AndroidManifest.xml",
  "mobile-app/android/app/src/scannerAi/AndroidManifest.xml",
  "mobile-app/android/app/src/main/java/com/packdex/app/MainActivity.java",
  "mobile-app/android/app/build.gradle",
  "mobile-app/android/app/capacitor.build.gradle",
  "mobile-app/android/app/src/scannerAi/java/com/packdex/app/PackDexAiEmbedderPlugin.java",
  "mobile-app/android/build.gradle",
  "mobile-app/android/capacitor.settings.gradle",
  "mobile-app/android/gradle.properties",
  "mobile-app/android/gradle/wrapper/gradle-wrapper.jar",
  "mobile-app/android/gradle/wrapper/gradle-wrapper.properties",
  "mobile-app/android/settings.gradle",
  "mobile-app/android/variables.gradle",
  "mobile-app/capacitor.config.json",
  "mobile-app/node_modules/@pantrist/capacitor-plugin-ml-kit-text-recognition/android/build.gradle",
  "mobile-app/node_modules/@pantrist/capacitor-plugin-ml-kit-text-recognition/android/src/main/AndroidManifest.xml",
  "mobile-app/node_modules/@pantrist/capacitor-plugin-ml-kit-text-recognition/android/src/main/java/com/pantrist/ml/CapacitorPluginMlKitTextRecognition.kt",
  "mobile-app/package-lock.json",
  "mobile-app/package.json",
  "mobile-app/src/CardScannerDevPage.jsx",
  "mobile-app/src/lib/aiScannerPoc.js",
  "mobile-app/src/main.jsx",
  "mobile-app/vite.config.js",
  "src/lib/cardScanner/aiVisual/catalogCandidateIndex.js",
  "src/lib/cardScanner/aiVisual/embeddingSearch.js",
  "src/lib/cardScanner/aiVisual/hybridRanking.js",
  "src/lib/cardScanner/aiVisual/scannerAiRuntimeConfig.js",
]);

const STATIC_IMPORT = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']/g;
const IMPORT_META_URL = /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;

function resolveLocalImport(importer, specifier, root) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  if (!cleanSpecifier.startsWith(".")) return null;
  const unresolved = path.resolve(path.dirname(path.resolve(root, importer)), cleanSpecifier);
  if (existsSync(unresolved) && statSync(unresolved).isDirectory()) return null;
  const candidates = [unresolved, `${unresolved}.js`, `${unresolved}.mjs`, `${unresolved}.json`, path.join(unresolved, "index.js")];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!resolved) throw new Error(`Could not fingerprint scanner-AI dependency ${specifier} imported by ${importer}.`);
  const relative = path.relative(root, resolved).replaceAll(path.sep, "/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`Scanner-AI dependency escapes the repository: ${specifier}`);
  return relative;
}

function importedSpecifiers(source) {
  const values = new Set();
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT, IMPORT_META_URL]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) values.add(match[1]);
  }
  return values;
}

function collectRuntimeSourceFiles(root = defaultRoot) {
  const pending = [...SCANNER_AI_RUNTIME_SOURCE_SEEDS];
  const files = new Set();
  while (pending.length) {
    const relativePath = pending.pop();
    if (files.has(relativePath)) continue;
    const absolutePath = path.resolve(root, relativePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) throw new Error(`Missing scanner-AI runtime source: ${relativePath}`);
    files.add(relativePath);
    if (!/\.(?:[cm]?js|jsx)$/i.test(relativePath)) continue;
    const source = readFileSync(absolutePath, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      const dependency = resolveLocalImport(relativePath, specifier, root);
      if (dependency && !files.has(dependency)) pending.push(dependency);
    }
  }
  return [...files].sort();
}

// This is intentionally the complete relative-import closure, not a hand-picked
// list. OCR parsing, rectification, catalog data, or asset-resolution changes
// therefore invalidate the pre-holdout freeze and require a fresh APK/freeze.
export const SCANNER_AI_RUNTIME_SOURCE_FILES = Object.freeze(collectRuntimeSourceFiles());

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function fingerprintScannerAiRuntimeSources(root = defaultRoot) {
  const sourceFiles = root === defaultRoot ? SCANNER_AI_RUNTIME_SOURCE_FILES : collectRuntimeSourceFiles(root);
  const files = sourceFiles.map((relativePath) => ({
    path: relativePath,
    sha256: sha256(readFileSync(path.resolve(root, relativePath))),
  }));
  return { files, sha256: sha256(JSON.stringify(files)) };
}
