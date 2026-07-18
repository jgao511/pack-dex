import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "src", "data", "explore");
const endpoint = "https://graphql.pokeapi.co/v1beta2";
const force = process.argv.includes("--force");
const pokemonPath = path.join(outputDirectory, "pokemon.json");

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function cleanText(value) {
  return String(value || "").replace(/[\n\f\r]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  return String(value || "")
    .split("-")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function normalizedAlias(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[♀]/g, " female ")
    .replace(/[♂]/g, " male ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

const query = `query PackDexExploreSpecies {
  pokemonspecies(limit: 2000, order_by: {id: asc}) {
    id
    name
    generation_id
    evolves_from_species_id
    evolution_chain_id
    pokemonspeciesnames(where: {language_id: {_eq: 9}}) { name genus }
    pokemonspeciesflavortexts(where: {language_id: {_eq: 9}}, order_by: {version_id: desc}, limit: 1) { flavor_text }
    pokemons(order_by: {id: asc}) {
      id
      name
      is_default
      height
      weight
      pokemontypes(order_by: {slot: asc}) { type { name } }
      pokemonabilities(order_by: {slot: asc}) { is_hidden ability { name } }
    }
  }
}`;

if (!force && await exists(pokemonPath)) {
  console.log("Explore data already exists. Pass --force to refresh it from PokéAPI.");
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": "PackDex Explore data generator" },
  body: JSON.stringify({ query }),
});

if (!response.ok) throw new Error(`PokéAPI request failed (${response.status}).`);
const payload = await response.json();
if (payload.errors?.length) throw new Error(`PokéAPI GraphQL error: ${payload.errors[0].message}`);

const sourceSpecies = payload.data?.pokemonspecies || [];
if (sourceSpecies.length < 1000) throw new Error(`PokéAPI returned only ${sourceSpecies.length} species; refusing to replace valid generated data.`);

const pokemon = sourceSpecies.map((species) => {
  const localized = species.pokemonspeciesnames?.[0] || {};
  const primary = species.pokemons.find((entry) => entry.is_default) || species.pokemons[0] || {};
  return {
    id: species.id,
    name: species.name,
    displayName: localized.name || titleCase(species.name),
    generation: species.generation_id,
    types: (primary.pokemontypes || []).map((entry) => entry.type?.name).filter(Boolean),
    heightDm: primary.height || null,
    weightHg: primary.weight || null,
    genus: localized.genus || "",
    abilities: (primary.pokemonabilities || []).map((entry) => ({ name: titleCase(entry.ability?.name), hidden: Boolean(entry.is_hidden) })).filter((entry) => entry.name),
    flavorText: cleanText(species.pokemonspeciesflavortexts?.[0]?.flavor_text),
    artworkUrl: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${species.id}.png`,
    evolutionChainId: species.evolution_chain_id,
    evolvesFromId: species.evolves_from_species_id || null,
    forms: species.pokemons.map((entry) => entry.name).filter((name) => name !== species.name),
  };
});

const aliases = {};
for (const species of pokemon) {
  const candidates = [species.name, species.displayName, ...species.forms];
  for (const candidate of candidates) {
    const key = normalizedAlias(candidate);
    if (key && !aliases[key]) aliases[key] = species.id;
  }
}

Object.assign(aliases, {
  "mr mime": 122,
  "mime jr": 439,
  "mr rime": 866,
  "farfetchd": 83,
  "sirfetchd": 865,
  "nidoran female": 29,
  "nidoran f": 29,
  "nidoran male": 32,
  "nidoran m": 32,
  "type null": 772,
  "ho oh": 250,
  "porygon z": 474,
  "flabebe": 669,
});

const chainsById = new Map();
for (const species of pokemon) {
  const chain = chainsById.get(species.evolutionChainId) || { id: species.evolutionChainId, species: [] };
  chain.species.push({ id: species.id, evolvesFromId: species.evolvesFromId });
  chainsById.set(species.evolutionChainId, chain);
}

await mkdir(outputDirectory, { recursive: true });
const outputs = {
  "pokemon.json": pokemon,
  "pokemonAliases.json": aliases,
  "evolutionChains.json": [...chainsById.values()].sort((a, b) => a.id - b.id),
  "exploreMetadata.json": {
    generatedAt: new Date().toISOString(),
    source: "PokéAPI GraphQL v1beta2",
    sourceUrl: endpoint,
    sourceLicense: "PokéAPI project: BSD-3-Clause; Pokémon names and characters are trademarks of Nintendo.",
    speciesCount: pokemon.length,
    fields: ["identity", "types", "generation", "height", "weight", "genus", "abilities", "evolution relationships", "one English flavor text", "official artwork reference", "form aliases"],
  },
};

for (const [fileName, data] of Object.entries(outputs)) {
  await writeFile(path.join(outputDirectory, fileName), `${JSON.stringify(data)}\n`, "utf8");
}

const byteTotal = (await Promise.all(Object.keys(outputs).map((fileName) => stat(path.join(outputDirectory, fileName))))).reduce((sum, file) => sum + file.size, 0);
console.log(`Generated ${pokemon.length} Pokémon species and ${chainsById.size} evolution chains (${byteTotal.toLocaleString()} bytes).`);
