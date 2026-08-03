import {
  buildCanonicalCardLookup,
  matchCanonicalCard,
  positiveNumber,
  selectTcgplayerPrice,
} from "../supabase/functions/_shared/cardPricing.js";

export function summarizeLivePriceCoverage(set, apiCards = [], apiErrors = []) {
  const mappedApiSetIds = set.apiSetIds || [set.apiSetId];
  const lookup = buildCanonicalCardLookup(set.cards || []);
  const matchedAppIds = new Set();
  const matchedApiIds = new Set();
  const matchKinds = { api_card_id: 0, set_number_name: 0, set_unique_number: 0 };
  let tcgplayerObjects = 0;
  let canonicalUrls = 0;
  let anyPositiveMarket = 0;
  let acceptedMarkets = 0;
  let urlWithoutAcceptedMarket = 0;
  let skippedVariants = 0;
  let ambiguousApiCards = 0;
  let latestSourceUpdatedAt = null;

  for (const apiCard of apiCards) {
    const match = matchCanonicalCard(apiCard, lookup);
    if (!match.card) {
      if (match.ambiguous) ambiguousApiCards += 1;
      continue;
    }
    matchedAppIds.add(match.card.id);
    matchedApiIds.add(apiCard.id);
    if (matchKinds[match.matchType] !== undefined) matchKinds[match.matchType] += 1;
    const tcgplayer = apiCard.tcgplayer || null;
    const hasUrl = Boolean(tcgplayer?.url);
    if (tcgplayer) tcgplayerObjects += 1;
    if (hasUrl) canonicalUrls += 1;
    const buckets = Object.values(tcgplayer?.prices || {});
    if (buckets.some((bucket) => positiveNumber(bucket?.market) !== null)) anyPositiveMarket += 1;
    const selection = selectTcgplayerPrice(apiCard, match.card);
    if (selection.priceType && positiveNumber(selection.price?.market) !== null) acceptedMarkets += 1;
    else if (hasUrl) urlWithoutAcceptedMarket += 1;
    if (!selection.priceType && buckets.length > 0) skippedVariants += 1;
    const updatedAt = String(tcgplayer?.updatedAt || "").trim();
    if (updatedAt && (!latestSourceUpdatedAt || updatedAt > latestSourceUpdatedAt)) latestSourceUpdatedAt = updatedAt;
  }

  const packDexCardCount = set.cards?.length || 0;
  const suspiciousMappings = matchKinds.set_number_name + matchKinds.set_unique_number + ambiguousApiCards;
  return {
    packDexSetId: set.id,
    packDexDisplayName: set.name,
    pokemonTcgApiSetIds: mappedApiSetIds,
    tcgplayerSetSlug: set.tcgplayerSetSlug || null,
    packDexCanonicalCardCount: packDexCardCount,
    apiCardsFetched: apiCards.length,
    exactCardMatches: matchedAppIds.size,
    exactApiIdMatches: matchKinds.api_card_id,
    setNumberNameMatches: matchKinds.set_number_name,
    uniqueSetNumberMatches: matchKinds.set_unique_number,
    cardsWithTcgplayerObject: tcgplayerObjects,
    cardsWithCanonicalTcgplayerUrl: canonicalUrls,
    cardsWithAnyPositiveMarketPrice: anyPositiveMarket,
    cardsWithAcceptedMarketPrice: acceptedMarkets,
    cardsWithUrlButNoAcceptedMarketPrice: urlWithoutAcceptedMarket,
    packDexCardsWithNoApiMatch: packDexCardCount - matchedAppIds.size,
    apiCardsWithNoPackDexMapping: apiCards.length - matchedApiIds.size,
    skippedVariants,
    ambiguousApiCards,
    suspiciousMappings,
    latestSourceUpdatedAt,
    acceptedMarketCoveragePercentage: packDexCardCount ? Number((acceptedMarkets * 100 / packDexCardCount).toFixed(2)) : 0,
    identityCoveragePercentage: packDexCardCount ? Number((matchedAppIds.size * 100 / packDexCardCount).toFixed(2)) : 0,
    apiErrors,
  };
}
