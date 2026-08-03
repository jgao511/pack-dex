import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(ROOT_DIR, "public", "scanner-ai", "catalog-metadata.json");

const cards = buildScannerCatalog()
  .map((entry) => ({
    cardId: entry.cardId,
    collectorNumber: entry.cardNumber,
    name: entry.name,
    normalizedName: entry.normalizedName,
    printedTotal: entry.printedSetTotal,
    rarity: entry.rarity,
    setId: entry.setId,
    setName: entry.setName,
  }))
  .sort((left, right) => left.cardId.localeCompare(right.cardId));

const output = `${JSON.stringify({ cards, count: cards.length, schemaVersion: 2 })}\n`;

if (process.argv.includes("--check")) {
  const existing = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : "";
  if (existing !== output) throw new Error("Scanner catalog metadata is stale. Rebuild it before deployment.");
  console.log(`Scanner catalog metadata is current: ${cards.length} canonical cards.`);
} else {
  const temporaryPath = `${OUTPUT_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, output);
  fs.renameSync(temporaryPath, OUTPUT_PATH);
  console.log(`Wrote ${cards.length} canonical cards to ${path.relative(ROOT_DIR, OUTPUT_PATH)}.`);
}
