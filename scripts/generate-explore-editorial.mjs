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

// Concise set identities are curated from official expansion pages/checklists and the
// structured set records cited in docs/explore-editorial-audit.json. Keep this map
// explicit: runtime copy must never be inferred from card-name frequency.
const SET_IDENTITIES = {
  "151": "the original 151 Pokémon in National Pokédex order, supported by modern Pokémon ex and illustration rarities",
  "base-set": "the original English Kanto card pool and the TCG's foundational presentation",
  jungle: "Pokémon associated with forests, grasslands, and other wild habitats",
  fossil: "revived Fossil Pokémon alongside ancient and legendary species",
  "base-set-2": "a combined selection of cards first printed in Base Set and Jungle",
  "team-rocket": "Team Rocket and the debut of Dark Pokémon in the English TCG",
  "gym-heroes": "Kanto Gym Leaders and Pokémon identified with their Trainers",
  "gym-challenge": "the later Kanto Gym Leaders and their Trainer-owned Pokémon",
  "neo-genesis": "the English TCG debut of Johto Pokémon, Baby Pokémon, and Darkness and Metal Energy",
  "neo-discovery": "the Ruins of Alph, Unown, and newly discovered Johto Pokémon",
  "neo-revelation": "Johto's Legendary Pokémon and the first Shining Pokémon cards",
  "neo-destiny": "Light Pokémon, Dark Pokémon, and a larger group of Shining Pokémon",
  "legendary-collection": "reprints from the early English sets with a distinctive fireworks reverse-holo treatment",
  "expedition-base-set": "the e-Reader card layout and a broad mix of Kanto and Johto Pokémon",
  aquapolis: "e-Reader-compatible cards, underwater imagery, and Crystal Pokémon",
  skyridge: "the final English e-Card expansion and its Crystal Pokémon",
  "ex-ruby-sapphire": "Hoenn's first partner Pokémon and the English debut of Pokémon-ex",
  "ex-sandstorm": "desert, Fossil, and Hoenn Pokémon led by the evolving Aron and Trapinch families",
  "ex-dragon": "Dragon Pokémon and related species from several generations",
  "ex-team-magma-vs-team-aqua": "the rivalry between Team Magma and Team Aqua and their owned Pokémon",
  "ex-hidden-legends": "Hoenn legends and ancient Pokémon, including the Regi trio",
  "ex-firered-leafgreen": "the Kanto journey revisited through FireRed and LeafGreen",
  "ex-team-rocket-returns": "Team Rocket's return through Dark Pokémon and Rocket's Pokémon-ex",
  "ex-deoxys": "Deoxys, Rayquaza, and the space-themed conflict surrounding them",
  "ex-emerald": "the Hoenn region as presented in Pokémon Emerald, including its first partners and legends",
  "ex-unseen-forces": "Unown, Lugia, Ho-Oh, and Pokémon tied to unseen powers",
  "ex-delta-species": "the Holon research setting and Pokémon with unusual δ Delta Species types",
  "ex-legend-maker": "legendary and ancient Pokémon presented alongside new Pokémon-ex",
  "ex-holon-phantoms": "Holon's mysterious mirages and another large group of δ Delta Species Pokémon",
  "ex-crystal-guardians": "a tropical island setting with Crystal Guardians and δ Delta Species Pokémon",
  "ex-dragon-frontiers": "Dragon-themed frontiers populated by δ Delta Species Pokémon",
  "ex-power-keepers": "powerful Hoenn Pokémon and the final English expansion of the Pokémon-ex era",
  "diamond-pearl": "the English TCG debut of Sinnoh Pokémon and Pokémon LV.X",
  "diamond-pearl-mysterious-treasures": "Sinnoh's legendary Pokémon and treasures linked to the region's myths",
  "diamond-pearl-secret-wonders": "a broad Sinnoh roster joined by powerful legendary Pokémon",
  "diamond-pearl-great-encounters": "legendary encounters involving Dialga, Palkia, Darkrai, and Cresselia",
  "diamond-pearl-majestic-dawn": "Eevee's Evolutions and prominent Sinnoh Pokémon",
  "diamond-pearl-legends-awakened": "Sinnoh's Lake Guardians and other awakened legendary Pokémon",
  "diamond-pearl-stormfront": "a gathering storm around Sinnoh Pokémon, Pokémon LV.X, and classic-card reinterpretations",
  platinum: "Giratina, the Distortion World, and the debut of Pokémon SP",
  "platinum-rising-rivals": "rival Trainers, Gym Leaders, and Frontier Brains represented through Pokémon SP",
  "platinum-supreme-victors": "Champion and villain-associated Pokémon SP alongside powerful Pokémon LV.X",
  "platinum-arceus": "Arceus cards spanning multiple types and the final Platinum-series expansion",
  "heartgold-soulsilver": "a return to Johto with Pokémon Prime and two-card Pokémon LEGEND",
  "hs-unleashed": "Johto legends including Entei, Raikou, and Suicune in Prime and LEGEND-era designs",
  "hs-undaunted": "Darkness- and Metal-themed Johto Pokémon with Pokémon Prime and LEGEND cards",
  "hs-triumphant": "the climax of the HeartGold & SoulSilver block with new Prime and LEGEND pairings",
  "call-of-legends": "legendary Pokémon, Shiny Pokémon, and Energy cards with dedicated Pokémon artwork",
  "black-white": "the English TCG debut of Unova Pokémon and the era's new card frame",
  "black-white-emerging-powers": "Unova Pokémon beginning to reveal their strength after the base expansion",
  "black-white-noble-victories": "Victini, the Unova first partners' final Evolutions, and other Unova legends",
  "black-white-next-destinies": "Mewtwo-EX and the return of multi-Prize Pokémon-EX",
  "black-white-dark-explorers": "Darkness-type Pokémon and Darkrai-EX leading a shadowed Unova roster",
  "black-white-dragons-exalted": "Dragon-type Pokémon making their English TCG debut as a dedicated type",
  "dragon-vault": "an all-Dragon mini expansion built around Dragon-type Pokémon",
  "black-white-boundaries-crossed": "Pokémon-EX and the English debut of ACE SPEC Trainer cards",
  "black-white-plasma-storm": "Team Plasma cards and their distinctive blue-bordered presentation",
  "black-white-plasma-freeze": "Team Plasma's frozen takeover led by Deoxys-EX and Thundurus-EX",
  "black-white-plasma-blast": "Genesect-EX, Team Plasma, and the final Team Plasma expansion",
  "black-white-legendary-treasures": "legendary Pokémon and the first Radiant Collection subset",
  xy0: "the Kalos first partners and introductory cards for the XY Series",
  xy1: "the English TCG debut of Kalos Pokémon, Fairy type, and Mega Evolution Pokémon-EX",
  xy2: "Charizard and Mega Charizard forms at the center of a Fire-heavy expansion",
  xy3: "Fighting-type Pokémon and Mega Lucario-EX in a battle-focused expansion",
  xy4: "the spirit-world theme of Mega Gengar-EX, Diancie-EX, and the debut of Pokémon Tool F cards",
  xy5: "Primal Groudon, Primal Kyogre, and Ancient Traits inspired by Hoenn",
  dc1: "the renewed conflict between Team Magma and Team Aqua in a compact special expansion",
  xy6: "Mega Rayquaza-EX and Dragon- and Sky-themed Pokémon from Hoenn",
  xy7: "Hoopa-EX, ancient Pokémon, and multiple Mega Evolution Pokémon-EX",
  xy8: "Mewtwo, Mega Mewtwo, and the English debut of Pokémon BREAK",
  xy9: "a fractured-world theme led by Gyarados, Greninja, and additional Pokémon BREAK",
  g1: "Pokémon's 20th anniversary, a Trainer's journey, and the second Radiant Collection",
  xy10: "Zygarde, Alakazam, and the legends connected to Kalos",
  xy11: "dual-type Shiny Pokémon and the conflict surrounding Volcanion and Magearna",
  xy12: "the original Base Set presentation reimagined for the XY Series",
  "sun-moon": "the English TCG debut of Alolan Pokémon and Pokémon-GX",
  "guardians-rising": "Alola's guardian deities, Island Challenge figures, and Pokémon-GX",
  "burning-shadows": "Necrozma, Marshadow, and Fire- and Darkness-themed Pokémon-GX",
  "shining-legends": "Shining Pokémon and legendary Pokémon in a compact special expansion",
  "crimson-invasion": "Ultra Beasts arriving in Alola alongside Silvally-GX",
  "ultra-prism": "the Ultra Prism story of Solgaleo, Lunala, Necrozma, and the debut of Prism Star cards",
  "forbidden-light": "Ultra Necrozma and the light-and-shadow conflict surrounding Kalos and Alola",
  "celestial-storm": "Rayquaza-GX, Hoenn favorites, and a storm of nature-themed Pokémon",
  "dragon-majesty": "Dragon Pokémon and legendary dragons in a special expansion",
  "lost-thunder": "Zeraora-GX, Lugia-GX, and Pokémon drawn from Alola and Johto",
  "team-up": "the debut of TAG TEAM Pokémon-GX pairs led by Pikachu & Zekrom-GX",
  "detective-pikachu": "Pokémon as they appear in the POKÉMON Detective Pikachu film",
  "unbroken-bonds": "partner bonds represented by TAG TEAM Pokémon-GX, including Reshiram & Charizard-GX",
  "unified-minds": "Mewtwo & Mew-GX and other TAG TEAM pairings built around shared power",
  "hidden-fates": "Shiny Pokémon in the Shiny Vault subset alongside Pokémon-GX",
  "cosmic-eclipse": "the finale of the Sun & Moon Series, with TAG TEAM Pokémon-GX and character cards",
  "sword-shield": "the English TCG debut of Galar Pokémon, Pokémon V, and Pokémon VMAX",
  "rebel-clash": "Galar's rebellious rivals and the Gigantamax forms of its first partners",
  "darkness-ablaze": "Eternatus VMAX and Charizard VMAX leading a Darkness- and Fire-tinged expansion",
  "champions-path": "the Galar Gym Challenge and its Champion-focused special expansion",
  "vivid-voltage": "Gigantamax Pikachu and the debut of Amazing Rare cards",
  "shining-fates": "Shiny Pokémon in the Shiny Vault alongside Pokémon V and VMAX",
  "battle-styles": "the debut of Single Strike and Rapid Strike cards",
  "chilling-reign": "Calyrex and the Galarian Legendary birds in the Crown Tundra",
  "evolving-skies": "Eevee's Evolutions and Dragon-type Pokémon V and VMAX",
  celebrations: "Pokémon's 25th anniversary and a Classic Collection revisiting historic cards",
  "fusion-strike": "the debut of Fusion Strike Style alongside Single Strike and Rapid Strike",
  "brilliant-stars": "Arceus VSTAR, the debut of Pokémon VSTAR, and the Trainer Gallery",
  "astral-radiance": "Hisuian Pokémon, Origin Forme legends, Radiant Pokémon, and the Trainer Gallery",
  "pokemon-go": "Pokémon and locations drawn from the Pokémon GO mobile game",
  "lost-origin": "Giratina VSTAR, the Lost Zone, Hisuian Pokémon, and the Trainer Gallery",
  "silver-tempest": "Lugia VSTAR, Regieleki, Regidrago, and the final Trainer Gallery",
  "crown-zenith": "the Sword & Shield finale and its illustration-rich Galarian Gallery",
  "scarlet-violet": "the English TCG debut of Paldean Pokémon, lowercase Pokémon ex, and Illustration Rares",
  "paldea-evolved": "the Paldea first partners' final Evolutions, more Pokémon ex, and expanded illustration rarities",
  "obsidian-flames": "a Darkness-type Tera Charizard ex and type-shifted Tera Pokémon ex",
  "paradox-rift": "Ancient and Future Pokémon, including Roaring Moon ex and Iron Valiant ex",
  "paldean-fates": "Shiny Paldean Pokémon and Shiny Pokémon ex",
  "temporal-forces": "Walking Wake ex, Iron Leaves ex, and the return of ACE SPEC cards",
  "twilight-masquerade": "Ogerpon and the Kitakami festival introduced in The Teal Mask",
  "shrouded-fable": "Pecharunt ex, the Loyal Three, and Kitakami's hidden history",
  "stellar-crown": "Stellar Tera Pokémon ex led by Terapagos ex and the Terarium",
  "surging-sparks": "Stellar Tera Pikachu ex and a lineup of Dragon Pokémon",
  "prismatic-evolutions": "Eevee and all eight of its Evolutions as Stellar Tera Pokémon ex",
  "journey-together": "the return of Trainer's Pokémon, including N's, Lillie's, Iono's, and Hop's partners",
  "destined-rivals": "Trainer's Pokémon facing Team Rocket and Giovanni's Pokémon",
  "black-bolt": "Unova Pokémon split across a paired expansion, led by Zekrom ex",
  "white-flare": "Unova Pokémon split across a paired expansion, led by Reshiram ex",
  "mega-evolution": "the return of Mega Evolution Pokémon ex, led by Mega Lucario ex and Mega Gardevoir ex",
  "phantasmal-flames": "Mega Charizard X ex alongside Mega Gengar ex, Mega Lopunny ex, and Mega Sharpedo ex",
  "ascended-heroes": "Mega Dragonite ex, Trainer's Pokémon, and Stellar Tera Pokémon ex",
  "perfect-order": "Lumiose City and Kalos lore, led by Mega Zygarde ex",
  "chaos-rising": "new Mega Evolution Pokémon ex led by Mega Greninja ex and Mega Floette ex",
  "pitch-black": "Mega Darkrai ex and a Darkness-focused Mega Evolution roster",
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

function guideFor(set) {
  const total = getPullableCollectionCards(set).length;
  const isCustom = set.id === "30th-anniversary";
  const identity = SET_IDENTITIES[set.id];
  if (!isCustom && !identity) throw new Error(`Missing curated set identity for ${set.id}.`);
  return {
    setId: set.id,
    summary: isCustom
      ? `A PackDex-created preview containing ${total} currently supported cards selected from announced 30th-anniversary material. It is not labeled as an official standalone expansion.`
      : `${set.name} spotlights ${identity}.`,
    themes: THEMES[set.id] || [],
    mechanics: mechanicsFor(set),
    ...(FEATURED_POKEMON_IDS[set.id] ? { featuredPokemonIds: FEATURED_POKEMON_IDS[set.id] } : {}),
    funFacts: FACTS[set.id] || [],
    custom: isCustom,
    contentStatus: isCustom || identity ? "curated" : "limited",
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
        { field: "release date, era, and supported count", source: "src/data/sets.js and its imported catalog data" },
        { field: "structured set identity", source: set.pokemonTcgApiSetId ? `https://api.pokemontcg.io/v2/sets/${set.pokemonTcgApiSetId}` : STRUCTURED_SOURCE },
        { field: "set-specific summary, editorial mechanics, and themes", source: guide.custom ? "src/data/special-sets/30th-anniversary/30thAnniversarySet.js" : OFFICIAL_EXPANSIONS_SOURCE },
      ],
      limitedReason: guide.contentStatus === "limited" ? "No additional set-specific claim was included without a dependable curated source; identity, date, era, and supported count remain complete." : "",
    };
  }),
};
await writeFile(AUDIT_FILE, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`Generated ${sets.length} set guides, ${Object.keys(ERA_GUIDES).length} era guides, and the editorial audit.`);
