import pokemon from "../../../src/data/explore/pokemon.json" with { type: "json" };
import pokemonAliases from "../../../src/data/explore/pokemonAliases.json" with { type: "json" };
import evolutionChains from "../../../src/data/explore/evolutionChains.json" with { type: "json" };
import eraGuides from "../../../src/data/explore/eraGuides.json" with { type: "json" };
import setGuides from "../../../src/data/explore/setGuides.json" with { type: "json" };
import { sets } from "../../../src/data/sets.js";
import { getCardCollectionKey, getPullableCollectionCards, getSetCollectionProgress } from "../../../src/utils/collectionStorage.js";
import { createSpeciesLookup, getUniqueOwnershipProgress, mapCardNameToSpeciesIds, normalizeExploreText } from "./exploreNormalization.js";

export const explorePokemon = pokemon;
export const speciesById = new Map(pokemon.map((species) => [species.id, species]));
export const speciesLookup = createSpeciesLookup(pokemon, pokemonAliases);
export const evolutionChainById = new Map(evolutionChains.map((chain) => [chain.id, chain]));

export const exploreSets = [...sets].sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")) || a.name.localeCompare(b.name));
export const setById = new Map(sets.map((set) => [set.id, set]));

export const catalogCards = [];
export const pokemonCatalogCards = [];
export const cardsBySpeciesId = new Map();
for (const set of sets) {
  for (const card of getPullableCollectionCards(set)) {
    const speciesIds = mapCardNameToSpeciesIds(card.name, speciesLookup);
    const category = speciesIds.length > 0
      ? "Pokémon"
      : /\benergy\b/i.test(card.name)
        ? "Energy"
        : "Trainer";
    const entry = {
      set,
      card,
      speciesIds,
      category,
      searchText: normalizeExploreText(`${card.name} ${card.number} ${set.name} ${set.era} ${card.rarity || ""} ${category}`),
    };
    catalogCards.push(entry);
    if (speciesIds.length > 0) pokemonCatalogCards.push(entry);
    for (const speciesId of speciesIds) {
      const cards = cardsBySpeciesId.get(speciesId) || [];
      cards.push(entry);
      cardsBySpeciesId.set(speciesId, cards);
    }
  }
}

const eras = new Map();
for (const set of sets) {
  const entry = eras.get(set.era) || { id: normalizeExploreText(set.era).replace(/\s+/g, "-"), name: set.era, sets: [] };
  entry.sets.push(set);
  eras.set(set.era, entry);
}

export const exploreEras = [...eras.values()]
  .map((era) => {
    era.sets.sort((a, b) => String(a.releaseDate || "").localeCompare(String(b.releaseDate || "")) || a.name.localeCompare(b.name));
    const years = era.sets.map((set) => Number(String(set.releaseDate || "").slice(0, 4))).filter(Number.isFinite);
    const firstYear = years.length ? Math.min(...years) : null;
    const lastYear = years.length ? Math.max(...years) : null;
    return { ...era, dateRange: firstYear ? `${firstYear}${lastYear && lastYear !== firstYear ? `–${lastYear}` : ""}` : "", ...(eraGuides[era.name] || {}) };
  })
  .sort((a, b) => String(b.sets.at(-1)?.releaseDate || "").localeCompare(String(a.sets.at(-1)?.releaseDate || "")));
export const eraById = new Map(exploreEras.map((era) => [era.id, era]));

export function getSpeciesCards(speciesId) {
  return cardsBySpeciesId.get(Number(speciesId)) || [];
}

export function getSpeciesProgress(speciesId, collection) {
  return getUniqueOwnershipProgress(getSpeciesCards(speciesId), collection, getCardCollectionKey);
}

export function getEraProgress(era, collection) {
  const progress = (era?.sets || []).map((set) => getSetCollectionProgress(collection, set));
  const owned = progress.reduce((sum, item) => sum + item.collected, 0);
  const total = progress.reduce((sum, item) => sum + item.total, 0);
  return { owned, total, missing: Math.max(0, total - owned), percent: total ? Math.round((owned / total) * 100) : 0 };
}

export function getSetGuide(setId) {
  return setGuides[setId] || {};
}

export function groupedExploreSearch(query, limit = 8) {
  const normalized = normalizeExploreText(query);
  if (!normalized) return { pokemon: [], sets: [], eras: [], cards: [] };
  const score = (value) => value === normalized ? 0 : value.startsWith(normalized) ? 1 : value.includes(normalized) ? 2 : 99;
  const rank = (items, getText) => items
    .map((item) => ({ item, score: Math.min(...getText(item).map((text) => score(normalizeExploreText(text)))) }))
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || String(getText(a.item)[0]).localeCompare(String(getText(b.item)[0])))
    .slice(0, limit)
    .map((entry) => entry.item);
  const aliasId = speciesLookup.get(normalized);
  const pokemonResults = rank(pokemon, (species) => [species.displayName, species.name, ...(species.forms || [])]);
  if (aliasId && !pokemonResults.some((species) => species.id === aliasId)) pokemonResults.unshift(speciesById.get(aliasId));
  return {
    pokemon: pokemonResults.slice(0, limit),
    sets: rank(exploreSets, (set) => [set.name, set.id]).slice(0, limit),
    eras: rank(exploreEras, (era) => [era.name, era.id]).slice(0, limit),
    cards: pokemonCatalogCards.filter((entry) => normalized.split(" ").every((token) => entry.searchText.includes(token))).slice(0, limit),
  };
}

export function searchCollectionCatalog(query, limit = 80) {
  const normalized = normalizeExploreText(query);
  if (!normalized) return [];
  const queryVariants = [...new Set([normalized, normalized.replace(/\b([a-z]+)s\b/g, "$1 s")])];
  return catalogCards
    .filter((entry) => queryVariants.some((variant) => variant.split(" ").filter(Boolean).every((token) => entry.searchText.includes(token))))
    .map((entry) => {
      const name = normalizeExploreText(entry.card.name);
      const setName = normalizeExploreText(entry.set.name);
      const number = normalizeExploreText(entry.card.number);
      const rank = name === normalized ? 0
        : number === normalized ? 1
          : name.startsWith(normalized) ? 2
            : setName === normalized ? 3
              : name.includes(normalized) ? 4
                : 5;
      return { ...entry, rank };
    })
    .sort((a, b) => a.rank - b.rank
      || a.card.name.localeCompare(b.card.name)
      || String(b.set.releaseDate || "").localeCompare(String(a.set.releaseDate || ""))
      || String(a.card.number).localeCompare(String(b.card.number), undefined, { numeric: true }))
    .slice(0, limit);
}

export function getDailySpotlights(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  const supportedPokemon = pokemon.filter((species) => getSpeciesCards(species.id).length > 0);
  const supportedSets = exploreSets.filter((set) => getSetGuide(set.id).summary);
  const supportedEras = exploreEras.filter((era) => era.summary);
  return {
    pokemon: supportedPokemon[day % supportedPokemon.length],
    set: supportedSets[day % supportedSets.length],
    era: supportedEras[day % supportedEras.length],
  };
}

const verifiedFacts = [
  ...Object.values(setGuides).flatMap((guide) => (guide.funFacts || []).map((text) => ({ text, kind: "set", id: guide.setId }))),
  ...exploreEras.filter((era) => era.changeNote).map((era) => ({ text: era.changeNote, kind: "era", id: era.id })),
];

export function getDailyFact(date = new Date()) {
  if (!verifiedFacts.length) return null;
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  return verifiedFacts[day % verifiedFacts.length];
}
