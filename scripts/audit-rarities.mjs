import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDisplayCardName,
  getDisplayRarity,
  getRarityCategory,
  normalizeRarity,
} from "../src/utils/packGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "src", "data");
const setsSource = fs.readFileSync(path.join(dataDir, "sets.js"), "utf8");
const setIds = Array.from(setsSource.matchAll(/createSet\("([^"]+)"/g), (match) => match[1]);
const chasePattern =
  /\b(mega hyper|hyper rare|rare hyper|gold rare|rare gold|rainbow rare|rare rainbow|secret rare|rare secret|special illustration rare|illustration rare|ultra rare|rare ultra|double rare|radiant rare|amazing rare|shiny|trainer gallery|galarian gallery|ace spec|black white rare)\b/u;
const suspiciousRows = [];

function normalize(value) {
  return normalizeRarity(value);
}

function cardEvidence(card) {
  return [
    card.rarity,
    card.name,
    card.id,
    card.number,
    card.image,
    card.imagePath,
    card.fileName,
    card.imageFileName,
    card.filename,
    card.subset,
    card.collection,
    card.rarityCategory,
  ]
    .filter(Boolean)
    .map((value) => normalize(value))
    .join(" ");
}

for (const setId of setIds) {
  const jsonPath = path.join(dataDir, `${setId}.json`);

  if (!fs.existsSync(jsonPath)) continue;

  const cards = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const counts = {};

  for (const card of cards) {
    const set = { id: setId, cards };
    const category = getRarityCategory(card, set);
    const evidence = cardEvidence(card);

    counts[category] = (counts[category] || 0) + 1;

    if (category === "rare" && chasePattern.test(evidence)) {
      suspiciousRows.push({
        setId,
        cardId: card.id || card.number,
        name: card.name,
        displayName: getDisplayCardName(card, set),
        rawRarity: card.rarity,
        displayRarity: getDisplayRarity(card, set),
        detectedRarityCategory: category,
        imagePath: card.image || card.imagePath || card.fileName || "",
        suspiciousReason: "Plain rare category but chase terms appear in card evidence.",
      });
    }
  }

  console.log(`\n${setId}`);
  console.table(counts);
}

if (suspiciousRows.length > 0) {
  console.log("\nSuspicious cards");
  console.table(suspiciousRows);
  process.exitCode = 1;
} else {
  console.log("\nNo plain-rare cards with chase rarity evidence were found.");
}
