import pokemon from "../data/explore/pokemon.json" with { type: "json" };
import pokemonAliases from "../data/explore/pokemonAliases.json" with { type: "json" };
import eraGuides from "../data/explore/eraGuides.json" with { type: "json" };
import setGuides from "../data/explore/setGuides.json" with { type: "json" };
import { getPullableCollectionCards } from "../utils/collectionStorage.js";
import { GOD_PACK_CONFIG } from "../utils/packGenerator.js";
import { compareCardsByRarity } from "../utils/rarityRank.js";
import {
  createSpeciesLookup,
  mapCardNameToSpeciesIds,
} from "../../mobile-app/src/explore/exploreNormalization.js";

const speciesById = new Map(pokemon.map((species) => [species.id, species]));
const speciesLookup = createSpeciesLookup(pokemon, pokemonAliases);

function buildCatalogEntries(set) {
  return getPullableCollectionCards(set).map((card) => ({
    set,
    card,
    speciesIds: mapCardNameToSpeciesIds(card.name, speciesLookup),
  }));
}

/**
 * Shared collector-facing set details used by both mobile Explore and public set pages.
 * All editorial copy comes from the audited Explore guides; featured items follow the
 * same deterministic catalog ranking used by the mobile set-detail experience.
 */
export function getSetExploreDetails(set, {
  catalogEntries,
  featuredCardLimit = 8,
  featuredPokemonLimit = 8,
} = {}) {
  if (!set) {
    return {
      guide: {},
      eraGuide: {},
      cardEntries: [],
      featuredCards: [],
      featuredPokemon: [],
      specialFeature: "",
    };
  }

  const entries = Array.isArray(catalogEntries)
    ? catalogEntries.filter((entry) => entry?.set?.id === set.id)
    : buildCatalogEntries(set);
  const guide = setGuides[set.id] || {};
  const speciesCounts = new Map();

  for (const entry of entries) {
    for (const speciesId of entry.speciesIds || []) {
      speciesCounts.set(speciesId, (speciesCounts.get(speciesId) || 0) + 1);
    }
  }

  const rankedFeaturedPokemon = [...speciesCounts.entries()]
    .map(([speciesId, count]) => ({ species: speciesById.get(speciesId), count }))
    .filter((entry) => entry.species)
    .sort((left, right) => right.count - left.count || left.species.id - right.species.id);
  const curatedFeaturedPokemon = (guide.featuredPokemonIds || [])
    .map((speciesId) => ({
      species: speciesById.get(Number(speciesId)),
      count: speciesCounts.get(Number(speciesId)) || 0,
    }))
    .filter((entry) => entry.species);
  const featuredPokemon = (curatedFeaturedPokemon.length
    ? curatedFeaturedPokemon
    : rankedFeaturedPokemon
  ).slice(0, featuredPokemonLimit);
  const featuredCards = [...entries]
    .sort((left, right) => compareCardsByRarity(left.card, right.card, set, set))
    .slice(0, featuredCardLimit);
  const specialConfig = GOD_PACK_CONFIG[set.id];

  return {
    guide,
    eraGuide: eraGuides[set.era] || {},
    cardEntries: entries,
    featuredCards,
    featuredPokemon,
    specialFeature: specialConfig?.enabled
      ? `Special PackDex feature: ${set.name} supports a rare ${specialConfig.displayName} virtual opening.`
      : "",
  };
}
