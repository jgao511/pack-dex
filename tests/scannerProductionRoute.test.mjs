import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

async function assertScannerFreeProductionAssets(assetsUrl) {
  const emittedFiles = await readdir(assetsUrl);
  const files = emittedFiles.filter((file) => file.endsWith(".js"));
  assert.ok(files.length > 0, "Build mobile-app before running this test");
  const bundle = `${emittedFiles.join("\n")}\n${(await Promise.all(files.map((file) => readFile(new URL(file, assetsUrl), "utf8")))).join("\n")}`;
  assert.match(bundle, /Explore|Discover Pokémon, sets, and TCG history/);
  assert.doesNotMatch(bundle, /Card Scanner|New · Beta|Keep the entire card inside the frame|\/mobile-app\/dev\/card-scanner|Scanner Test|Scanner Diagnostics|Run Reference Test|Run Pixel Fixture|pixel-real|local-pixel|IMG_66\d{2}|diglett-55-108|gardevoir-ex-111-114|mega-charizard-x-ex-013-094|__PACKDEX_SCANNER_OCR__|__PACKDEX_RUN_LOCAL_SCANNER_FILE__/);
  assert.doesNotMatch(bundle, /\bScanner\b/);
  assert.equal(emittedFiles.some((file) => /scanner/i.test(file)), false, "production emitted a scanner-named chunk");
}

test("browser/iPhone and Android production bundles expose Explore and no scanner UI, route, or scanner chunk", async () => {
  await assertScannerFreeProductionAssets(new URL("../mobile-app/dist/assets/", import.meta.url));
  await assertScannerFreeProductionAssets(new URL("../dist/mobile-app/assets/", import.meta.url));
  await assertScannerFreeProductionAssets(new URL("../mobile-app/android/app/src/main/assets/public/assets/", import.meta.url));
});
