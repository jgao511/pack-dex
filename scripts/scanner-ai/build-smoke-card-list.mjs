import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildScannerCatalog } from "../../src/lib/cardScanner/buildScannerCatalog.js";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";

const manifestPath = resolve("tests/fixtures/scanner/local-pixel-manifest.json");
const outputPath = resolve(process.argv[2] || "artifacts/scanner-ai/generated/smoke-card-list.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const catalog = buildScannerCatalog();
const byId = new Map(catalog.map((entry) => [entry.cardId, entry]));
const expectedIds = new Set(manifest.items.map((item) => item.cardId));
const expectedEntries = manifest.items.map((item) => byId.get(item.cardId)).filter(Boolean);

function cardType(entry) {
  const name = `${entry.name} ${entry.rarity || ""}`.toLowerCase();
  if (/trainer|supporter|item|tool/.test(name)) return "trainer";
  if (/\bex\b|-ex|\bgx\b|-gx|\bv\b|break/.test(name)) return "ultra";
  if (/radiant|rare|foil|holo/.test(name)) return "rare";
  return "ordinary";
}

function candidateScore(candidate) {
  let score = 0;
  for (const expected of expectedEntries) {
    if (candidate.setId === expected.setId) score += 60;
    if (candidate.normalizedName === expected.normalizedName) score += 50;
    if (cardType(candidate) === cardType(expected)) score += 20;
    if (candidate.rarity && candidate.rarity === expected.rarity) score += 10;
    if (candidate.series && candidate.series === expected.series) score += 6;
  }
  return score;
}

function toSmokeCard(entry) {
  return {
    cardId: entry.cardId,
    name: entry.name,
    setId: entry.setId,
    setName: entry.setName,
    collectorNumber: entry.cardNumber,
    rarity: entry.rarity,
    imageUrl: getCardImageUrl(entry.card),
  };
}

const hardNegatives = catalog
  .filter((entry) => !expectedIds.has(entry.cardId) && getCardImageUrl(entry.card))
  .map((entry) => ({ entry, score: candidateScore(entry) }))
  .filter((item) => item.score > 0)
  .sort((a, b) => b.score - a.score || a.entry.setId.localeCompare(b.entry.setId) || a.entry.cardId.localeCompare(b.entry.cardId))
  .slice(0, 112)
  .map(({ entry }) => entry);

const cards = [...expectedEntries, ...hardNegatives].map(toSmokeCard);
const payload = {
  schemaVersion: 1,
  mode: "scanner-ai-smoke-card-list",
  generatedAt: new Date().toISOString(),
  expectedCount: expectedEntries.length,
  hardNegativeCount: hardNegatives.length,
  total: cards.length,
  source: "trusted-packdex-catalog-via-existing-asset-resolver",
  cards,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${cards.length} smoke cards to ${outputPath}`);
