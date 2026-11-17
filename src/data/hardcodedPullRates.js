// English per-pack estimates. No experience multipliers. See audits/pull-rates.
export const hardcodedPullRates = {
  "151": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Scarlet-Violet%E2%80%94151-Pull-Rates/b237df74-fbb0-40d0-9e13-d69ee6e804d9/",
    "notes": "151 is 10-card in this simulator.",
    "packSize": 10,
    "finalSlot": { "rare": 67, "doubleRare": 13.5, "ultraRare": 6.5, "illustrationRare": 8, "specialIllustrationRare": 3, "hyperRare": 2 },
    "subsetSlot": null,
    "evidence": "retained-estimate"
  },
  "sun-moon": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 11.15, "ultraRare": 4.22, "rainbowRare": 1.47, "secretRare": 0.81, "holoRare": 22.349999999999994 },
    "subsetSlot": null,
    "sampleSize": 7020,
    "evidence": "measured"
  },
  "guardians-rising": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 11.11, "ultraRare": 3.59, "rainbowRare": 1.29, "secretRare": 0.81, "holoRare": 23.200000000000003 },
    "subsetSlot": null,
    "sampleSize": 2088,
    "evidence": "measured"
  },
  "burning-shadows": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 10.95, "ultraRare": 3.93, "rainbowRare": 1.59, "secretRare": 0.95, "holoRare": 22.58 },
    "subsetSlot": null,
    "sampleSize": 2010,
    "evidence": "measured"
  },
  "shining-legends": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "Special set. Source includes Shiny 8.72%, GX 11.85%, Ultra 3.97%, Rainbow 1.50%, Secret 0.91%.",
    "packSize": 10,
    "finalSlot": { "doubleRare": 11.85, "ultraRare": 12.69, "rainbowRare": 1.5, "secretRare": 0.91, "holoRare": 73.05 },
    "subsetSlot": null,
    "sampleSize": 1536,
    "evidence": "measured",
    "finalBuckets": { "doubleRare": 11.85, "fullArt": 3.97, "shiningRare": 8.72, "rainbowRare": 1.5, "secretRare": 0.91, "holoRare": 73.05 }
  },
  "crimson-invasion": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 8.3, "ultraRare": 4.44, "rainbowRare": 1.11, "secretRare": 1.11, "holoRare": 25.040000000000006 },
    "subsetSlot": null,
    "sampleSize": 1530,
    "evidence": "measured"
  },
  "ultra-prism": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 8, "ultraRare": 4.3, "rainbowRare": 1.49, "secretRare": 0.78, "holoRare": 25.430000000000007 },
    "subsetSlot": {
      "type": "prismStar",
      "rates": { "normal": 91.28, "prismStar": 8.72 }
    },
    "sampleSize": 1674,
    "evidence": "measured"
  },
  "forbidden-light": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 7.44, "ultraRare": 3.56, "rainbowRare": 1.34, "secretRare": 0.71, "holoRare": 26.950000000000003 },
    "subsetSlot": {
      "type": "prismStar",
      "rates": { "normal": 92.09, "prismStar": 7.91 }
    },
    "sampleSize": 1264,
    "evidence": "measured"
  },
  "celestial-storm": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 10.34, "ultraRare": 3.78, "rainbowRare": 1.22, "secretRare": 0.88, "holoRare": 23.78 },
    "subsetSlot": {
      "type": "prismStar",
      "rates": { "normal": 94.53, "prismStar": 5.47 }
    },
    "sampleSize": 1480,
    "evidence": "measured"
  },
  "dragon-majesty": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier.",
    "packSize": 10,
    "finalSlot": { "doubleRare": 15.42, "ultraRare": 6.94, "rainbowRare": 2.31, "secretRare": 0.77, "holoRare": 74.56 },
    "subsetSlot": {
      "type": "prismStar",
      "rates": { "normal": 89.2, "prismStar": 10.8 }
    },
    "sampleSize": 389,
    "evidence": "measured"
  },
  "lost-thunder": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 10.28, "ultraRare": 4.4, "rainbowRare": 1.33, "secretRare": 1.02, "holoRare": 22.97 },
    "subsetSlot": {
      "type": "prismStar",
      "rates": { "normal": 87.83, "prismStar": 12.17 }
    },
    "sampleSize": 1274,
    "evidence": "measured"
  },
  "team-up": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 9.29, "ultraRare": 4.82, "rainbowRare": 1.03, "secretRare": 0.69, "holoRare": 24.17 },
    "subsetSlot": {
      "type": "prismStar",
      "rates": { "normal": 94.04, "prismStar": 5.96 }
    },
    "sampleSize": 872,
    "evidence": "measured"
  },
  "detective-pikachu": {
    "source": "Elite Fourum community dataset / product structure",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "Three Common holos and one Rare holo; the local Ultra Rare label represents the four scarcer Rare holos. 240-pack community estimate for that group.",
    "packSize": 4,
    "finalSlot": { "rare": 62.92, "ultraRare": 37.08 },
    "subsetSlot": null,
    "sampleSize": 240,
    "evidence": "measured"
  },
  "unbroken-bonds": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 9.88, "ultraRare": 4.12, "rainbowRare": 1.39, "secretRare": 0.9, "holoRare": 23.709999999999994 },
    "subsetSlot": null,
    "sampleSize": 3888,
    "evidence": "measured"
  },
  "unified-minds": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 12.72, "ultraRare": 4.36, "rainbowRare": 1.44, "secretRare": 0.9, "holoRare": 20.58 },
    "subsetSlot": null,
    "sampleSize": 3672,
    "evidence": "measured"
  },
  "hidden-fates": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/156",
    "notes": "Separate main/Vault trainer sheets; see audit report. Slot rates are estimates, not official odds.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "holoRare": 20, "doubleRare": 15, "ultraRare": 3.888888888889, "rainbowRare": 1.111111111111 },
    "subsetSlot": {
      "type": "shinyVault",
      "rates": { "normal": 66.666666666667, "shinyRare": 21.111111111111, "shinyUltraRare": 9.444444444444, "vaultTrainerGold": 2.777777777778 }
    },
    "evidence": "community-model"
  },
  "cosmic-eclipse": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "English community opening sample. Holo/non-holo split of the residual ordinary Rare tier remains an era estimate; no experience multiplier. Ordinary holo sheet uses the English collation model: 40% holo-or-better before independent reverse-slot specials.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 11.93, "ultraRare": 3.67, "rainbowRare": 1.5, "secretRare": 0.89, "holoRare": 22.010000000000005 },
    "subsetSlot": {
      "type": "characterSecret",
      "rates": { "normal": 89.89, "trainerGallery": 10.11 }
    },
    "sampleSize": 3136,
    "evidence": "measured"
  },
  "sword-shield": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "Separate VMAX/VSTAR, full-art and alternate-art buckets. Collector names/rarity labels are preserved. Ordinary Rare remainder uses the existing era holo split.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 14.2, "ultraRare": 5.94, "rainbowRare": 1.23, "secretRare": 0.91, "holoRare": 17.72 },
    "subsetSlot": null,
    "sampleSize": 4628,
    "evidence": "measured",
    "finalBuckets": { "rare": 60, "doubleRare": 14.2, "vmaxOrVstar": 2.2, "fullArt": 3.74, "rainbowRare": 1.23, "secretRare": 0.91, "holoRare": 17.72 }
  },
  "rebel-clash": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "Separate VMAX/VSTAR, full-art and alternate-art buckets. Collector names/rarity labels are preserved. Ordinary Rare remainder uses the existing era holo split.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 12.65, "ultraRare": 7.16, "rainbowRare": 1.5, "secretRare": 0.95, "holoRare": 17.739999999999995 },
    "subsetSlot": null,
    "sampleSize": 2736,
    "evidence": "measured",
    "finalBuckets": { "rare": 60, "doubleRare": 12.65, "vmaxOrVstar": 3.4, "fullArt": 3.76, "rainbowRare": 1.5, "secretRare": 0.95, "holoRare": 17.739999999999995 }
  },
  "darkness-ablaze": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "Separate VMAX/VSTAR, full-art and alternate-art buckets. Collector names/rarity labels are preserved. Ordinary Rare remainder uses the existing era holo split.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 12.58, "ultraRare": 7.7, "rainbowRare": 1.19, "secretRare": 0.87, "holoRare": 17.659999999999997 },
    "subsetSlot": null,
    "sampleSize": 5040,
    "evidence": "measured",
    "finalBuckets": { "rare": 60, "doubleRare": 12.58, "vmaxOrVstar": 3.85, "fullArt": 3.85, "rainbowRare": 1.19, "secretRare": 0.87, "holoRare": 17.659999999999997 }
  },
  "champions-path": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "Separate VMAX/VSTAR, full-art and alternate-art buckets. Collector names/rarity labels are preserved. Ordinary Rare remainder uses the existing era holo split.",
    "packSize": 10,
    "finalSlot": { "doubleRare": 15.73, "ultraRare": 8.94, "rainbowRare": 1.57, "secretRare": 1.32, "holoRare": 72.44 },
    "subsetSlot": null,
    "sampleSize": 3192,
    "evidence": "measured",
    "finalBuckets": { "doubleRare": 15.73, "vmaxOrVstar": 3.55, "fullArt": 5.39, "rainbowRare": 1.57, "secretRare": 1.32, "holoRare": 72.44 }
  },
  "vivid-voltage": {
    "source": "fallback estimate",
    "sourceUrl": "https://www.digitaltq.com/vivid-voltage-booster-pull-rates-pokemon-tcg",
    "notes": "English 630-pack opening tally. Holo table may include reverse treatments; ordinary holo uses the era 40% foil model. Amazing Rare is independent in reverse.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "holoRare": 16.666666666666668, "doubleRare": 12.698412698412698, "ultraRare": 8.253968253968253, "rainbowRare": 1.2698412698412698, "secretRare": 1.1111111111111112 },
    "subsetSlot": {
      "type": "amazing",
      "rates": { "normal": 94.28571428571429, "amazingRare": 5.714285714285714 }
    },
    "evidence": "small-community-sample",
    "fallbackFrom": "Sword & Shield English main expansions",
    "finalBuckets": { "rare": 60, "holoRare": 16.666666666666668, "doubleRare": 12.698412698412698, "vmaxOrVstar": 4.285714285714286, "fullArt": 3.9682539682539684, "rainbowRare": 1.2698412698412698, "secretRare": 1.1111111111111112 },
    "sampleSize": 630
  },
  "shining-fates": {
    "source": "Elite Fourum community dataset",
    "sourceUrl": "https://www.elitefourum.com/t/pull-rates-in-sun-moon-sword-shield-sets/25220",
    "notes": "Shiny Vault subset hits handled by subset slot.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 10.84, "ultraRare": 8.69, "rainbowRare": 1.19, "holoRare": 19.28 },
    "subsetSlot": {
      "type": "shinyVault",
      "subsetTypes": [
        "shinyVault",
        "amazing"
      ],
      "rates": { "normal": 61.64, "shinyRare": 22.73, "shinyUltraRare": 8.96, "secretRare": 0.91, "amazingRare": 5.76 }
    },
    "sampleSize": 2187,
    "evidence": "measured",
    "finalBuckets": { "rare": 60, "doubleRare": 10.84, "vmaxOrVstar": 5.44, "fullArt": 3.25, "rainbowRare": 1.19, "holoRare": 19.28 }
  },
  "battle-styles": {
    "source": "fallback estimate",
    "sourceUrl": "https://docs.google.com/spreadsheets/d/1sR4kDFZMMrz2eIJMky1f8_ljho5pMMgfcbB2tYG9ov4/edit",
    "notes": "TheGameCapital, 561 English boxes (sheet denominator 20,195 packs). Exact counted chase tiers. Regular V, VMAX and ordinary holo are explicit same-era fallbacks because the sheet omits them.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "holoRare": 16.939093835107702, "doubleRare": 14, "ultraRare": 6.862342163901955, "rainbowRare": 1.25278534290666, "secretRare": 0.9457786580836841 },
    "subsetSlot": null,
    "evidence": "measured-chases-with-era-base-tiers",
    "fallbackFrom": "Sword & Shield English main expansions",
    "finalBuckets": { "rare": 60, "holoRare": 16.939093835107702, "doubleRare": 14, "vmaxOrVstar": 3, "fullArt": 3.2235701906412477, "alternateArt": 0.6387719732607081, "alternateVmax": 0.14359990096558553, "rainbowRare": 1.1091854419410745, "secretRare": 0.9457786580836841 },
    "sampleSize": 20195
  },
  "chilling-reign": {
    "source": "fallback estimate",
    "sourceUrl": "https://www.reddit.com/r/PokemonTCG/comments/o2nhez/chilling_reign_pull_rate_data_from_5000_packs/",
    "notes": "Cardzard community 5,000-pack chart, rounded tier odds, cross-checked against reprinted chart. Original Reddit image was not retrievable in this environment; confidence is lower than directly accessible tables. Regular V and residual holo use the adjacent-era fallback.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "holoRare": 15.790257167579743, "doubleRare": 14, "ultraRare": 8.1698063840921, "rainbowRare": 1.0399364483281577, "secretRare": 1 },
    "subsetSlot": null,
    "evidence": "community-reported-rounded-with-era-base-tier",
    "fallbackFrom": "Sword & Shield English main expansions",
    "finalBuckets": { "rare": 60, "holoRare": 15.790257167579743, "doubleRare": 14, "vmaxOrVstar": 4.166666666666667, "fullArt": 3.3228676085818947, "alternateArt": 0.6802721088435374, "alternateVmax": 0.22026431718061673, "rainbowRare": 0.819672131147541, "secretRare": 1 },
    "sampleSize": 5000
  },
  "evolving-skies": {
    "source": "fallback estimate",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Evolving-Skies-Pull-Rates/6a743d7b-e5ee-4fd6-9d18-64a636990e8c/",
    "notes": "Separate VMAX/VSTAR, full-art and alternate-art buckets. Collector names/rarity labels are preserved. Ordinary Rare remainder uses the existing era holo split.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 10.56, "ultraRare": 9.48, "rainbowRare": 1.14, "secretRare": 0.91, "holoRare": 17.909999999999997 },
    "subsetSlot": null,
    "sampleSize": 8000,
    "evidence": "measured",
    "finalBuckets": { "rare": 60, "doubleRare": 10.56, "vmaxOrVstar": 5.6, "fullArt": 2.78, "rainbowRare": 0.84, "secretRare": 0.91, "alternateArt": 1.1, "alternateVmax": 0.3, "holoRare": 17.909999999999997 },
    "corroboratingUrl": "https://tcg1.net/pull-rates/evolving-skies/"
  },
  "celebrations": {
    "source": "product structure / fallback estimate",
    "sourceUrl": "https://www.digitaltq.com/celebrations-booster-pull-rates-pokemon-tcg",
    "notes": "Separate ordinary, Classic and final-card sheets. 541 packs / 540 recorded finals; final weights are conditional on recorded finals. Classic and main cards are not uniformly distributed. Every recorded card remains positive; small chase counts are uncertain.",
    "packSize": 4,
    "finalSlot": { "holoRare": 62.407407407407405, "doubleRare": 24.444444444444443, "ultraRare": 13.148148148148149 },
    "subsetSlot": {
      "type": "classicCollection",
      "rates": { "normal": 59.88909426987061, "classicCollection": 40.11090573012939 }
    },
    "evidence": "small-community-card-counts",
    "sampleSize": 541,
    "finalCardWeights": { "celebrations-5-pikachu": 73, "celebrations-6-flying-pikachu-v": 35, "celebrations-7-flying-pikachu-vmax": 26, "celebrations-8-surfing-pikachu-v": 29, "celebrations-9-surfing-pikachu-vmax": 24, "celebrations-11-mew": 70, "celebrations-15-lunala": 52, "celebrations-16-zacian-v": 40, "celebrations-18-zamazenta-v": 28, "celebrations-21-solgaleo": 71, "celebrations-23-professor-s-research-professor-oak": 69, "celebrations-24-professor-s-research-professor-oak": 21, "celebrations-25-mew": 2 },
    "subsetCardWeights": { "celebrations-2-blastoise": 14, "celebrations-4-charizard": 7, "celebrations-15-venusaur": 14, "celebrations-73-imposter-professor-oak": 10, "celebrations-8-dark-gyarados": 6, "celebrations-15-here-comes-team-rocket": 18, "celebrations-15-rocket-s-zapdos": 12, "celebrations-24-s-pikachu": 16, "celebrations-20-cleffa": 11, "celebrations-66-shining-magikarp": 6, "celebrations-9-team-magma-s-groudon": 17, "celebrations-86-rocket-s-admin": 9, "celebrations-88-mew-ex": 7, "celebrations-93-gardevoir-ex": 6, "celebrations-17-umbreon": 4, "celebrations-15-claydol": 15, "celebrations-109-luxray-gl-lv-x": 4, "celebrations-145-garchomp-c-lv-x": 8, "celebrations-107-donphan": 3, "celebrations-113-reshiram": 3, "celebrations-114-zekrom": 8, "celebrations-54-mewtwo-ex": 4, "celebrations-97-xerneas-ex": 6, "celebrations-76-m-rayquaza-ex": 2, "celebrations-60-tapu-lele-gx": 7 }
  },
  "fusion-strike": {
    "source": "fallback estimate",
    "sourceUrl": "https://www.tcgplayer.com/content/article/How-to-Tell-the-Rarity-of-a-Pok%C3%A9mon-Card/3bc6c211-f4ce-4c4d-b823-74f3790ebaeb/",
    "notes": "TCGplayer 4,000+ English pack infographic publishes rounded 1-in-N values. Regular V and ordinary holo remain explicitly estimated; no made-up measured V percentage.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "holoRare": 16.90253345266304, "doubleRare": 14, "ultraRare": 7.1755268199233715, "rainbowRare": 1.0886063940802582, "secretRare": 0.8333333333333334 },
    "subsetSlot": null,
    "evidence": "measured-rounded-with-era-base-tier",
    "fallbackFrom": "Sword & Shield English main expansions",
    "finalBuckets": { "rare": 60, "holoRare": 16.90253345266304, "doubleRare": 14, "vmaxOrVstar": 3.3333333333333335, "fullArt": 3.2866379310344827, "alternateArt": 0.5555555555555556, "alternateVmax": 0.30120481927710846, "rainbowRare": 0.7874015748031497, "secretRare": 0.8333333333333334 },
    "sampleSize": 4000
  },
  "brilliant-stars": {
    "source": "fallback estimate / Trainer Gallery estimate",
    "sourceUrl": "https://www.tcgplayer.com/content/article/The-10-Most-Valuable-Pok%C3%A9mon-Cards-in-Brilliant-Stars/aeafa051-3b3b-4856-acb1-29369d050ff6/",
    "notes": "TCGplayer 10,000+ pack infographic for Rainbow/Gold and Gallery. Main V/VMAX/full-art group estimates use DigitalTQ 1,004-pack tally; main full-art individual weights remain uniform (no unsupported alternate-art sub-rate). Ordinary holo is an era estimate.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "holoRare": 13.247079881666853, "doubleRare": 14.9402390438247, "ultraRare": 8.764940239043824, "rainbowRare": 1.9607843137254901, "secretRare": 1.0869565217391304 },
    "subsetSlot": {
      "type": "trainerGallery",
      "rates": { "normal": 81.94444444444444, "trainerGallery": 12.5, "premiumTrainerGallery": 5.555555555555555 }
    },
    "evidence": "mixed-community-table-and-measured-rounded",
    "fallbackFrom": "Sword & Shield English main expansions",
    "finalBuckets": { "rare": 60, "holoRare": 13.247079881666853, "doubleRare": 14.9402390438247, "vmaxOrVstar": 3.7848605577689245, "fullArt": 4.9800796812749, "rainbowRare": 1.9607843137254901, "secretRare": 1.0869565217391304 },
    "sampleSize": 10000,
    "corroboratingUrl": "https://www.digitaltq.com/brilliant-stars-pull-rates-pokemon-tcg"
  },
  "astral-radiance": {
    "source": "fallback estimate / Trainer Gallery estimate",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Astral-Radiance-Pull-Rates/10da749f-9c8b-45c0-b80a-dbd86ca5dcde/",
    "notes": "Separate VMAX/VSTAR, full-art and alternate-art buckets. Collector names/rarity labels are preserved. Ordinary Rare remainder uses the existing era holo split.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 12.77, "ultraRare": 7.42, "rainbowRare": 1.28, "secretRare": 0.76, "holoRare": 17.769999999999996 },
    "subsetSlot": {
      "type": "independentReverse",
      "rates": { "normal": 82.54, "trainerGallery": 8.48, "premiumTrainerGallery": 4.1, "radiantRare": 4.88 }
    },
    "sampleSize": 8000,
    "evidence": "measured",
    "finalBuckets": { "rare": 60, "doubleRare": 12.77, "vmaxOrVstar": 3.47, "fullArt": 3.21, "rainbowRare": 1.28, "secretRare": 0.76, "alternateArt": 0.74, "holoRare": 17.769999999999996 },
    "corroboratingUrl": "https://tcg1.net/pull-rates/astral-radiance/"
  },
  "pokemon-go": {
    "source": "DigitalTQ English opening tally",
    "sourceUrl": "https://www.digitaltq.com/pokemon-go-pull-rates-pokemon-tcg",
    "notes": "371-pack sample: 59 V, 22 VMAX/VSTAR, 20 full art, 12 Rainbow, 2 Gold, 20 Radiant. Published Holo count is inconsistent with the other final-tier totals; use their residual. No individual-card zero counts become zero-probability routes.",
    "packSize": 10,
    "finalSlot": { "doubleRare": 15.902964959568733, "ultraRare": 11.320754716981131, "rainbowRare": 3.234501347708895, "secretRare": 0.5390835579514824, "holoRare": 69.00269541778977 },
    "subsetSlot": {
      "type": "radiant",
      "rates": { "normal": 94.60916442048517, "radiantRare": 5.390835579514825 }
    },
    "evidence": "small-community-sample",
    "sampleSize": 371,
    "finalBuckets": { "doubleRare": 15.902964959568733, "vmaxOrVstar": 5.929919137466308, "fullArt": 5.390835579514825, "rainbowRare": 3.234501347708895, "secretRare": 0.5390835579514824, "holoRare": 69.00269541778977 }
  },
  "lost-origin": {
    "source": "TCGplayer / fallback category mapping",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Lost-Origin-Pull-Rates/ba20ac4d-9448-45ce-b919-d856d107c744/",
    "notes": "Separate VMAX/VSTAR, full-art and alternate-art buckets. Collector names/rarity labels are preserved. Ordinary Rare remainder uses the existing era holo split.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 11.63, "ultraRare": 8.32, "rainbowRare": 1.4285714285714286, "secretRare": 0.8771929824561403, "holoRare": 17.744235589 },
    "subsetSlot": {
      "type": "independentReverse",
      "rates": { "normal": 82.67, "trainerGallery": 8.29, "premiumTrainerGallery": 3.17, "goldTrainerGallery": 0.86, "radiantRare": 5.01 }
    },
    "sampleSize": 8000,
    "evidence": "measured-rounded-secret-rates",
    "finalBuckets": { "rare": 60, "doubleRare": 11.63, "vmaxOrVstar": 4.42, "fullArt": 3.4, "rainbowRare": 1.4285714285714286, "secretRare": 0.8771929824561403, "alternateArt": 0.5, "holoRare": 17.744235589 },
    "corroboratingUrl": "https://tcg1.net/pull-rates/lost-origin/"
  },
  "silver-tempest": {
    "source": "TCGplayer-style estimate / Trainer Gallery estimate",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Silver-Tempest-Pull-Rates/6490d591-e582-4930-8446-00e190876d30/",
    "notes": "Separate VMAX/VSTAR, full-art and alternate-art buckets. Collector names/rarity labels are preserved. Ordinary Rare remainder uses the existing era holo split.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 11.55, "ultraRare": 7.43, "rainbowRare": 1.26, "secretRare": 0.94, "holoRare": 18.819999999999993 },
    "subsetSlot": {
      "type": "independentReverse",
      "rates": { "normal": 83.22, "trainerGallery": 8.25, "premiumTrainerGallery": 3.08, "goldTrainerGallery": 0.9, "radiantRare": 4.55 }
    },
    "sampleSize": 8000,
    "evidence": "measured",
    "finalBuckets": { "rare": 60, "doubleRare": 11.55, "vmaxOrVstar": 3.72, "fullArt": 3.11, "rainbowRare": 1.26, "secretRare": 0.94, "alternateArt": 0.6, "holoRare": 18.819999999999993 },
    "corroboratingUrl": "https://tcg1.net/pull-rates/silver-tempest/"
  },
  "crown-zenith": {
    "source": "fallback estimate / Galarian Gallery estimate",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Crown-Zenith-Pull-Rates/56af3032-cb34-4da1-92fb-9cf206d10c0f/",
    "notes": "Galarian Gallery handled as subset slot.",
    "packSize": 10,
    "finalSlot": { "rare": 60, "doubleRare": 12.35, "ultraRare": 8.15, "secretRare": 0.75, "holoRare": 19.25 },
    "subsetSlot": {
      "type": "independentReverse",
      "rates": { "normal": 60.25, "galarianGallery": 22.4, "premiumGalarianGallery": 12, "goldGalarianGallery": 0.8, "radiantRare": 4.55 }
    },
    "sampleSize": 1900,
    "evidence": "measured",
    "finalBuckets": { "rare": 60, "doubleRare": 12.35, "vmaxOrVstar": 5.3, "textureEnergy": 1.9, "fullArt": 0.95, "secretRare": 0.75, "holoRare": 19.25 },
    "corroboratingUrl": "https://tcg1.net/pull-rates/crown-zenith/"
  },
  "scarlet-violet": {
    "source": "TCGplayer / CardShopLive corroboration",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Scarlet-Violet-Pull-Rates/a7702fce-dd64-4a58-beb1-0f871c853215/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 67.0, "doubleRare": 13.76, "ultraRare": 6.57, "illustrationRare": 7.67, "specialIllustrationRare": 3.15, "hyperRare": 1.85 },
    "subsetSlot": null,
    "evidence": "measured",
    "sampleSize": 8000
  },
  "paldea-evolved": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Paldea-Evolved-Pull-Rates/1b7d3e70-9542-4a50-8692-1661e2316521/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 67.01, "doubleRare": 13.72, "ultraRare": 6.64, "illustrationRare": 7.7, "specialIllustrationRare": 3.17, "hyperRare": 1.76 },
    "subsetSlot": null,
    "evidence": "measured",
    "sampleSize": 8000
  },
  "obsidian-flames": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Obsidian-Flames-Pull-Rates/e2a66999-a7b5-4621-9765-c9a132e04bd2/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 67.11, "doubleRare": 13.61, "ultraRare": 6.63, "illustrationRare": 7.6, "specialIllustrationRare": 3.13, "hyperRare": 1.92 },
    "subsetSlot": null,
    "evidence": "measured",
    "sampleSize": 8000
  },
  "paradox-rift": {
    "source": "TCGplayer-style estimate",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Paradox-Rift-Pull-Rates/0b5fb648-38fc-4f61-a6af-57c2737b4a48/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 66.76, "doubleRare": 15.57, "ultraRare": 6.64, "illustrationRare": 7.7, "specialIllustrationRare": 2.11, "hyperRare": 1.22 },
    "subsetSlot": null,
    "evidence": "measured",
    "sampleSize": 8000,
    "corroboratingUrl": "https://tcg1.net/pull-rates/paradox-rift/"
  },
  "paldean-fates": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Paldean-Fates-Pull-Rates/23de3e93-0d0f-4ae0-abc4-13664f3001a3/",
    "notes": "TCGplayer reports independent first-Reverse, second-Reverse, and Rare-slot rates.",
    "packSize": 10,
    "rareSlot": { "rare": 77.5, "doubleRare": 15.89, "ultraRare": 6.61 },
    "secondFoilSlot": { "normal": 89.45, "illustrationRare": 7.22, "specialIllustrationRare": 1.72, "hyperRare": 1.61 },
    "subsetSlot": {
      "type": "shiny",
      "rates": { "normal": 66.84, "shinyRare": 25.44, "shinyUltraRare": 7.72 }
    },
    "evidence": "retained-estimate"
  },
  "temporal-forces": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Temporal-Forces-Pull-Rates/28c0ad22-00a4-428f-b22d-e7fee9ec50bc/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 66.89, "doubleRare": 16.83, "ultraRare": 6.67, "illustrationRare": 7.72, "specialIllustrationRare": 1.17, "hyperRare": 0.72 },
    "subsetSlot": {
      "type": "aceSpec",
      "rates": { "normal": 95, "aceSpecRare": 5 }
    },
    "evidence": "measured",
    "sampleSize": 8000
  },
  "twilight-masquerade": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Twilight-Masquerade-Pull-Rates/f3eea967-e5fb-4108-8655-bb1c89587628/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 66.88, "doubleRare": 16.93, "ultraRare": 6.61, "illustrationRare": 7.73, "specialIllustrationRare": 1.17, "hyperRare": 0.68 },
    "subsetSlot": {
      "type": "aceSpec",
      "rates": { "normal": 94.94, "aceSpecRare": 5.06 }
    },
    "evidence": "measured",
    "sampleSize": 8000
  },
  "shrouded-fable": {
    "source": "TCGplayer-style / community estimate",
    "sourceUrl": "",
    "notes": "No dependable large opening found. Use adjacent English ACE SPEC-era rates; all five Hyper Rares remain eligible.",
    "packSize": 10,
    "finalSlot": { "rare": 66.88, "doubleRare": 16.93, "ultraRare": 6.61, "illustrationRare": 7.73, "specialIllustrationRare": 1.17, "hyperRare": 0.68 },
    "subsetSlot": {
      "type": "aceSpec",
      "subsetTypes": [
        "aceSpec"
      ],
      "rates": { "normal": 95, "aceSpecRare": 5 }
    },
    "evidence": "era-fallback",
    "fallbackFrom": "Temporal Forces / Twilight Masquerade"
  },
  "stellar-crown": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Stellar-Crown-Pull-Rates/2c0743dd-dbd0-4504-9ff8-be5a72dd04d1/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 66.72, "doubleRare": 16.9, "ultraRare": 6.75, "illustrationRare": 7.79, "specialIllustrationRare": 1.11, "hyperRare": 0.73 },
    "subsetSlot": {
      "type": "aceSpec",
      "rates": { "normal": 95.06, "aceSpecRare": 4.94 }
    },
    "evidence": "measured",
    "sampleSize": 8000
  },
  "surging-sparks": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Surging-Sparks-Pull-Rates/6ccfb6ab-f26a-4ce8-bab5-5f91c85ec70e/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 66.97, "doubleRare": 16.94, "ultraRare": 6.74, "illustrationRare": 7.67, "specialIllustrationRare": 1.15, "hyperRare": 0.53 },
    "subsetSlot": {
      "type": "aceSpec",
      "rates": { "normal": 94.97, "aceSpecRare": 5.03 }
    },
    "evidence": "measured",
    "sampleSize": 8000
  },
  "prismatic-evolutions": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Prismatic-Evolutions-Pull-Rates/d94889ea-f76a-4a13-b74d-5b0b071220a7/",
    "notes": "SIR 2.22% means expected cards per pack including multi-hit packs, not the probability of any SIR. God frequency is unconfirmed; see aggregate calibration.",
    "packSize": 10,
    "finalSlot": { "rare": 73.25, "doubleRare": 16.51, "ultraRare": 7.46, "specialIllustrationRare": 2.22, "hyperRare": 0.56 },
    "subsetSlot": {
      "type": "independentReverse",
      "rates": { "normal": 95.32, "aceSpecRare": 4.68 }
    },
    "evidence": "measured",
    "sampleSize": 1200
  },
  "journey-together": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Journey-Together-Pull-Rates/1b9f379f-97cb-45cc-b6f6-a1a070a422cd/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 62.78, "doubleRare": 20.29, "ultraRare": 6.54, "illustrationRare": 8.5, "specialIllustrationRare": 1.16, "hyperRare": 0.73 },
    "subsetSlot": null,
    "evidence": "measured",
    "sampleSize": 8000
  },
  "destined-rivals": {
    "source": "TCGplayer-style estimate",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Destined-Rivals-Pull-Rates/43ba832e-44c9-45a4-ae2e-594df2defdda/",
    "notes": "English TCGplayer opening estimate; independent Rare and second foil slots. No experience tuning.",
    "packSize": 10,
    "finalSlot": { "rare": 63.76, "doubleRare": 19.83, "ultraRare": 6.39, "illustrationRare": 8.29, "specialIllustrationRare": 1.06, "hyperRare": 0.67 },
    "subsetSlot": null,
    "evidence": "measured",
    "sampleSize": 8000,
    "corroboratingUrl": "https://tcg1.net/pull-rates/destined-rivals/"
  },
  "black-bolt": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Black-Bolt-and-White-Flare-Pull-Rates/bac92199-a2a7-4668-b4a4-2647a111776f/",
    "notes": "Combined 700+ pack English study observed no BWR. Any-BWR 0.1% is a provisional adjacent-chase fallback (0.05% per card); zero observations never mean impossible. The one-sided 95% upper bound from 0/700 is about 0.43%, so the former 0.6% total was unsupported.",
    "packSize": 10,
    "finalSlot": { "rare": 55.32, "doubleRare": 21.11, "ultraRare": 5.83, "illustrationRare": 16.39, "specialIllustrationRare": 1.25, "blackWhiteRare": 0.05, "victiniRare": 0.05 },
    "subsetSlot": null,
    "evidence": "measured-with-chase-fallback",
    "sampleSize": 700
  },
  "white-flare": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Black-Bolt-and-White-Flare-Pull-Rates/bac92199-a2a7-4668-b4a4-2647a111776f/",
    "notes": "Combined 700+ pack English study observed no BWR. Any-BWR 0.1% is a provisional adjacent-chase fallback (0.05% per card); zero observations never mean impossible. The one-sided 95% upper bound from 0/700 is about 0.43%, so the former 0.6% total was unsupported.",
    "packSize": 10,
    "finalSlot": { "rare": 55.32, "doubleRare": 21.11, "ultraRare": 5.83, "illustrationRare": 16.39, "specialIllustrationRare": 1.25, "blackWhiteRare": 0.05, "victiniRare": 0.05 },
    "subsetSlot": null,
    "evidence": "measured-with-chase-fallback",
    "sampleSize": 700
  },
  "mega-evolution": {
    "source": "TCGplayer English opening study",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Mega-Evolution-Pull-Rates/40cbeedc-21ce-473b-aef1-74e3969d9f91/",
    "evidence": "measured",
    "sampleSize": 5000,
    "packSize": 10,
    "finalSlot": { "rare": 58.9, "doubleRare": 0.0, "megaDoubleRare": 20.91, "ultraRare": 8.23, "illustrationRare": 10.89, "specialIllustrationRare": 0.99, "megaHyperRare": 0.08 },
    "subsetSlot": null,
    "notes": "Combined Double Rare tier split uniformly across eligible standard/Mega cards. No zero-weight standard ex tier. ",
    "corroboratingUrl": "https://tcg1.net/pull-rates/mega-evolution/"
  },
  "phantasmal-flames": {
    "source": "TCGplayer English opening study",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Phantasmal-Flames-Pull-Rates/9abae60d-b7fb-448f-874e-176f78d6a6ca/",
    "evidence": "measured",
    "sampleSize": 5000,
    "packSize": 10,
    "finalSlot": { "rare": 58.87, "doubleRare": 8.308, "megaDoubleRare": 12.462, "ultraRare": 8.06, "illustrationRare": 10.97, "specialIllustrationRare": 1.25, "megaHyperRare": 0.08 },
    "subsetSlot": null,
    "notes": "Combined Double Rare tier split uniformly across eligible standard/Mega cards. No zero-weight standard ex tier. ",
    "corroboratingUrl": "https://tcg1.net/pull-rates/phantasmal-flames/"
  },
  "ascended-heroes": {
    "source": "TCGplayer",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Ascended-Heroes-Pull-Rates/60143d94-88a7-42ce-8e73-babd7b3fabd6/",
    "notes": "2,000+ pack sample. Double Rare is split 26/39 standard and 13/39 Mega by the catalog population; Mega Attack Rare replaces an Ultra Rare in the Rare slot.",
    "packSize": 10,
    "secondFoilSlot": { "normal": 87.31, "illustrationRare": 11.25, "specialIllustrationRare": 1.44 },
    "rareSlot": { "rare": 71.16, "doubleRare": 13.58, "megaDoubleRare": 6.79, "ultraRare": 4.81, "megaAttackRare": 3.47, "megaHyperRare": 0.19 },
    "subsetSlot": null,
    "evidence": "retained-estimate"
  },
  "perfect-order": {
    "source": "TCGplayer English opening study",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Perfect-Order-Pull-Rates/73148119-ebcb-40b7-84b6-52b3a6d0c631/",
    "evidence": "measured",
    "sampleSize": 3500,
    "packSize": 10,
    "finalSlot": { "rare": 58.0, "doubleRare": 11.649999999999999, "megaDoubleRare": 9.32, "ultraRare": 8.54, "illustrationRare": 11.2, "specialIllustrationRare": 1.23, "megaHyperRare": 0.06 },
    "subsetSlot": null,
    "notes": "Combined Double Rare tier split uniformly across eligible standard/Mega cards. No zero-weight standard ex tier. ",
    "corroboratingUrl": "https://tcg1.net/pull-rates/perfect-order/"
  },
  "chaos-rising": {
    "source": "TCGplayer English opening study",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Chaos-Rising-Pull-Rates/304e8bfc-175a-4d31-93fe-5bb1be11e5d2/",
    "evidence": "measured",
    "sampleSize": 8500,
    "packSize": 10,
    "finalSlot": { "rare": 59.44, "doubleRare": 10.15, "megaDoubleRare": 10.15, "ultraRare": 8.29, "illustrationRare": 10.66, "specialIllustrationRare": 1.21, "megaHyperRare": 0.1 },
    "subsetSlot": null,
    "notes": "Combined Double Rare tier split uniformly across eligible standard/Mega cards. No zero-weight standard ex tier. ",
    "corroboratingUrl": "https://tcg1.net/pull-rates/chaos-rising/"
  },
  "pitch-black": {
    "source": "Existing estimates retained within uncertainty of the 4,000-pack TCGplayer study",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Pitch-Black-Pull-Rates/069a5fda-2d1f-44a1-97de-b6dcdc5abfb8/",
    "sampleSize": 4000,
    "notes": "Existing point estimates retained: compatible with reported study uncertainty. Mega foil slot and Rare slot are independent. The 20.5% Double Rare rate is split across 4 standard and 6 Mega cards: 8.2% / 12.3%.",
    "packSize": 10,
    "secondFoilSlot": { "normal": 87.89, "illustrationRare": 11, "specialIllustrationRare": 1.11 },
    "rareSlot": { "rare": 71.144, "doubleRare": 8.2, "megaDoubleRare": 12.3, "ultraRare": 8.3, "megaHyperRare": 0.056 },
    "subsetSlot": null,
    "evidence": "retained-estimate"
  },
  "30th-celebration": {
    "source": "TCGplayer (3,000+ English packs) and community observations",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-30th-Celebration-Pull-Rates/587b3657-481a-4ab8-827c-68cd3ab585b0/",
    "notes": "Five collectible cards with a guaranteed Pikachu. RGB Rare uses a provisional 2-in-20,000 community estimate. The physical booster also includes foil Basic Energy.",
    "packSize": 5,
    "secondFoilSlot": { "common": 70.13, "illustrationRare": 19.72, "classicCollection": 10.15 },
    "rareSlot": { "rare": 73.26, "doubleRare": 21.02, "specialIllustrationRare": 4.88, "futuristicRare": 0.83, "rgbRare": 0.01 },
    "subsetSlot": null,
    "evidence": "retained-estimate"
  },
  "delta-reign": {
    "source": "Mega Evolution English era fallback",
    "sourceUrl": "https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Mega-Evolution-Pull-Rates/40cbeedc-21ce-473b-aef1-74e3969d9f91/",
    "evidence": "era-fallback",
    "sampleSize": null,
    "packSize": 10,
    "finalSlot": { "rare": 58.9, "doubleRare": 12.546000000000001, "megaDoubleRare": 8.364, "ultraRare": 8.23, "illustrationRare": 10.89, "specialIllustrationRare": 0.99, "megaHyperRare": 0.08 },
    "subsetSlot": null,
    "notes": "Combined Double Rare tier split uniformly across eligible standard/Mega cards. No zero-weight standard ex tier. 252-pack Delta Reign community report is too small for reliable chase odds; nearest Mega-era fallback is compatible with its intervals."
  },
  "xy1": {
    "sourceNote": "Early XY simulator approximation: holo ~1:4, EX ~1:18, Ultra/Full Art ~1:36, Secret ~1:72 where secret cards exist.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "reversePlaceholder",
      "simulatorFoil": false
    },
    "finalRareSlot": { "regularRare": 0.6555555555555554, "holoRare": 0.23333333333333334, "rareHoloEX": 0.08333333333333333, "ultraRareFullArt": 0.027777777777777776, "secretRare": 0 },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/121",
    "evidence": "community-collation-model"
  },
  "xy2": {
    "sourceNote": "Early XY simulator approximation: holo ~1:4, EX ~1:18, Ultra/Full Art ~1:36, Secret ~1:72 where secret cards exist.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "reversePlaceholder",
      "simulatorFoil": false
    },
    "finalRareSlot": { "regularRare": 0.6666666666666666, "holoRare": 0.19722222222222222, "rareHoloEX": 0.08847222222222223, "ultraRareFullArt": 0.03888888888888889, "secretRare": 0.008749999999999999 },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/122",
    "evidence": "community-collation-model"
  },
  "xy3": {
    "sourceNote": "Early XY simulator approximation: holo ~1:4, EX ~1:18, Ultra/Full Art ~1:36, Secret ~1:72 where secret cards exist.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "reversePlaceholder",
      "simulatorFoil": false
    },
    "finalRareSlot": { "regularRare": 0.6666666666666667, "holoRare": 0.19722222222222222, "rareHoloEX": 0.08750000000000001, "ultraRareFullArt": 0.03888888888888889, "secretRare": 0.009722222222222222 },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/123",
    "evidence": "community-collation-model"
  },
  "xy4": {
    "sourceNote": "Early XY simulator approximation: holo ~1:4, EX ~1:18, Ultra/Full Art ~1:36, Secret ~1:72 where secret cards exist.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "reversePlaceholder",
      "simulatorFoil": false
    },
    "finalRareSlot": { "regularRare": 0.6666666666666667, "holoRare": 0.19444444444444445, "rareHoloEX": 0.09138888888888888, "ultraRareFullArt": 0.03875, "secretRare": 0.00875 },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/125",
    "evidence": "community-collation-model"
  },
  "xy5": {
    "sourceNote": "Transition XY profile: between early XY and later XY. Slightly better EX/Full Art odds, Secret still about 1:72.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "reversePlaceholder",
      "simulatorFoil": false
    },
    "finalRareSlot": { "regularRare": 0.6666666666666667, "holoRare": 0.15555555555555556, "rareHoloEX": 0.1111111111111111, "ultraRareFullArt": 0.058666666666666666, "secretRare": 0.008 },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/126",
    "evidence": "community-collation-model"
  },
  "xy6": {
    "sourceNote": "Transition XY profile: between early XY and later XY. Slightly better EX/Full Art odds, Secret still about 1:72.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "reversePlaceholder",
      "simulatorFoil": false
    },
    "finalRareSlot": { "regularRare": 0.6666666666666667, "holoRare": 0.15555555555555556, "rareHoloEX": 0.1111111111111111, "ultraRareFullArt": 0.058666666666666666, "secretRare": 0.008 },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/129",
    "evidence": "community-collation-model"
  },
  "xy7": {
    "sourceNote": "Later XY simulator approximation: EX ~1:6, Ultra/Full Art ~1:12, Secret ~1:72.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "reversePlaceholder",
      "simulatorFoil": false
    },
    "finalRareSlot": { "regularRare": 0.6666666666666667, "holoRare": 0.15555555555555556, "rareHoloEX": 0.1111111111111111, "ultraRareFullArt": 0.058666666666666666, "secretRare": 0.008 },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/130",
    "evidence": "community-collation-model"
  },
  "xy8": {
    "sourceNote": "BREAK-era XY profile. BREAK cards appear in the pre-rare/reverse-style slot at about 1:12 packs. Final rare slot uses later XY rates.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "breakOrReversePlaceholder",
      "breakCard": 0.07777777777777778,
      "reversePlaceholder": 0.9222222222222223,
      "simulatorFoil": false
    },
    "finalRareSlot": {
      "regularRare": 0.6666666666666666,
      "holoRare": 0.17777777777777778,
      "rareHoloEX": 0.08888888888888889,
      "ultraRareFullArt": 0.058666666666666666,
      "secretRare": 0.008,
      "excludeBreakCards": true
    },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/132",
    "evidence": "community-collation-model"
  },
  "xy9": {
    "sourceNote": "BREAK-era XY profile. BREAK cards appear in the pre-rare/reverse-style slot at about 1:12 packs. Final rare slot uses later XY rates.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "breakOrReversePlaceholder",
      "breakCard": 0.06666666666666667,
      "reversePlaceholder": 0.9333333333333333,
      "simulatorFoil": false
    },
    "finalRareSlot": {
      "regularRare": 0.6666666666666667,
      "holoRare": 0.16666666666666666,
      "rareHoloEX": 0.1,
      "ultraRareFullArt": 0.058666666666666666,
      "secretRare": 0.008,
      "excludeBreakCards": true
    },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/133",
    "evidence": "community-collation-model"
  },
  "xy10": {
    "sourceNote": "BREAK-era XY profile. BREAK cards appear in the pre-rare/reverse-style slot at about 1:12 packs. Final rare slot uses later XY rates.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "breakOrReversePlaceholder",
      "breakCard": 0.06666666666666667,
      "reversePlaceholder": 0.9333333333333333,
      "simulatorFoil": false
    },
    "finalRareSlot": {
      "regularRare": 0.6666666666666666,
      "holoRare": 0.14444444444444446,
      "rareHoloEX": 0.12222222222222223,
      "ultraRareFullArt": 0.058666666666666666,
      "secretRare": 0.008,
      "excludeBreakCards": true
    },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/136",
    "evidence": "community-collation-model"
  },
  "xy11": {
    "sourceNote": "BREAK-era XY profile. BREAK cards appear in the pre-rare/reverse-style slot at about 1:12 packs. Final rare slot uses later XY rates.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "preRareSlot": {
      "type": "breakOrReversePlaceholder",
      "breakCard": 0.06666666666666667,
      "reversePlaceholder": 0.9333333333333333,
      "simulatorFoil": false
    },
    "finalRareSlot": {
      "regularRare": 0.6666666666666667,
      "holoRare": 0.2,
      "rareHoloEX": 0.06666666666666667,
      "ultraRareFullArt": 0.058666666666666666,
      "secretRare": 0.008,
      "excludeBreakCards": true
    },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/137",
    "evidence": "community-collation-model"
  },
  "xy12": {
    "sourceNote": "Evolutions special handling: Secret Rares are treated as uncommon-slot-style pulls. BREAK cards appear in the reverse/pre-rare slot and are excluded from the final rare pool.",
    "packSize": 10,
    "commonSlots": 5,
    "uncommonSlots": 3,
    "uncommonSecretRate": 0.1111,
    "preRareSlot": {
      "type": "breakOrReversePlaceholder",
      "breakCard": 0.0556,
      "reversePlaceholder": 0.9444,
      "simulatorFoil": false
    },
    "finalRareSlot": {
      "regularRare": 0.6666666666666666,
      "holoRare": 0.14444444444444446,
      "rareHoloEX": 0.12222222222222223,
      "ultraRareFullArt": 0.06666666666666667,
      "secretRare": 0,
      "excludeBreakCards": true
    },
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/139",
    "evidence": "community-collation-model"
  },
  "dc1": {
    "sourceNote": "Double Crisis special 7-card pack. Use only Double Crisis cards. No normal XY 10-card logic.",
    "packSize": 7,
    "commonSlots": 3,
    "uncommonSlots": 2,
    "preRareSlot": {
      "type": "reversePlaceholder",
      "simulatorFoil": false
    },
    "finalRareSlot": { "holoRare": 0.8793103448275862, "ultraRareFullArt": 0.1206896551724138 },
    "source": "116-pack English sample",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/127",
    "evidence": "measured",
    "sampleSize": 116
  },
  "g1": {
    "sourceNote": "Generations special pack: 10 cards total, 8 core Generations cards plus 2 Radiant Collection cards.",
    "packSize": 10,
    "coreCards": 8,
    "radiantCollectionCards": 2,
    "coreSlots": {
      "commonSlots": 4,
      "uncommonSlots": 2,
      "preRareSlot": {
        "type": "reversePlaceholder",
        "simulatorFoil": false
      },
      "finalRareSlot": { "regularRare": 0.6666666666666666, "holoRare": 0.10555555555555556, "rareHoloEX": 0.20555555555555557, "ultraRareFullArt": 0.022222222222222223 }
    },
    "radiantCollectionSlots": [
      { "radiantCommon": 1 },
      { "radiantUncommon": 0.72, "radiantPremium": 0.28 }
    ],
    "source": "English community collation study",
    "sourceUrl": "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/134",
    "evidence": "community-collation-model",
    "subsetSlot": {
      "type": "radiantCollection",
      "rates": { "normal": 0, "radiantCollection": 100 }
    }
  }
};
