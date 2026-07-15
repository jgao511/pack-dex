import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

test("dedicated native scanner bundle includes its route and Settings entry", async () => {
  const assetsUrl = new URL("../mobile-app/dist/assets/", import.meta.url);
  const emittedFiles = await readdir(assetsUrl);
  const files = emittedFiles.filter((file) => file.endsWith(".js"));
  assert.ok(files.length > 0, "Build the dedicated scanner-test bundle before running this test");
  const bundle = `${emittedFiles.join("\n")}\n${(await Promise.all(files.map((file) => readFile(new URL(file, assetsUrl), "utf8")))).join("\n")}`;
  assert.match(bundle, /\/mobile-app\/dev\/card-scanner/);
  assert.match(bundle, /Scanner Test/);
  assert.match(bundle, /Run Reference Test/);
  assert.match(bundle, /Run Pixel Fixture/);
  assert.match(bundle, /diglett-55-108/);
  assert.match(bundle, /gardevoir-ex-111-114/);
  assert.match(bundle, /Reading card/);
  assert.match(bundle, /Scanner Diagnostics/);
  assert.match(bundle, /scannerVisual\.worker/);
  assert.match(bundle, /analyze-proposals/);
  assert.match(bundle, /ORB\/RANSAC/);
  assert.match(bundle, /indexedCards/);
  assert.match(bundle, /__PACKDEX_RUN_LOCAL_SCANNER_FILE__/);
  assert.doesNotMatch(bundle, /local-pixel|IMG_66\d{2}/);
});
