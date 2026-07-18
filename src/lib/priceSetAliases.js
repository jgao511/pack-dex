export const PRICE_SET_ALIASES = {
  "mega-evolution": {
    pokemonTcgApiSetId: "me1",
    tcgplayerSetSlug: "me01-mega-evolution",
  },
  "phantasmal-flames": {
    pokemonTcgApiSetId: "me2",
    tcgplayerSetSlug: "me02-phantasmal-flames",
  },
  "ascended-heroes": {
    pokemonTcgApiSetId: "me2pt5",
    tcgplayerSetSlug: "me-ascended-heroes",
  },
  "perfect-order": {
    pokemonTcgApiSetId: "me3",
    tcgplayerSetSlug: "me03-perfect-order",
  },
  "chaos-rising": {
    pokemonTcgApiSetId: "me4",
    tcgplayerSetSlug: "me04-chaos-rising",
  },
  "pitch-black": {
    pokemonTcgApiSetId: "me5",
  },
};

export function getPriceSetAlias(packDexSetId) {
  return PRICE_SET_ALIASES[packDexSetId] || null;
}
