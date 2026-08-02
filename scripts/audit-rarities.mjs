import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDisplayCardName,
  getDisplayRarity,
  getRarityCategory,
  normalizeRarity,
} from "../src/utils/packGenerator.js";
import { sets } from "../src/data/sets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const chasePattern =
  /\b(mega hyper|hyper rare|rare hyper|gold rare|rare gold|rainbow rare|rare rainbow|secret rare|rare secret|special illustration rare|illustration rare|ultra rare|rare ultra|double rare|radiant rare|amazing rare|shiny|trainer gallery|galarian gallery|ace spec|black white rare)\b/u;
const suspiciousRows = [];
const integrityErrors = [];
const globalCardIds = new Map();
const scannerCatalogPath = path.join(rootDir, "public", "scanner-ai", "catalog-metadata.json");
const priceCatalogPath = path.join(rootDir, "supabase", "functions", "sync-card-prices", "catalog.json");
const scannerCatalog = fs.existsSync(scannerCatalogPath) ? JSON.parse(fs.readFileSync(scannerCatalogPath, "utf8")) : [];
const scannerRows = Array.isArray(scannerCatalog) ? scannerCatalog : scannerCatalog.cards || [];
const scannerByCardId = new Map(scannerRows.map((row) => [String(row.cardId || ""), row]));
const priceSets = fs.existsSync(priceCatalogPath) ? JSON.parse(fs.readFileSync(priceCatalogPath, "utf8")) : [];
const priceByCardId = new Map(priceSets.flatMap((set) => (
  (set.cards || []).map((card) => [String(card.id || ""), { ...card, setId: set.id }])
)));
const pairedArtAuditSetIds = new Set(["white-flare", "black-bolt", "ascended-heroes", "pitch-black"]);

function normalize(value) {
  return normalizeRarity(value);
}

function explicitRarityEvidence(card) {
  return [
    card.rarity,
    card.subset,
    card.rarityCategory,
  ]
    .filter(Boolean)
    .map((value) => normalize(value))
    .join(" ");
}

for (const setDefinition of sets) {
  const setId = String(setDefinition.id || "");
  const cards = Array.isArray(setDefinition.cards) ? setDefinition.cards : [];
  const counts = {};
  const cardsByName = new Map();

  for (const card of cards) {
    const set = setDefinition;
    const category = getRarityCategory(card, set);
    const rarityEvidence = explicitRarityEvidence(card);

    counts[category] = (counts[category] || 0) + 1;

    const number = String(card.number || "").trim();
    const id = String(card.id || "").trim();
    if (!number) integrityErrors.push({ setId, cardId: id, reason: "missing_collector_number" });
    if (!id) integrityErrors.push({ setId, cardId: number, reason: "missing_card_id" });
    if (!String(card.rarity || "").trim()) integrityErrors.push({ setId, cardId: id || number, reason: "missing_rarity" });
    if (globalCardIds.has(id)) {
      integrityErrors.push({ setId, cardId: id, reason: `duplicate_card_id_also_in_${globalCardIds.get(id)}` });
    } else if (id) globalCardIds.set(id, setId);
    if (category === "other") integrityErrors.push({ setId, cardId: id || number, reason: "unsupported_rarity_category" });

    const normalizedName = normalize(card.name);
    if (normalizedName) {
      const sameNameCards = cardsByName.get(normalizedName) || [];
      sameNameCards.push({ card, category, numericNumber: Number(number) });
      cardsByName.set(normalizedName, sameNameCards);
    }

    const scannerCard = scannerByCardId.get(id);
    if (scannerCard && normalize(scannerCard.rarity) !== normalize(card.rarity)) {
      integrityErrors.push({ setId, cardId: id || number, reason: "scanner_catalog_rarity_mismatch" });
    }
    if (
      scannerCard &&
      (
        String(scannerCard.setId || "") !== setId ||
        String(scannerCard.collectorNumber || "") !== number ||
        normalize(scannerCard.name) !== normalizedName
      )
    ) {
      integrityErrors.push({ setId, cardId: id || number, reason: "scanner_catalog_identity_mismatch" });
    }
    const priceCard = priceByCardId.get(id);
    if (priceCard && normalize(priceCard.rarity) !== normalize(card.rarity)) {
      integrityErrors.push({ setId, cardId: id || number, reason: "price_catalog_rarity_mismatch" });
    }
    if (
      priceCard &&
      (
        String(priceCard.setId || "") !== setId ||
        String(priceCard.number || "") !== number ||
        normalize(priceCard.name) !== normalizedName
      )
    ) {
      integrityErrors.push({ setId, cardId: id || number, reason: "price_catalog_identity_mismatch" });
    }

    if (category === "rare" && chasePattern.test(rarityEvidence)) {
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

  if (pairedArtAuditSetIds.has(setId)) {
    for (const sameNameCards of cardsByName.values()) {
      if (sameNameCards.length < 2) continue;
      const base = [...sameNameCards].sort((a, b) => a.numericNumber - b.numericNumber)[0];
      for (const candidate of sameNameCards) {
        if (
          candidate.numericNumber >= 100 &&
          candidate.numericNumber > base.numericNumber &&
          ["common", "uncommon"].includes(candidate.category) &&
          candidate.category === base.category
        ) {
          integrityErrors.push({
            setId,
            cardId: candidate.card.id || candidate.card.number,
            reason: "high_number_duplicate_name_copied_base_rarity",
          });
        }
      }
    }
  }

  console.log(`\n${setId}`);
  console.table(counts);
}

const whiteFlare = sets.find((set) => set.id === "white-flare");
const archen50 = whiteFlare?.cards.find((card) => String(card.number) === "50" && card.name === "Archen");
const archen131 = whiteFlare?.cards.find((card) => String(card.number) === "131" && card.name === "Archen");
if (getRarityCategory(archen50 || {}, whiteFlare) !== "uncommon") {
  integrityErrors.push({ setId: "white-flare", cardId: archen50?.id || "50", reason: "archen_50_must_be_uncommon" });
}
if (getRarityCategory(archen131 || {}, whiteFlare) !== "illustrationRare") {
  integrityErrors.push({ setId: "white-flare", cardId: archen131?.id || "131", reason: "archen_131_must_be_illustration_rare" });
}

if (suspiciousRows.length > 0) {
  console.log("\nSuspicious cards");
  console.table(suspiciousRows);
  process.exitCode = 1;
} else {
  console.log("\nNo plain-rare cards with chase rarity evidence were found.");
}

if (integrityErrors.length > 0) {
  console.log("\nRarity and identity integrity errors");
  console.table(integrityErrors);
  process.exitCode = 1;
} else {
  console.log("No rarity/identity mismatches were found across canonical and generated catalogs.");
}
