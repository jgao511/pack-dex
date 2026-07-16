import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const master = path.join(root, "assets", "branding", "source", "packdex-icon-master-1024.png");
const navy = "#0d1224";

const publicSizes = new Map([
  ["favicon.png", 48],
  ["apple-touch-icon.png", 180],
  ["packdex-icon-192.png", 192],
  ["packdex-icon-512.png", 512],
  // Legacy URLs are retained for deployed and installed PWA compatibility.
  ["packdex-small.png", 192],
  ["packdex-large.png", 512],
]);

const densities = new Map([
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
]);

const splashSizes = new Map([
  ["drawable/splash.png", [480, 320]],
  ["drawable-land-mdpi/splash.png", [480, 320]],
  ["drawable-land-hdpi/splash.png", [800, 480]],
  ["drawable-land-xhdpi/splash.png", [1280, 720]],
  ["drawable-land-xxhdpi/splash.png", [1600, 960]],
  ["drawable-land-xxxhdpi/splash.png", [1920, 1280]],
  ["drawable-port-mdpi/splash.png", [320, 480]],
  ["drawable-port-hdpi/splash.png", [480, 800]],
  ["drawable-port-xhdpi/splash.png", [720, 1280]],
  ["drawable-port-xxhdpi/splash.png", [960, 1600]],
  ["drawable-port-xxxhdpi/splash.png", [1280, 1920]],
]);

async function ensureParent(file) {
  await mkdir(path.dirname(file), { recursive: true });
}

async function writePng(file, pipeline) {
  await ensureParent(file);
  await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(file);
}

function icon(size) {
  return sharp(master).resize(size, size, { kernel: sharp.kernel.lanczos3 }).removeAlpha();
}

async function makeAdaptiveForeground(size) {
  const innerSize = Math.round(size * 0.9);
  const artwork = await icon(innerSize).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: navy } })
    .composite([{ input: artwork, left: Math.floor((size - innerSize) / 2), top: Math.floor((size - innerSize) / 2) }])
    .removeAlpha();
}

async function makeSplash(width, height) {
  const artworkSize = Math.round(Math.min(width, height) * 0.45);
  const artwork = await icon(artworkSize).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: navy } })
    .composite([{ input: artwork, left: Math.floor((width - artworkSize) / 2), top: Math.floor((height - artworkSize) / 2) }])
    .removeAlpha();
}

async function createContactSheet() {
  const rows = [
    [master, 256],
    [path.join(root, "public", "favicon.png"), 96],
    [path.join(root, "public", "packdex-icon-192.png"), 192],
    [path.join(root, "public", "packdex-icon-512.png"), 256],
    [path.join(root, "mobile-app", "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png"), 256],
    [path.join(root, "mobile-app", "android", "app", "src", "main", "res", "mipmap-xxxhdpi", "ic_launcher_foreground.png"), 216],
  ];
  const cell = 288;
  const labels = ["Canonical 1024", "Favicon 48", "PWA 192", "PWA 512", "iOS AppIcon", "Android adaptive"];
  const tiles = await Promise.all(rows.map(async ([file, size], index) => {
    const image = await sharp(file).resize(size, size, { kernel: sharp.kernel.lanczos3 }).png().toBuffer();
    const svg = Buffer.from(`<svg width="${cell}" height="${cell}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0d1224"/><text x="16" y="28" fill="#d8ceff" font-family="Arial, sans-serif" font-size="16">${labels[index]}</text></svg>`);
    return sharp(svg).composite([{ input: image, left: Math.floor((cell - size) / 2), top: 44 + Math.floor((cell - 44 - size) / 2) }]).png().toBuffer();
  }));
  const out = path.join(process.env.TEMP || process.cwd(), "packdex-brand-contact-sheet.png");
  await sharp({ create: { width: cell * 3, height: cell * 2, channels: 3, background: navy } })
    .composite(tiles.map((input, index) => ({ input, left: (index % 3) * cell, top: Math.floor(index / 3) * cell })))
    .png({ compressionLevel: 9 }).toFile(out);
  return out;
}

async function main() {
  for (const [name, size] of publicSizes) await writePng(path.join(root, "public", name), icon(size));

  const iosIcon = path.join(root, "mobile-app", "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png");
  await ensureParent(iosIcon);
  await copyFile(master, iosIcon);

  for (const [density, size] of densities) {
    const target = path.join(root, "mobile-app", "android", "app", "src", "main", "res", `mipmap-${density}`);
    await writePng(path.join(target, "ic_launcher.png"), icon(size));
    await writePng(path.join(target, "ic_launcher_round.png"), icon(size));
    await writePng(path.join(target, "ic_launcher_foreground.png"), await makeAdaptiveForeground(size * 2.25));
  }
  for (const [relative, [width, height]] of splashSizes) {
    await writePng(path.join(root, "mobile-app", "android", "app", "src", "main", "res", relative), await makeSplash(width, height));
  }

  if (process.argv.includes("--contact-sheet")) console.info(`Contact sheet: ${await createContactSheet()}`);
  console.info("Generated PackDex branding assets from assets/branding/source/packdex-icon-master-1024.png.");
}

await main();
