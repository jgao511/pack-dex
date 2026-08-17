import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = new URL("../", import.meta.url);
const mobileRootPath = fileURLToPath(mobileRoot);

async function text(relative) {
  return readFile(new URL(relative, mobileRoot), "utf8");
}

function pngMetadata(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "Invalid PNG signature");
  assert.equal(buffer.toString("ascii", 12, 16), "IHDR", "PNG must begin with IHDR");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

async function inspectPublicBundle() {
  const publicRoot = path.resolve(mobileRootPath, "ios/App/App/public");
  const bannedPath = /scanner|camera|photo|ocr|ml-kit|text-recognition|buymeacoffee/i;
  const bannedText = /buymeacoffee|buy me a coffee|scanner-ai|cardscanner|camerapreview|capacitorcamera|mlkit|textrecognition|scanner-camera-active|scanner-beta|scanner-dev|mobile-icon-scanner|add packdex to your home screen|Ri6i8fEIdrU/i;
  const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs", ".txt"]);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(publicRoot, absolute).replaceAll("\\", "/");
      assert.doesNotMatch(relative, bannedPath, `Private feature path is present in iOS: ${relative}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
        assert.doesNotMatch(await readFile(absolute, "utf8"), bannedText, `Private feature leaked into iOS file: ${relative}`);
      }
    }
  }

  await visit(publicRoot);
}

export async function validateIosProject() {
  const [info, project, packageSwift, privacy, config, generatedConfig, nativeIndex, appIconContents, appIcon, launchScreen] = await Promise.all([
    text("ios/App/App/Info.plist"),
    text("ios/App/App.xcodeproj/project.pbxproj"),
    text("ios/App/CapApp-SPM/Package.swift"),
    text("ios/App/App/PrivacyInfo.xcprivacy"),
    text("capacitor.config.json"),
    text("ios/App/App/capacitor.config.json"),
    text("ios/App/App/public/index.html"),
    text("ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json"),
    readFile(new URL("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", mobileRoot)),
    text("ios/App/App/Base.lproj/LaunchScreen.storyboard"),
  ]);

  assert.match(info, /<key>CFBundleDisplayName<\/key>\s*<string>PackDex<\/string>/);
  assert.doesNotMatch(info, /NSCameraUsageDescription|NSPhotoLibraryUsageDescription|NSMicrophoneUsageDescription|NSUserTrackingUsageDescription|NSAllowsArbitraryLoads/);
  assert.match(config, /"appId"\s*:\s*"com\.packdex\.mobile"/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.packdex\.mobile;/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/);
  assert.equal((project.match(/TARGETED_DEVICE_FAMILY = 1;/g) || []).length, 2);
  assert.equal((project.match(/PRODUCT_NAME = PackDex;/g) || []).length, 2);
  assert.equal((project.match(/MARKETING_VERSION = 1\.0;/g) || []).length, 2);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 2;/g) || []).length, 2);
  assert.equal((project.match(/DEVELOPMENT_TEAM = TM9KXB4QWR;/g) || []).length, 2);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.doesNotMatch(project, /PROVISIONING_PROFILE_SPECIFIER/);

  assert.doesNotMatch(packageSwift, /Camera|Photo|MLKit|TextRecognition|Scanner/i);
  assert.match(packageSwift, /capacitor-swift-pm\.git", exact: "8\.4\.1"/);
  assert.match(packageSwift, /CapacitorApp/);
  assert.match(packageSwift, /CapacitorBrowser/);
  assert.doesNotMatch(generatedConfig, /Camera|Photo|MLKit|TextRecognition|Scanner/i);

  const nativeAssetNames = await readdir(new URL("ios/App/App/public/assets/", mobileRoot));
  const supabaseAssets = nativeAssetNames.filter((name) => /^supabaseClient-.*\.js$/i.test(name));
  assert.equal(supabaseAssets.length, 1, "Expected one configured Supabase client bundle");
  const supabaseAsset = await text(`ios/App/App/public/assets/${supabaseAssets[0]}`);
  assert.match(supabaseAsset, /https:\/\/yoaesrgnrkkiibmfnuwg\.supabase\.co/);
  assert.match(supabaseAsset, /sb_publishable_gjskuCm_3YLQh_ox8qxE2g_5rnL3-Wq/);

  assert.match(privacy, /NSPrivacyCollectedDataTypeEmailAddress/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeUserID/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeGameplayContent/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeCoarseLocation/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeProductInteraction/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeOtherDiagnosticData/);
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.doesNotMatch(config, /localhost|127\.0\.0\.1|server\s*:/i);
  assert.doesNotMatch(nativeIndex, /https?:\/\/localhost|https?:\/\/127\.0\.0\.1/i);
  assert.match(project, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/);
  assert.match(appIconContents, /AppIcon-512@2x\.png/);
  assert.deepEqual(pngMetadata(appIcon), { width: 1024, height: 1024, colorType: 2 });
  assert.match(launchScreen, /text="PackDex"/);
  assert.doesNotMatch(launchScreen, /Capacitor|Splash|image name=/i);
  await assert.rejects(access(new URL("ios/App/App/Assets.xcassets/Splash.imageset", mobileRoot)));

  await inspectPublicBundle();

  for (const relative of [
    "ios/App/App/AppDelegate.swift",
    "ios/App/App/Base.lproj/Main.storyboard",
    "ios/App/App/Base.lproj/LaunchScreen.storyboard",
    "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  ]) await access(new URL(relative, mobileRoot));

  console.info("Capacitor iOS App Store validation passed (iOS 15, PackDex 1.0 build 2).");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await validateIosProject();
