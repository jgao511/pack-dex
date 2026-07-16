import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const mobileRoot = new URL("../", import.meta.url);
const repositoryRoot = new URL("../../", import.meta.url);
const modelHash = "62f2ff60cfdb09714a01fa74343e4dc1968601c2a43046979cbc548c28027c7c";
const indexHash = "a851d797aef5c140d8918bb2ffa7dcafa2315cb1f0cbdb6ca4abbd91c3d61edb";

async function text(relative, root = mobileRoot) {
  return readFile(new URL(relative, root), "utf8");
}

async function sha256(relative, root = repositoryRoot) {
  return createHash("sha256").update(await readFile(new URL(relative, root))).digest("hex");
}

export async function validateIosProject() {
  const [info, project, packageSwift, privacy, config, nativeIndex] = await Promise.all([
    text("ios/App/App/Info.plist"),
    text("ios/App/App.xcodeproj/project.pbxproj"),
    text("ios/App/CapApp-SPM/Package.swift"),
    text("ios/App/App/PrivacyInfo.xcprivacy"),
    text("capacitor.config.json"),
    text("ios/App/App/public/index.html"),
  ]);

  assert.match(info, /<key>CFBundleDisplayName<\/key>\s*<string>PackDex<\/string>/);
  assert.match(info, /PackDex uses the camera to scan and identify trading cards\./);
  assert.match(info, /PackDex uses selected photos to identify trading cards\./);
  assert.doesNotMatch(info, /NSMicrophoneUsageDescription|NSUserTrackingUsageDescription|NSAllowsArbitraryLoads/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.packdex\.app;/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/);
  assert.equal((project.match(/TARGETED_DEVICE_FAMILY = 1;/g) || []).length, 2);
  assert.equal((project.match(/PRODUCT_NAME = PackDex;/g) || []).length, 2);
  assert.match(project, /MARKETING_VERSION = 1\.0;/);
  assert.match(project, /CURRENT_PROJECT_VERSION = 1;/);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.doesNotMatch(project, /DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER/);
  assert.doesNotMatch(packageSwift, /path: "[^"\n]*\\/);
  assert.match(packageSwift, /capacitor-swift-pm\.git", exact: "8\.4\.1"/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeEmailAddress/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeUserID/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeGameplayContent/);
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.doesNotMatch(config, /localhost|127\.0\.0\.1|server\s*:/i);
  assert.doesNotMatch(nativeIndex, /https?:\/\/localhost|https?:\/\/127\.0\.0\.1/i);

  assert.equal(await sha256("public/scanner-ai/frozen-a-62f2ff60.tflite"), modelHash);
  assert.equal(await sha256("public/scanner-ai/catalog-embeddings-a851d797.f16"), indexHash);
  assert.equal(await sha256("mobile-app/ios/App/App/public/scanner-ai/frozen-a-62f2ff60.tflite"), modelHash);
  assert.equal(await sha256("mobile-app/ios/App/App/public/scanner-ai/catalog-embeddings-a851d797.f16"), indexHash);

  const scannerFiles = (await readdir(new URL("ios/App/App/public/scanner-ai/", mobileRoot), { recursive: true }))
    .map((name) => name.replaceAll("\\", "/"));
  for (const required of [
    "catalog-embeddings.meta.json",
    "catalog-metadata.json",
    "tf-core.min.js",
    "tf-backend-cpu.min.js",
    "tf-tflite.min.js",
    "wasm/tflite_web_api_cc.wasm",
    "wasm/tflite_web_api_cc_threaded.worker.js",
    "wasm/tflite_web_api_cc_simd_threaded.worker.js",
  ]) assert.ok(scannerFiles.includes(required), `Missing bundled scanner asset: ${required}`);
  assert.equal(scannerFiles.filter((name) => /frozen-a-.*\.tflite$/i.test(name)).length, 1);
  assert.equal(scannerFiles.some((name) => /(?:model|frozen)[-_]?c|training|fixture|holdout/i.test(name)), false);

  for (const relative of [
    "ios/App/App/AppDelegate.swift",
    "ios/App/App/Base.lproj/Main.storyboard",
    "ios/App/App/Base.lproj/LaunchScreen.storyboard",
    "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  ]) await access(new URL(relative, mobileRoot));

  console.info("Capacitor iOS static validation passed (iOS 15, PackDex 1.0 build 1)." );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await validateIosProject();
