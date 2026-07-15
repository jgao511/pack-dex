import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

test("dedicated scanner AI POC bundle is scanner-test-only and excludes Pixel holdouts", async () => {
  const assetsUrl = new URL("../mobile-app/dist/assets/", import.meta.url);
  const marker = JSON.parse(await readFile(new URL("../mobile-app/dist/scanner-ai-build.json", import.meta.url), "utf8"));
  assert.equal(marker.scannerAiPoc, true);
  assert.match(marker.runtimeSourceSha256, /^[a-f0-9]{64}$/);
  const emittedFiles = await readdir(assetsUrl);
  const files = emittedFiles.filter((file) => file.endsWith(".js"));
  assert.ok(files.length > 0, "Build mobile-app with build:native:scanner:ai before running this test");
  const bundle = `${emittedFiles.join("\n")}\n${(await Promise.all(files.map((file) => readFile(new URL(file, assetsUrl), "utf8")))).join("\n")}`;
  assert.match(bundle, /\/mobile-app\/dev\/card-scanner/);
  assert.match(bundle, /Try Scanner-AI Photo/);
  assert.match(bundle, /quality guidance is evaluated after capture/);
  assert.match(bundle, /scanner-ai-poc/);
  assert.match(bundle, /__PACKDEX_RUN_AI_SCANNER_FILE__/);
  assert.match(bundle, /catalog-embeddings\.meta\.json/);
  assert.match(bundle, /packdex-hybrid-runtime-2026-07-13-trained-float32-v2/);
  assert.match(bundle, /offline-reference-descriptor-cache-unavailable/);
  assert.doesNotMatch(bundle, /local-pixel|pixel-real|IMG_66\d{2}|diglett-55-108|gardevoir-ex-111-114|here-comes-team-rocket-113-108/);
});
