import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getScannerCatalog } from "../../src/lib/cardScanner/buildScannerCatalog.js";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";

const outputPath = resolve(process.argv[2] || "artifacts/scanner-ai/catalog-manifest.json");

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

const cards = getScannerCatalog()
  .map((entry) => ({
    cardId: entry.cardId,
    name: entry.name,
    setId: entry.setId,
    setName: entry.setName,
    collectorNumber: entry.cardNumber,
    imageUrl: getCardImageUrl(entry.card),
  }))
  .filter((entry) => entry.cardId && entry.imageUrl)
  .sort((a, b) => a.cardId.localeCompare(b.cardId));

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "trusted-packdex-catalog",
  assetHost: "https://assets.pack-dex.com",
  count: cards.length,
  cards,
};

const body = `${JSON.stringify({ ...manifest, checksum: checksum(JSON.stringify(cards)) }, null, 2)}\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, body);
console.log(`Wrote ${cards.length} catalog cards to ${outputPath}`);
