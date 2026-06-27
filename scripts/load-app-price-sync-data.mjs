import path from "node:path";
import { pathToFileURL } from "node:url";

function hasCardLevelPriceInfo(card = {}) {
  return Boolean(
    card.tcgplayerId ||
      card.tcgplayer_id ||
      card.tcgplayerUrl ||
      card.tcgplayer_url ||
      card.pokemonTcgId ||
      card.pokemon_tcg_id ||
      card.apiId ||
      card.api_id
  );
}

function getSetApiId(set, priceSetMap) {
  return (
    set.pokemonTcgApiSetId ||
    set.pokemon_tcg_api_set_id ||
    set.apiSetId ||
    set.api_set_id ||
    set.priceAlias?.pokemonTcgApiSetId ||
    priceSetMap[set.id] ||
    null
  );
}

export async function loadAppPriceSyncData(rootDir = process.cwd()) {
  const setsModule = await import(pathToFileURL(path.join(rootDir, "src", "data", "sets.js")).href);
  const priceMapModule = await import(pathToFileURL(path.join(rootDir, "src", "lib", "priceSetMap.js")).href);
  const priceAliasModule = await import(pathToFileURL(path.join(rootDir, "src", "lib", "priceSetAliases.js")).href);
  const appSets = Array.isArray(setsModule.sets) ? setsModule.sets : [];
  const priceSetMap = priceMapModule.PRICE_SET_MAP || {};
  const priceSetAliases = priceAliasModule.PRICE_SET_ALIASES || {};

  return appSets.map((set) => {
    const cards = Array.isArray(set.cards) ? set.cards : [];
    const alias = priceSetAliases[set.id] || {};
    const apiSetId = getSetApiId({ ...set, priceAlias: alias }, priceSetMap);
    const tcgplayerSetSlug = set.tcgplayerSetSlug || set.tcgplayer_set_slug || alias.tcgplayerSetSlug || null;
    const cardsWithCardLevelPriceInfo = cards.filter(hasCardLevelPriceInfo).length;
    const cardsWithPriceLookupInfo = apiSetId ? cards.length : cardsWithCardLevelPriceInfo;
    const skipReason = apiSetId
      ? null
      : cardsWithCardLevelPriceInfo > 0
        ? "card-level price ids are present, but this sync endpoint needs a Pokemon TCG API set id"
        : "no Pokemon TCG API set id or card-level price ids";

    return {
      id: set.id,
      name: set.name || set.id,
      era: set.era || "Unknown",
      releaseDate: set.releaseDate || null,
      cards,
      cardCount: cards.length,
      apiSetId,
      tcgplayerSetSlug,
      cardsWithPriceLookupInfo,
      cardsMissingPriceLookupInfo: Math.max(0, cards.length - cardsWithPriceLookupInfo),
      canSync: Boolean(apiSetId),
      skipReason,
    };
  });
}
