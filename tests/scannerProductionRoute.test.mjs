import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

test("mobile production bundle excludes the development scanner route and UI", async () => {
  const assetsUrl = new URL("../mobile-app/dist/assets/", import.meta.url);
  const files = (await readdir(assetsUrl)).filter((file) => file.endsWith(".js"));
  assert.ok(files.length > 0, "Build mobile-app before running this test");
  const bundle = (await Promise.all(files.map((file) => readFile(new URL(file, assetsUrl), "utf8")))).join("\n");
  assert.doesNotMatch(bundle, /\/mobile-app\/dev\/card-scanner|Development card text|Scanner Test|Scanner Diagnostics|Run Reference Test|mega-charizard-x-ex-013-094|__PACKDEX_SCANNER_OCR__/);
});
