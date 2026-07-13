import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getScannerCatalog } from "../../src/lib/cardScanner/buildScannerCatalog.js";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";

const outputPath = resolve(process.argv[2] || "artifacts/scanner-ai/catalog-manifest.json");

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareCodePoints(left, right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareCodePoints(leftValue, rightValue) {
  const left = Array.from(String(leftValue), (character) => character.codePointAt(0));
  const right = Array.from(String(rightValue), (character) => character.codePointAt(0));
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return left.length - right.length;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort(compareCodePoints);
}

function nameFamilyTokens(normalizedName) {
  const layoutTokenSet = new Set(["break", "ex", "gx", "lv", "m", "mega", "prime", "star", "v", "vmax", "vstar"]);
  return uniqueSorted(String(normalizedName || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !layoutTokenSet.has(token)));
}

function layoutTokens(normalizedName) {
  const matches = String(normalizedName || "").toLowerCase().match(/\b(?:break|ex|gx|lv|m|mega|prime|star|v|vmax|vstar)\b/g) || [];
  return uniqueSorted(matches);
}

const cards = getScannerCatalog()
  .map((entry) => {
    const imageUrl = getCardImageUrl(entry.card);
    return {
      cardId: entry.cardId,
      name: entry.name,
      normalizedName: entry.normalizedName,
      nameFamilyTokens: nameFamilyTokens(entry.normalizedName),
      layoutTokens: layoutTokens(entry.normalizedName),
      setId: entry.setId,
      setName: entry.setName,
      collectorNumber: entry.cardNumber,
      printedTotal: entry.printedSetTotal,
      rarity: entry.rarity,
      series: entry.series,
      imageUrl,
    };
  })
  .filter((entry) => entry.cardId && entry.imageUrl)
  .sort((a, b) => compareCodePoints(a.cardId, b.cardId));

const duplicateCardIds = cards.filter((entry, index) => index > 0 && entry.cardId === cards[index - 1].cardId);
if (duplicateCardIds.length) {
  throw new Error(`Trusted catalog contains duplicate card IDs: ${duplicateCardIds.slice(0, 5).map((entry) => entry.cardId).join(", ")}`);
}

const invalidImageUrls = cards.filter((entry) => {
  try {
    const url = new URL(entry.imageUrl);
    return url.protocol !== "https:" || url.hostname !== "assets.pack-dex.com" || !url.pathname.startsWith("/sets/");
  } catch {
    return true;
  }
});
if (invalidImageUrls.length) {
  throw new Error(`Catalog asset resolver emitted ${invalidImageUrls.length} invalid card-image URL(s).`);
}

const cardsChecksum = checksum(canonicalJson(cards));

const manifest = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  source: "trusted-packdex-catalog",
  sourceOfTruth: "src/lib/cardScanner/buildScannerCatalog.js",
  assetResolver: "src/utils/assetUrls.js#getCardImageUrl",
  assetHost: "https://assets.pack-dex.com",
  count: cards.length,
  cardsSha256: cardsChecksum,
  cards,
};

const body = `${JSON.stringify(manifest, null, 2)}\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, body);
console.log(`Wrote ${cards.length} catalog cards to ${outputPath} (${cardsChecksum})`);
