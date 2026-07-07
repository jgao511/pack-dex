import fs from "node:fs";
import path from "node:path";
import { loadAppPriceSyncData } from "./load-app-price-sync-data.mjs";

const ROOT_DIR = process.cwd();
const OUTPUT_PATH = path.join(ROOT_DIR, "supabase", "functions", "sync-card-prices", "catalog.json");

function compactCard(card = {}) {
  return {
    id: card.id || "",
    name: card.name || "",
    number: card.number || "",
    rarity: card.rarity || "",
  };
}

const sets = await loadAppPriceSyncData(ROOT_DIR);
const catalog = sets
  .filter((set) => set.canSync)
  .map((set) => ({
    id: set.id,
    name: set.name,
    apiSetId: set.apiSetId,
    tcgplayerSetSlug: set.tcgplayerSetSlug,
    cards: set.cards.map(compactCard),
  }));

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(catalog)}\n`);
fs.renameSync(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

console.log(`Wrote ${catalog.length} syncable price sets to ${path.relative(ROOT_DIR, OUTPUT_PATH)}.`);
