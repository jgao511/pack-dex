import fs from "node:fs";
import path from "node:path";
import { loadAppPriceSyncData } from "./load-app-price-sync-data.mjs";

const ROOT_DIR = process.cwd();
const OUTPUT_PATH = path.join(ROOT_DIR, "supabase", "functions", "sync-card-prices", "catalog.json");
const MANIFEST_PATH = path.join(ROOT_DIR, "audits", "card-integrity", "official-card-manifest.json");

function compactCard(card = {}, manifestCard) {
  if (!manifestCard) throw new Error(`Card ${card.id || "unknown"} is absent from the pinned official manifest.`);
  return {
    id: card.id || "",
    name: card.name || "",
    number: card.number || "",
    rarity: card.rarity || "",
    sourceSetId: manifestCard.sourceSetId,
    sourceCardId: manifestCard.sourceCardId,
    tcgplayerPriceType: card.tcgplayerPriceType || undefined,
  };
}

const sets = await loadAppPriceSyncData(ROOT_DIR);
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const manifestByCardId = new Map(manifest.cards.map((card) => [card.packDexCardId, card]));
const catalog = sets
  .filter((set) => set.cards.length > 0 && set.cards.every((card) => manifestByCardId.has(card.id)))
  .map((set) => ({
    id: set.id,
    name: set.name,
    apiSetId: set.apiSetId,
    apiSetIds: [...new Set(set.cards.map((card) => manifestByCardId.get(card.id)?.sourceSetId).filter(Boolean))],
    tcgplayerSetSlug: set.tcgplayerSetSlug,
    cards: set.cards.map((card) => compactCard(card, manifestByCardId.get(card.id))),
  }));

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(catalog)}\n`);
fs.renameSync(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

console.log(`Wrote ${catalog.length} syncable price sets to ${path.relative(ROOT_DIR, OUTPUT_PATH)}.`);
