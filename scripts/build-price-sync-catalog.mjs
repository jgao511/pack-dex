import fs from "node:fs";
import path from "node:path";
import { loadAppPriceSyncData } from "./load-app-price-sync-data.mjs";

const ROOT_DIR = process.cwd();
const OUTPUT_PATH = path.join(ROOT_DIR, "supabase", "functions", "sync-card-prices", "catalog.json");
const MANIFEST_PATH = path.join(ROOT_DIR, "audits", "card-integrity", "official-card-manifest.json");
const VERIFIED_PRODUCTS_PATH = path.join(ROOT_DIR, "audits", "pricing", "verified-marketplace-products.json");
const VERIFIED_FALLBACKS_PATH = path.join(ROOT_DIR, "audits", "pricing", "verified-non-reverse-fallbacks.json");
const VERIFIED_NUMBER_OVERRIDES = new Map([
  ["black-bolt-60-antique-cover-fossil", { apiCardId: "zsv10pt5-80", tcgplayerProductId: "642529" }],
]);

function compactCard(card = {}, manifestCard, verifiedProduct, verifiedFallback) {
  if (!manifestCard) throw new Error(`Card ${card.id || "unknown"} is absent from the pinned official manifest.`);
  const derivedMarketplaceUrl = `https://prices.pokemontcg.io/tcgplayer/${encodeURIComponent(manifestCard.sourceCardId)}`;
  if (verifiedProduct && verifiedProduct.canonicalMarketplaceUrl !== derivedMarketplaceUrl) {
    throw new Error(`Verified marketplace URL for ${card.id || "unknown"} is not derivable from its pinned API card ID.`);
  }
  const numberOverride = VERIFIED_NUMBER_OVERRIDES.get(card.id);
  if (numberOverride && (
    manifestCard.sourceCardId !== numberOverride.apiCardId ||
    verifiedProduct?.tcgplayerProductId !== numberOverride.tcgplayerProductId
  )) {
    throw new Error(`Verified collector-number override proof is incomplete for ${card.id}.`);
  }
  if (verifiedFallback && (
    manifestCard.sourceCardId !== verifiedFallback.pokemonTcgApiCardId ||
    verifiedProduct?.tcgplayerProductId !== verifiedFallback.tcgplayerProductId ||
    !["normal", "holofoil"].includes(verifiedFallback.priceType)
  )) {
    throw new Error(`Verified non-reverse fallback proof is incomplete for ${card.id}.`);
  }
  return {
    id: card.id || "",
    name: card.name || "",
    number: card.number || "",
    rarity: card.rarity || "",
    sourceSetId: manifestCard.sourceSetId,
    sourceCardId: manifestCard.sourceCardId,
    tcgplayerPriceType: card.tcgplayerPriceType || undefined,
    verifiedTcgplayerProductId: verifiedProduct?.tcgplayerProductId || undefined,
    verifiedFallbackPriceType: verifiedFallback?.priceType || undefined,
    allowVerifiedNumberOverride: numberOverride ? true : undefined,
  };
}

const sets = await loadAppPriceSyncData(ROOT_DIR);
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const manifestByCardId = new Map(manifest.cards.map((card) => [card.packDexCardId, card]));
const verifiedProducts = fs.existsSync(VERIFIED_PRODUCTS_PATH)
  ? JSON.parse(fs.readFileSync(VERIFIED_PRODUCTS_PATH, "utf8"))
  : [];
const verifiedFallbacks = JSON.parse(fs.readFileSync(VERIFIED_FALLBACKS_PATH, "utf8"));
const verifiedProductByCardId = new Map(verifiedProducts.map((entry) => [entry.packDexCardId, entry]));
const verifiedFallbackByCardId = new Map(verifiedFallbacks.map((entry) => [entry.packDexCardId, entry]));
const missingManifestCards = sets.flatMap((set) => set.cards
  .filter((card) => !manifestByCardId.has(card.id))
  .map((card) => `${set.id}/${card.id}`));
if (missingManifestCards.length > 0) {
  throw new Error(`Price catalog is missing ${missingManifestCards.length} official manifest identities: ${missingManifestCards.slice(0, 20).join(", ")}`);
}
const catalog = sets
  .filter((set) => set.cards.length > 0)
  .map((set) => ({
    id: set.id,
    name: set.name,
    apiSetId: set.apiSetId,
    apiSetIds: [...new Set(set.cards.map((card) => manifestByCardId.get(card.id)?.sourceSetId).filter(Boolean))],
    tcgplayerSetSlug: set.tcgplayerSetSlug,
    cards: set.cards.map((card) => compactCard(card, manifestByCardId.get(card.id), verifiedProductByCardId.get(card.id), verifiedFallbackByCardId.get(card.id))),
  }));

const catalogCardIds = new Set(catalog.flatMap((set) => set.cards.map((card) => card.id)));
const unknownVerifiedProducts = verifiedProducts.filter((entry) => !catalogCardIds.has(entry.packDexCardId));
if (unknownVerifiedProducts.length > 0) {
  throw new Error(`Verified marketplace products reference inactive cards: ${unknownVerifiedProducts.map((entry) => entry.packDexCardId).join(", ")}`);
}
const unknownVerifiedFallbacks = verifiedFallbacks.filter((entry) => !catalogCardIds.has(entry.packDexCardId));
if (unknownVerifiedFallbacks.length > 0) {
  throw new Error(`Verified non-reverse fallbacks reference inactive cards: ${unknownVerifiedFallbacks.map((entry) => entry.packDexCardId).join(", ")}`);
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(`${OUTPUT_PATH}.tmp`, `${JSON.stringify(catalog)}\n`);
fs.renameSync(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

console.log(`Wrote ${catalog.length} syncable price sets to ${path.relative(ROOT_DIR, OUTPUT_PATH)}.`);
