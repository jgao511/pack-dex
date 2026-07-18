import { mkdir, writeFile } from "node:fs/promises";
import { sets } from "../src/data/sets.js";
import { getPullableCollectionCards } from "../src/utils/collectionStorage.js";

const OUTPUT_DIR = new URL("../src/data/explore/", import.meta.url);
const AUDIT_FILE = new URL("../docs/explore-editorial-audit.json", import.meta.url);
const STRUCTURED_SOURCE = "https://github.com/PokemonTCG/pokemon-tcg-data";
const OFFICIAL_EXPANSIONS_SOURCE = "https://www.pokemon.com/us/pokemon-tcg/trading-card-expansions";

const ERA_GUIDES = {
  "Pokemon 30th Anniversary": {
    summary: "A PackDex-created preview collection assembled from cards announced for Pokémon's 30th-anniversary period. It is not presented as an official standalone expansion.",
    identity: "PackDex preview",
    mechanics: [],
    representativePokemonIds: [25, 6, 150],
    changeNote: "This entry is separated from official expansion eras so preview content is not confused with an official set history.",
    custom: true,
  },
  "Wizards Vintage": {
    summary: "PackDex's earliest English-language catalog, spanning Base Set through the Gym expansions published by Wizards of the Coast.",
    identity: "Original card frames, early holographic rares, and the first Kanto-focused English sets.",
    mechanics: ["Original evolution-card structure", "Dark Pokémon", "Owner's Pokémon"],
    representativePokemonIds: [25, 6, 150],
    changeNote: "This is the starting point for PackDex's supported English catalog.",
  },
  Neo: {
    summary: "The Neo expansions brought Johto Pokémon into the English TCG and expanded the early card pool beyond Kanto.",
    identity: "Johto species, Baby Pokémon, and new Darkness and Metal themes.",
    mechanics: ["Baby Pokémon", "Darkness Energy", "Metal Energy", "Shining Pokémon"],
    representativePokemonIds: [249, 250, 251],
    changeNote: "Neo broadened the catalog around the second Pokémon generation.",
  },
  "e-Card / Late WOTC": {
    summary: "The final Wizards-era portion of PackDex combines Legendary Collection with the Expedition, Aquapolis, and Skyridge e-Card expansions.",
    identity: "e-Reader-compatible card layouts alongside a late-era reprint collection.",
    mechanics: ["e-Reader dot-code strips", "Crystal Pokémon"],
    representativePokemonIds: [6, 25, 144],
    changeNote: "The e-Card expansions adopted a visibly different frame and e-Reader integration.",
  },
  EX: {
    summary: "The EX era follows the Hoenn period and a long run of themed expansions from EX Ruby & Sapphire through EX Power Keepers.",
    identity: "Pokémon-ex, Hoenn settings, and later specialized themes such as Delta Species.",
    mechanics: ["Pokémon-ex", "Pokémon ☆", "δ Delta Species"],
    representativePokemonIds: [382, 383, 384],
    changeNote: "Pokémon-ex became a defining multi-Prize mechanic; later subsets emphasized experimental species treatments.",
  },
  "Diamond & Pearl": {
    summary: "The Diamond & Pearl expansions introduced Sinnoh Pokémon to the supported TCG catalog.",
    identity: "Sinnoh species and Pokémon LV.X cards.",
    mechanics: ["Pokémon LV.X"],
    representativePokemonIds: [483, 484, 487],
    changeNote: "The card frame and high-rarity progression shifted from the EX era toward Pokémon LV.X.",
  },
  Platinum: {
    summary: "The Platinum series continued the Sinnoh period with Team Galactic and other trainer-associated Pokémon themes.",
    identity: "Pokémon SP and continued Pokémon LV.X support.",
    mechanics: ["Pokémon SP", "Pokémon LV.X"],
    representativePokemonIds: [487, 492, 493],
    changeNote: "Pokémon SP expanded the use of owner- and team-associated Pokémon cards.",
  },
  "HeartGold & SoulSilver": {
    summary: "This series revisited Johto across four HeartGold & SoulSilver expansions and Call of Legends.",
    identity: "Johto artwork, Pokémon Prime, and paired LEGEND cards.",
    mechanics: ["Pokémon Prime", "Pokémon LEGEND"],
    representativePokemonIds: [249, 250, 245],
    changeNote: "Prime and two-card LEGEND designs replaced the prior era's LV.X emphasis.",
  },
  "Black & White": {
    summary: "The Black & White series centers the Unova generation and later includes the Team Plasma sequence.",
    identity: "Unova species, full-card artwork, Pokémon-EX, and later Team Plasma cards.",
    mechanics: ["Pokémon-EX", "ACE SPEC", "Team Plasma"],
    representativePokemonIds: [643, 644, 646],
    changeNote: "Pokémon-EX returned as a distinct uppercase mechanic during the series; ACE SPEC cards appeared later in the era.",
  },
  XY: {
    summary: "The XY series covers Kalos and the TCG's first sustained focus on Mega Evolution Pokémon-EX.",
    identity: "Kalos species, Pokémon-EX, Mega Evolution Pokémon-EX, and later Pokémon BREAK.",
    mechanics: ["Pokémon-EX", "Mega Evolution Pokémon-EX", "Pokémon BREAK"],
    representativePokemonIds: [716, 717, 718],
    changeNote: "Mega Evolution became prominent early in the series; Pokémon BREAK arrived later rather than at the series debut.",
  },
  "Sun & Moon": {
    summary: "The Sun & Moon series follows Alola from the first Pokémon-GX sets through later TAG TEAM expansions.",
    identity: "Alolan Pokémon, Pokémon-GX, Prism Star cards, and later TAG TEAM Pokémon-GX.",
    mechanics: ["Pokémon-GX", "Prism Star", "TAG TEAM Pokémon-GX"],
    representativePokemonIds: [791, 792, 800],
    changeNote: "Pokémon-GX defined the series; Prism Star and TAG TEAM cards were added in later expansions.",
  },
  "Sword & Shield": {
    summary: "The Sword & Shield series spans Galar-focused expansions and later sets tied to Hisui and gallery-style subsets.",
    identity: "Pokémon V and VMAX, later Pokémon VSTAR, Battle Styles, and illustrated gallery subsets.",
    mechanics: ["Pokémon V", "Pokémon VMAX", "Pokémon VSTAR", "Battle Styles", "Trainer Gallery"],
    representativePokemonIds: [888, 889, 890],
    changeNote: "Pokémon V and VMAX led the series; VSTAR and named gallery subsets appeared later.",
  },
  "Scarlet & Violet": {
    summary: "The Scarlet & Violet series introduces Paldea to the supported catalog and returns Pokémon ex with a lowercase suffix.",
    identity: "Paldean Pokémon, Tera Pokémon ex, illustration rarities, and the later return of ACE SPEC cards.",
    mechanics: ["Pokémon ex", "Tera Pokémon ex", "Illustration Rare", "ACE SPEC"],
    representativePokemonIds: [1007, 1008, 1017],
    changeNote: "Pokémon ex returned at the series launch; ACE SPEC cards returned later in Temporal Forces.",
  },
  "Mega Evolution": {
    summary: "The Mega Evolution series renews the TCG's focus on Mega Evolution Pokémon ex while continuing modern illustration rarities.",
    identity: "Mega Evolution Pokémon ex and contemporary special-art rarity structures.",
    mechanics: ["Mega Evolution Pokémon ex", "Pokémon ex", "Illustration Rare"],
    representativePokemonIds: [6, 282, 448],
    changeNote: "Mega Evolution returns as a central series identity with the modern lowercase Pokémon ex convention.",
  },
};

const THEMES = {
  "base-set": ["Original Kanto card pool"], jungle: ["Forest and jungle Pokémon"], fossil: ["Fossil Pokémon"],
  "team-rocket": ["Team Rocket", "Dark Pokémon"], "gym-heroes": ["Kanto Gym Leaders"], "gym-challenge": ["Kanto Gym Leaders"],
  "neo-genesis": ["Johto debut"], "neo-destiny": ["Light and Dark Pokémon"], "legendary-collection": ["Early-series reprints"],
  "ex-team-magma-vs-team-aqua": ["Team Magma and Team Aqua"], "ex-delta-species": ["Holon", "Delta Species"],
  "platinum-arceus": ["Arceus"], "black-white-plasma-storm": ["Team Plasma"], "black-white-plasma-freeze": ["Team Plasma"], "black-white-plasma-blast": ["Team Plasma"],
  dc1: ["Team Magma and Team Aqua"], g1: ["Pokémon 20th anniversary"], xy12: ["Base Set-inspired presentation"],
  "detective-pikachu": ["POKÉMON Detective Pikachu film"], "hidden-fates": ["Shiny Pokémon"], "pokemon-go": ["Pokémon GO crossover"],
  celebrations: ["Pokémon 25th anniversary"], "battle-styles": ["Single Strike and Rapid Strike"], 151: ["Original 151 Pokémon"],
  "paldean-fates": ["Shiny Pokémon"], "prismatic-evolutions": ["Eevee and its Evolutions"], "journey-together": ["Trainer's Pokémon"],
  "destined-rivals": ["Trainer's Pokémon", "Team Rocket"], "black-bolt": ["Unova", "Black-themed counterpart"], "white-flare": ["Unova", "White-themed counterpart"],
  "pitch-black": ["Mega Darkrai ex", "Mega Evolution Pokémon ex"],
  "30th-anniversary": ["PackDex preview", "30th-anniversary selection"],
};

const FACTS = {
  "base-set": ["Base Set is the first expansion in PackDex's supported English catalog."],
  g1: ["Generations includes the second Radiant Collection subset."],
  celebrations: ["Celebrations includes a Classic Collection that revisits cards from earlier TCG eras."],
  151: ["The main set follows National Pokédex order across the original 151 Pokémon."],
  "battle-styles": ["Single Strike and Rapid Strike cards were introduced in this expansion."],
  "temporal-forces": ["ACE SPEC cards returned to English expansions in Temporal Forces."],
  "black-bolt": ["Black Bolt and White Flare share the same English release date and split their Unova focus across two sets."],
  "white-flare": ["White Flare and Black Bolt share the same English release date and split their Unova focus across two sets."],
  "pitch-black": ["Pitch Black's supported catalog contains 120 cards, including Mega Darkrai ex as its Mega Hyper Rare."],
  "30th-anniversary": ["PackDex labels this as a preview compilation, not an official standalone expansion."],
};

const FEATURED_POKEMON_IDS = {
  "pitch-black": [491, 609, 807],
};

const MECHANIC_SET_IDS = {
  "Pokémon-ex": sets.filter((set) => set.era === "EX").map((set) => set.id),
  "Pokémon LV.X": sets.filter((set) => ["Diamond & Pearl", "Platinum"].includes(set.era)).map((set) => set.id),
  "Pokémon SP": sets.filter((set) => set.era === "Platinum").map((set) => set.id),
  "Pokémon Prime": ["heartgold-soulsilver", "hs-unleashed", "hs-undaunted", "hs-triumphant"],
  "Pokémon LEGEND": ["heartgold-soulsilver", "hs-unleashed", "hs-undaunted", "hs-triumphant"],
  "Pokémon-EX": sets.filter((set) => set.era === "Black & White" && String(set.releaseDate) >= "2012-02-08").map((set) => set.id),
  "ACE SPEC": sets.filter((set) => set.era === "Black & White" && String(set.releaseDate) >= "2012-11-07").map((set) => set.id)
    .concat(sets.filter((set) => set.era === "Scarlet & Violet" && String(set.releaseDate) >= "2024-03-22").map((set) => set.id)),
  "Mega Evolution Pokémon-EX": sets.filter((set) => set.era === "XY" && !["xy0", "g1"].includes(set.id)).map((set) => set.id),
  "Pokémon BREAK": ["xy8", "xy9", "xy10", "xy11"],
  "Pokémon-GX": sets.filter((set) => set.era === "Sun & Moon" && set.id !== "detective-pikachu").map((set) => set.id),
  "TAG TEAM Pokémon-GX": ["team-up", "unbroken-bonds", "unified-minds", "cosmic-eclipse"],
  "Pokémon V / VMAX": sets.filter((set) => set.era === "Sword & Shield").map((set) => set.id),
  "Pokémon VSTAR": ["brilliant-stars", "astral-radiance", "pokemon-go", "lost-origin", "silver-tempest", "crown-zenith"],
  "Trainer Gallery": ["brilliant-stars", "astral-radiance", "lost-origin", "silver-tempest"],
  "Pokémon ex": sets.filter((set) => set.era === "Scarlet & Violet").map((set) => set.id),
  "Mega Evolution Pokémon ex": sets.filter((set) => set.era === "Mega Evolution").map((set) => set.id),
};

function mechanicsFor(set) {
  return Object.entries(MECHANIC_SET_IDS).filter(([, ids]) => ids.includes(set.id)).map(([name]) => name);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function guideFor(set) {
  const total = getPullableCollectionCards(set).length;
  const isCustom = set.id === "30th-anniversary";
  return {
    setId: set.id,
    summary: isCustom
      ? `A PackDex-created preview containing ${total} currently supported cards selected from announced 30th-anniversary material. It is not labeled as an official standalone expansion.`
      : `${set.name} is a PackDex-supported ${set.era} expansion released on ${formatDate(set.releaseDate)}. The local catalog currently tracks ${total} supported cards.`,
    themes: THEMES[set.id] || [],
    mechanics: mechanicsFor(set),
    ...(FEATURED_POKEMON_IDS[set.id] ? { featuredPokemonIds: FEATURED_POKEMON_IDS[set.id] } : {}),
    funFacts: FACTS[set.id] || [],
    custom: isCustom,
    contentStatus: (THEMES[set.id]?.length || FACTS[set.id]?.length) ? "curated" : "limited",
  };
}

await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(new URL("../docs/", import.meta.url), { recursive: true });
const setGuides = Object.fromEntries(sets.map((set) => [set.id, guideFor(set)]));
await writeFile(new URL("setGuides.json", OUTPUT_DIR), `${JSON.stringify(setGuides)}\n`);
await writeFile(new URL("eraGuides.json", OUTPUT_DIR), `${JSON.stringify(ERA_GUIDES)}\n`);

const audit = {
  generatedAt: new Date().toISOString(),
  policy: {
    runtimeSourceNotesExcluded: true,
    uncertainClaims: "Omitted rather than inferred from card names or algorithmic frequency.",
    officialExpansionSource: OFFICIAL_EXPANSIONS_SOURCE,
    structuredCatalogSource: STRUCTURED_SOURCE,
  },
  eras: Object.keys(ERA_GUIDES).map((era) => ({
    era,
    sources: [OFFICIAL_EXPANSIONS_SOURCE, STRUCTURED_SOURCE, "src/data/sets.js"],
    custom: Boolean(ERA_GUIDES[era].custom),
  })),
  sets: sets.map((set) => {
    const guide = setGuides[set.id];
    return {
      setId: set.id,
      status: guide.contentStatus,
      custom: guide.custom,
      sourceNotes: [
        { field: "identity, release date, era, supported count", source: "src/data/sets.js and its imported catalog data" },
        { field: "structured set identity", source: set.pokemonTcgApiSetId ? `https://api.pokemontcg.io/v2/sets/${set.pokemonTcgApiSetId}` : STRUCTURED_SOURCE },
        { field: "editorial mechanics and themes", source: guide.custom ? "src/data/special-sets/30th-anniversary/30thAnniversarySet.js" : OFFICIAL_EXPANSIONS_SOURCE },
      ],
      limitedReason: guide.contentStatus === "limited" ? "No additional set-specific claim was included without a dependable curated source; identity, date, era, and supported count remain complete." : "",
    };
  }),
};
await writeFile(AUDIT_FILE, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`Generated ${sets.length} set guides, ${Object.keys(ERA_GUIDES).length} era guides, and the editorial audit.`);
