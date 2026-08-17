import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getExternalHttpUrl, installNativeExternalLinkRouting } from "../mobile-app/src/lib/externalLinks.js";
import { isAndroidNative, isIosNative } from "../mobile-app/src/lib/platform.js";

const capacitor = (platform, native = true) => ({ isNativePlatform: () => native, getPlatform: () => platform });
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function read(relative) {
  return readFile(path.join(repositoryRoot, relative), "utf8");
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

test("native platform detection remains explicit for Android, iOS, and web", () => {
  assert.equal(isAndroidNative(capacitor("android")), true);
  assert.equal(isIosNative(capacitor("android")), false);
  assert.equal(isIosNative(capacitor("ios")), true);
  assert.equal(isAndroidNative(capacitor("ios")), false);
  assert.equal(isIosNative(capacitor("web", false)), false);
});

test("native routing opens allowed external web links without intercepting internal or mail links", async () => {
  const locationRef = { href: "capacitor://localhost/index.html", origin: "null" };
  const anchor = (href) => ({ getAttribute: () => href });
  assert.equal(getExternalHttpUrl(anchor("https://www.tcgplayer.com/card"), locationRef), "https://www.tcgplayer.com/card");
  assert.equal(getExternalHttpUrl(anchor("/settings"), locationRef), null);
  assert.equal(getExternalHttpUrl(anchor("mailto:packdexsupport@gmail.com"), locationRef), null);
  assert.equal(getExternalHttpUrl(anchor("http://[invalid"), locationRef), null);

  let listener;
  const opened = [];
  const documentRef = { addEventListener: (_name, callback) => { listener = callback; }, removeEventListener() {} };
  installNativeExternalLinkRouting({ capacitor: capacitor("ios"), documentRef, locationRef, openBrowser: async (url) => opened.push(url) });
  let prevented = false;
  listener({ target: { closest: () => anchor("https://youtube.com/watch?v=test") }, button: 0, preventDefault: () => { prevented = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.deepEqual(opened, ["https://youtube.com/watch?v=test"]);
});

test("public iOS dependencies and permissions exclude scanner, camera, photos, and OCR", async () => {
  const [packageJson, packageLock, info, packageSwift, generatedConfig, appSource] = await Promise.all([
    read("mobile-app/package.json"),
    read("mobile-app/package-lock.json"),
    read("mobile-app/ios/App/App/Info.plist"),
    read("mobile-app/ios/App/CapApp-SPM/Package.swift"),
    read("mobile-app/ios/App/App/capacitor.config.json"),
    read("mobile-app/src/App.jsx"),
  ]);
  const bannedDependency = /@capacitor-community\/camera-preview|@capacitor\/camera|ml-kit-text-recognition/i;
  assert.doesNotMatch(packageJson, bannedDependency);
  assert.doesNotMatch(packageLock, bannedDependency);
  assert.doesNotMatch(info, /NSCameraUsageDescription|NSPhotoLibraryUsageDescription|NSMicrophoneUsageDescription/);
  assert.doesNotMatch(packageSwift, /Camera|Photo|MLKit|TextRecognition|Scanner/i);
  assert.doesNotMatch(generatedConfig, /Camera|Photo|MLKit|TextRecognition|Scanner/i);
  assert.doesNotMatch(appSource, /MobileScannerPage|mobile-icon-scanner|screen-scanner|scannerTestEnabled/);
});

test("the synced iOS web bundle contains no private scanner or donation artifacts", async () => {
  const publicRoot = path.join(repositoryRoot, "mobile-app/ios/App/App/public");
  const files = await walk(publicRoot);
  const relativePaths = files.map((file) => path.relative(publicRoot, file).replaceAll("\\", "/"));
  assert.equal(relativePaths.some((relative) => /scanner|camera|photo|ocr|ml-kit|text-recognition|buymeacoffee/i.test(relative)), false);

  const bannedText = /buymeacoffee|buy me a coffee|scanner-ai|cardscanner|camerapreview|capacitorcamera|mlkit|textrecognition|scanner-camera-active|scanner-beta|scanner-dev|mobile-icon-scanner|add packdex to your home screen|Ri6i8fEIdrU/i;
  const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs", ".txt"]);
  for (const file of files) {
    if (textExtensions.has(path.extname(file).toLowerCase())) {
      assert.doesNotMatch(await readFile(file, "utf8"), bannedText, `Private feature leaked into ${path.relative(publicRoot, file)}`);
    }
  }
});

test("the synced iOS bundle contains the public production Supabase configuration", async () => {
  const assetRoot = path.join(repositoryRoot, "mobile-app/ios/App/App/public/assets");
  const names = await readdir(assetRoot);
  const supabaseAssets = names.filter((name) => /^supabaseClient-.*\.js$/i.test(name));
  const sources = await Promise.all(
    supabaseAssets.map((name) => readFile(path.join(assetRoot, name), "utf8"))
  );
  const configuredSources = sources.filter(
    (source) =>
      /https:\/\/yoaesrgnrkkiibmfnuwg\.supabase\.co/.test(source) &&
      /sb_publishable_gjskuCm_3YLQh_ox8qxE2g_5rnL3-Wq/.test(source)
  );
  assert.ok(configuredSources.length >= 1);
  const combinedSource = sources.join("\n");
  assert.deepEqual(
    [...new Set(combinedSource.match(/https:\/\/[a-z0-9]+\.supabase\.co/gi) || [])],
    ["https://yoaesrgnrkkiibmfnuwg.supabase.co"]
  );
  assert.deepEqual(
    [...new Set(combinedSource.match(/sb_publishable_[A-Za-z0-9_-]+/g) || [])],
    ["sb_publishable_gjskuCm_3YLQh_ox8qxE2g_5rnL3-Wq"]
  );
  assert.doesNotMatch(combinedSource, /sb_secret_|service_role/i);
});

test("iOS configuration has the App Store identity, signing team, and privacy manifest", async () => {
  const [info, project, privacy, css] = await Promise.all([
    read("mobile-app/ios/App/App/Info.plist"),
    read("mobile-app/ios/App/App.xcodeproj/project.pbxproj"),
    read("mobile-app/ios/App/App/PrivacyInfo.xcprivacy"),
    read("mobile-app/src/App.css"),
  ]);
  assert.doesNotMatch(info, /Camera|Photo|Microphone|Location|Bluetooth|Tracking|NSAllowsArbitraryLoads/);
  assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.packdex\.mobile;/g) || []).length, 2);
  assert.equal((project.match(/MARKETING_VERSION = 1\.0;/g) || []).length, 2);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 2;/g) || []).length, 2);
  assert.equal((project.match(/DEVELOPMENT_TEAM = TM9KXB4QWR;/g) || []).length, 2);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(privacy, /NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("private scanner development entry is compile-time disabled for the App Store mode", async () => {
  const [main, vite] = await Promise.all([
    read("mobile-app/src/main.jsx"),
    read("mobile-app/vite.config.js"),
  ]);
  assert.match(main, /__PACKDEX_SCANNER_TEST__/);
  assert.match(main, /import\("\.\/CardScannerDevPage\.jsx"\)/);
  assert.match(vite, /__PACKDEX_SCANNER_TEST__:\s*JSON\.stringify\(mode === "native-scanner"\)/);
  assert.match(vite, /__PACKDEX_NATIVE_BUILD__:\s*JSON\.stringify\(mode\.startsWith\("native"\)\)/);
  assert.match(vite, /stripPrivateScannerStyles\(mode\)/);
});
