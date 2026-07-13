import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

test("dedicated native scanner bundle includes its route and Settings entry", async () => {
  const assetsUrl = new URL("../mobile-app/dist/assets/", import.meta.url);
  const files = (await readdir(assetsUrl)).filter((file) => file.endsWith(".js"));
  const bundle = `${files.join("\n")}\n${(await Promise.all(files.map((file) => readFile(new URL(file, assetsUrl), "utf8")))).join("\n")}`;
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
});
