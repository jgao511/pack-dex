import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...parts) => path.join(root, ...parts);
const modelHash = "62f2ff60cfdb09714a01fa74343e4dc1968601c2a43046979cbc548c28027c7c";
const indexHash = "a851d797aef5c140d8918bb2ffa7dcafa2315cb1f0cbdb6ca4abbd91c3d61edb";

async function metadata(relative) {
  return sharp(at(relative)).metadata();
}

async function assertOpaque(relative, width, height = width) {
  const info = await metadata(relative);
  assert.equal(info.width, width, `${relative} width`);
  assert.equal(info.height, height, `${relative} height`);
  assert.equal(info.hasAlpha, false, `${relative} must not have an alpha channel`);
}

async function sha256(relative) {
  return createHash("sha256").update(await readFile(at(relative))).digest("hex");
}

test("canonical PackDex source is opaque 1024px", async () => {
  await assertOpaque("assets/branding/source/packdex-icon-master-1024.png", 1024);
});

test("web and PWA icon declarations resolve to opaque assets with matching dimensions", async () => {
  for (const [file, size] of [["favicon.png", 48], ["apple-touch-icon.png", 180], ["packdex-icon-192.png", 192], ["packdex-icon-512.png", 512], ["packdex-small.png", 192], ["packdex-large.png", 512]]) {
    await assertOpaque(`public/${file}`, size);
  }
  const manifest = JSON.parse(await readFile(at("public/mobile-manifest.webmanifest"), "utf8"));
  assert.equal(manifest.background_color, "#0d1224");
  assert.equal(manifest.theme_color, "#0d1224");
  for (const icon of manifest.icons) {
    const size = Number(icon.sizes.split("x")[0]);
    await assertOpaque(`public/${icon.src.replace("/mobile-app/", "")}`, size);
  }
  const [desktop, mobile] = await Promise.all([readFile(at("index.html"), "utf8"), readFile(at("mobile-app/index.html"), "utf8")]);
  assert.match(desktop, /href="\/favicon\.png"/);
  assert.match(desktop, /href="\/apple-touch-icon\.png"/);
  assert.match(mobile, /packdex-icon-192\.png/);
  assert.match(mobile, /mobile-manifest\.webmanifest/);
});

test("iOS AppIcon is the canonical PackDex asset and its launch screen has no legacy splash reference", async () => {
  const [contents, project, launch] = await Promise.all([
    readFile(at("mobile-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json"), "utf8"),
    readFile(at("mobile-app/ios/App/App.xcodeproj/project.pbxproj"), "utf8"),
    readFile(at("mobile-app/ios/App/App/Base.lproj/LaunchScreen.storyboard"), "utf8"),
  ]);
  assert.match(contents, /AppIcon-512@2x\.png/);
  assert.match(project, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/);
  assert.match(launch, /text="PackDex"/);
  assert.doesNotMatch(launch, /Capacitor|Splash|image name=/i);
  await assertOpaque("mobile-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024);
  assert.equal(await sha256("mobile-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), await sha256("assets/branding/source/packdex-icon-master-1024.png"));
});

test("Android launcher and splash resources are PackDex-sized, opaque, and use navy launch branding", async () => {
  const manifest = await readFile(at("mobile-app/android/app/src/main/AndroidManifest.xml"), "utf8");
  const adaptive = await readFile(at("mobile-app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"), "utf8");
  const background = await readFile(at("mobile-app/android/app/src/main/res/values/ic_launcher_background.xml"), "utf8");
  const styles = await readFile(at("mobile-app/android/app/src/main/res/values/styles.xml"), "utf8");
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(adaptive, /@mipmap\/ic_launcher_foreground/);
  assert.match(background, /#0D1224/i);
  assert.match(styles, /windowSplashScreenAnimatedIcon">@mipmap\/ic_launcher/);
  for (const [density, size] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]]) {
    await assertOpaque(`mobile-app/android/app/src/main/res/mipmap-${density}/ic_launcher.png`, size);
    await assertOpaque(`mobile-app/android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`, size);
    await assertOpaque(`mobile-app/android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`, size * 2.25);
  }
  await assertOpaque("mobile-app/android/app/src/main/res/drawable-port-xxxhdpi/splash.png", 1280, 1920);
  await assertOpaque("mobile-app/android/app/src/main/res/drawable-land-xxxhdpi/splash.png", 1920, 1280);
});

test("frozen scanner model and index remain byte-for-byte unchanged", async () => {
  assert.equal(await sha256("public/scanner-ai/frozen-a-62f2ff60.tflite"), modelHash);
  assert.equal(await sha256("public/scanner-ai/catalog-embeddings-a851d797.f16"), indexHash);
});
