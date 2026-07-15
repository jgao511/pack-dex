import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

test("mobile production bundle includes Card Scanner but excludes development scanner UI", async () => {
  const assetsUrl = new URL("../mobile-app/dist/assets/", import.meta.url);
  const emittedFiles = await readdir(assetsUrl);
  const files = emittedFiles.filter((file) => file.endsWith(".js"));
  assert.ok(files.length > 0, "Build mobile-app before running this test");
  const bundle = `${emittedFiles.join("\\n")}\\n${(await Promise.all(files.map((file) => readFile(new URL(file, assetsUrl), "utf8")))).join("\\n")}`;
  assert.match(bundle, /Card Scanner|New · Beta|Keep the entire card inside the frame/);
  assert.doesNotMatch(bundle, /\/mobile-app\/dev\/card-scanner|Development card text|Scanner Test|Scanner Diagnostics|Run Reference Test|Run Pixel Fixture|pixel-real|local-pixel|IMG_66\d{2}|diglett-55-108|gardevoir-ex-111-114|mega-charizard-x-ex-013-094|__PACKDEX_SCANNER_OCR__|__PACKDEX_RUN_LOCAL_SCANNER_FILE__/);
});