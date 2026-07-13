import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifestPath = resolve(process.argv[2] || "tests/fixtures/scanner/local-pixel-manifest.json");
const outputPath = resolve(process.argv[3] || "artifacts/scanner-ai/reports/holdout-ai-poc-template.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const photos = manifest.fixtures || manifest.photos || manifest;

const report = {
  schemaVersion: 1,
  mode: "scanner-ai-poc-holdout-template",
  note: "Run this from a connected scanner-test browser after the local LiteRT model and catalog embedding index exist. It does not train or tune against the holdout photos.",
  expectedCount: Array.isArray(photos) ? photos.length : 0,
  requiredBrowserGlobal: "__PACKDEX_RUN_AI_SCANNER_FILE__",
  perPhoto: [],
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote AI holdout benchmark template to ${outputPath}`);
