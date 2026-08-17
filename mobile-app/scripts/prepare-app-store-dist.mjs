import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = fileURLToPath(new URL("../", import.meta.url));
const distRoot = path.resolve(mobileRoot, "dist");
const scannerAssets = path.resolve(distRoot, "scanner-ai");

assert.equal(path.dirname(scannerAssets), distRoot, "Refusing to remove files outside the native dist directory");
await rm(scannerAssets, { recursive: true, force: true });
for (const hostingOnlyFile of ["_headers", "_redirects", "_routes.json", "ads.txt", "robots.txt", "sitemap.xml"]) {
  await rm(path.resolve(distRoot, hostingOnlyFile), { force: true });
}

async function removeDonationAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    assert.ok(absolute.startsWith(`${distRoot}${path.sep}`), "Refusing to remove files outside the native dist directory");
    if (/buymeacoffee|buy-me-a-coffee/i.test(entry.name)) await rm(absolute, { recursive: true, force: true });
    else if (entry.isDirectory()) await removeDonationAssets(absolute);
  }
}

await removeDonationAssets(distRoot);

const bannedText = /buymeacoffee|buy me a coffee|scanner-ai|cardscanner|camerapreview|capacitorcamera|mlkit|textrecognition|scanner-camera-active|scanner-beta|scanner-dev|mobile-icon-scanner|add packdex to your home screen|Ri6i8fEIdrU/i;
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs", ".txt"]);

async function inspect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(distRoot, absolute).replaceAll("\\", "/");
    assert.doesNotMatch(relative, /scanner|camera|photo|ocr|ml-kit|text-recognition|buymeacoffee/i);
    if (entry.isDirectory()) await inspect(absolute);
    else if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
      assert.doesNotMatch(await readFile(absolute, "utf8"), bannedText, `Private feature leaked into ${relative}`);
    }
  }
}

await inspect(distRoot);
console.info("App Store native bundle is free of scanner, camera, OCR, and donation artifacts.");
