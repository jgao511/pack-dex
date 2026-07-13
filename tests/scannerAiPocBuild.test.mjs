import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

test("dedicated scanner AI POC bundle is scanner-test-only and excludes Pixel holdouts", async () => {
  const assetsUrl = new URL("../mobile-app/dist/assets/", import.meta.url);
  const emittedFiles = await readdir(assetsUrl);
  const files = emittedFiles.filter((file) => file.endsWith(".js"));
  assert.ok(files.length > 0, "Build mobile-app with build:native:scanner:ai before running this test");
  const bundle = `${emittedFiles.join("\n")}\n${(await Promise.all(files.map((file) => readFile(new URL(file, assetsUrl), "utf8")))).join("\n")}`;
  assert.match(bundle, /\/mobile-app\/dev\/card-scanner/);
  assert.match(bundle, /Run AI POC Status/);
  assert.match(bundle, /scanner-ai-poc/);
  assert.match(bundle, /__PACKDEX_RUN_AI_SCANNER_FILE__/);
  assert.match(bundle, /catalog-embeddings/);
  assert.doesNotMatch(bundle, /local-pixel|IMG_66\d{2}/);
});
