import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { getExternalHttpUrl, installIosExternalLinkRouting } from "../mobile-app/src/lib/externalLinks.js";
import { getScannerRuntime, isAndroidNative, isIosNative } from "../mobile-app/src/lib/platform.js";
import { resolveScannerAssetUrl } from "../mobile-app/src/lib/scannerAssetUrl.js";

const capacitor = (platform, native = true) => ({ isNativePlatform: () => native, getPlatform: () => platform });

test("scanner runtime selection is explicit for Android, iOS, and web", () => {
  assert.equal(isAndroidNative(capacitor("android")), true);
  assert.equal(isIosNative(capacitor("android")), false);
  assert.equal(getScannerRuntime(capacitor("android")), "android-native");
  assert.equal(isIosNative(capacitor("ios")), true);
  assert.equal(isAndroidNative(capacitor("ios")), false);
  assert.equal(getScannerRuntime(capacitor("ios")), "browser-wasm");
  assert.equal(getScannerRuntime(capacitor("web", false)), "browser-wasm");
});

test("iOS uses bundled browser scanner URLs under the Capacitor scheme", () => {
  assert.equal(resolveScannerAssetUrl("frozen-a-62f2ff60.tflite", { baseUrl: "./", origin: "capacitor://localhost" }), "capacitor://localhost/scanner-ai/frozen-a-62f2ff60.tflite");
  assert.equal(resolveScannerAssetUrl("wasm/", { baseUrl: "./", origin: "capacitor://localhost" }), "capacitor://localhost/scanner-ai/wasm/");
});

test("iOS routing opens external HTTP links without intercepting internal or mail links", async () => {
  const locationRef = { href: "capacitor://localhost/index.html", origin: "null" };
  const anchor = (href) => ({ getAttribute: () => href });
  assert.equal(getExternalHttpUrl(anchor("https://www.tcgplayer.com/card"), locationRef), "https://www.tcgplayer.com/card");
  assert.equal(getExternalHttpUrl(anchor("/settings"), locationRef), null);
  assert.equal(getExternalHttpUrl(anchor("mailto:packdexsupport@gmail.com"), locationRef), null);

  let listener; const opened = [];
  const documentRef = { addEventListener: (_name, callback) => { listener = callback; }, removeEventListener() {} };
  installIosExternalLinkRouting({ capacitor: capacitor("ios"), documentRef, locationRef, openBrowser: async (url) => opened.push(url) });
  let prevented = false;
  listener({ target: { closest: () => anchor("https://youtube.com/watch?v=test") }, button: 0, preventDefault: () => { prevented = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.deepEqual(opened, ["https://youtube.com/watch?v=test"]);
});

test("iOS cannot import or call Android scanner adapters through platform selection", async () => {
  const [page, frozen, adapters] = await Promise.all([
    readFile(new URL("../mobile-app/src/MobileScannerPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/lib/frozenAScanner.js", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/lib/nativeScannerAdapters.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /if \(!usesAndroidNativeScanner\(\)\) return null;/);
  assert.match(page, /import\("\.\/lib\/nativeScannerAdapters\.js"\)/);
  assert.doesNotMatch(page, /Capacitor\.isNativePlatform/);
  assert.match(frozen, /isAndroidNative\(Capacitor\) \? createNativeEmbedder\(\) : createBrowserEmbedder\(\)/);
  assert.match(adapters, /isAvailable: \(\) => isAndroidNative\(\)/);
  assert.equal((adapters.match(/CameraPreview\.(?:start|capture|stop)/g) || []).length > 0, true);
});

test("iOS configuration contains only scoped permissions and a valid privacy manifest", async () => {
  const [info, project, privacy, css] = await Promise.all([
    readFile(new URL("../mobile-app/ios/App/App/Info.plist", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/ios/App/App/PrivacyInfo.xcprivacy", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8"),
  ]);
  assert.match(info, /NSCameraUsageDescription[\s\S]*PackDex uses the camera to scan and identify trading cards\./);
  assert.match(info, /NSPhotoLibraryUsageDescription[\s\S]*PackDex uses selected photos to identify trading cards\./);
  assert.doesNotMatch(info, /Microphone|Location|Bluetooth|Tracking|NSAllowsArbitraryLoads/);
  assert.match(project, /TARGETED_DEVICE_FAMILY = 1;/);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(privacy, /NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("scanner camera lifecycle still stops on teardown and restarts once through its epoch", async () => {
  const page = await readFile(new URL("../mobile-app/src/MobileScannerPage.jsx", import.meta.url), "utf8");
  assert.match(page, /return \(\) => \{ mountedRef\.current = false;[\s\S]*void stopCamera\(\); \};/);
  assert.match(page, /if \(document\.hidden\) void stopCamera\(\); else setCameraEpoch\(\(value\) => value \+ 1\);/);
  assert.match(page, /startingRef\.current\) return startingRef\.current/);
});

test("frozen-A hashes stay exact and model C is absent from the iOS scanner bundle", async () => {
  const hash = async (url) => createHash("sha256").update(await readFile(url)).digest("hex");
  assert.equal(await hash(new URL("../public/scanner-ai/frozen-a-62f2ff60.tflite", import.meta.url)), "62f2ff60cfdb09714a01fa74343e4dc1968601c2a43046979cbc548c28027c7c");
  assert.equal(await hash(new URL("../public/scanner-ai/catalog-embeddings-a851d797.f16", import.meta.url)), "a851d797aef5c140d8918bb2ffa7dcafa2315cb1f0cbdb6ca4abbd91c3d61edb");
  const files = await readdir(new URL("../mobile-app/ios/App/App/public/scanner-ai/", import.meta.url), { recursive: true });
  assert.equal(files.some((name) => /(?:model|frozen)[-_]?c/i.test(name)), false);
});
