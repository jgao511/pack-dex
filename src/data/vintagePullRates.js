// Community models of English pack collation, not official published odds.
// Rates are fractions per pack. Sources distinguish categories the local
// display taxonomy combines (Gold Star / ex / LV.X / Prime / LEGEND / ACE SPEC).
const GUIDE = "https://www.elitefourum.com/t/the-english-pokemon-card-rarity-guide/39762/";
const rates = {};
function define(id, post, rareHits = {}, reverseHits = {}, extra = {}) {
  rates[id] = {
    sourceUrl: `${GUIDE}${post}`,
    evidence: "community-collation-model",
    rare: { rare: 2 / 3, holoRare: 1 / 3 - Object.values(rareHits).reduce((a, b) => a + b, 0), ...rareHits },
    reverse: { normal: 1 - Object.values(reverseHits).reduce((a, b) => a + b, 0), ...reverseHits },
    ...extra,
  };
}
// Holo/ex replaces a common in the three earliest EX sets; the Rare remains.
for (const [id, post] of [["ex-ruby-sapphire",35],["ex-sandstorm",36],["ex-dragon",37]]) {
  const secret = id === "ex-dragon" ? (1 / 6) * 21 / 110 : 0;
  define(id, post, {}, {}, { rare: { rare: 1 }, commonReplacement: { normal: 2 / 3, holoRare: 1 / 6 - secret, ex: 1 / 6, ...(secret ? {secretRare:secret} : {}) } });
}
define("ex-team-magma-vs-team-aqua",38,{ex:3/36,secretRare:9/36*8/110});
define("ex-hidden-legends",40,{ex:2/36,regiEx:1/36});
define("ex-firered-leafgreen",44,{ex:3/36,secretRare:1/36});
define("ex-team-rocket-returns",47,{ex:(3-1/3)/36,goldStar:1/108,secretRare:1/220});
define("ex-deoxys",48,{ex:(3-1/3)/36,goldStar:1/108});
define("ex-emerald",51,{ex:3/36},{foilEnergy:1/3});
define("ex-unseen-forces",52,{ex:(3-1/3)/36,goldStar:1/108},{unown:43/216});
define("ex-delta-species",54,{ex:1/36,goldStar:1/108});
define("ex-legend-maker",55,{ex:2/36,goldStar:1/108});
define("ex-holon-phantoms",57,{ex:1/36,goldStar:1/108},{foilEnergy:1/3});
define("ex-crystal-guardians",58,{ex:3/36,goldStar:1/108});
define("ex-dragon-frontiers",60,{ex:3/36,goldStar:1/108});
define("ex-power-keepers",62,{ex:3/36,goldStar:9/36*6/121},{foilEnergy:30/121});
for (const [id,post,lvx] of [["diamond-pearl",64,1],["diamond-pearl-mysterious-treasures",65,1],["diamond-pearl-secret-wonders",67,.5],["diamond-pearl-great-encounters",69,1],["diamond-pearl-majestic-dawn",71,1],["diamond-pearl-legends-awakened",72,2]]) {
  define(id,post,{lvx:lvx/36,...(id==="diamond-pearl-mysterious-treasures"?{secretRare:(11/36)*2/121}:{})});
}
define("diamond-pearl-stormfront",75,{lvx:2/36,secretRare:(10/36)*12/121},{shiny:3/121});
define("platinum",76,{lvx:2/36,secretRare:(10/36)*12/121},{shiny:3/121});
define("platinum-rising-rivals",80,{lvx:2/36,secretRare:1/36},{rotom:2/36});
define("platinum-supreme-victors",81,{lvx:3.5/36,secretRare:(8.5/36)*15/121},{shiny:3/121});
define("platinum-arceus",82,{lvx:3/36},{arceus:1/4,shiny:(3/121)*3/4});
for (const [id,post,legend,prime,lithograph] of [["heartgold-soulsilver",86,3,6,.5],["hs-unleashed",87,3,5,1/6],["hs-undaunted",88,2.5,5,1/6],["hs-triumphant",97,2.5,5,1/6]]) {
  define(id,post,{legend:legend/36,secretRare:lithograph/36},{prime:prime/36});
}
define("call-of-legends",98,{}, {shinyLegend:2/36});
define("black-white",99,{fullArt:2/36,secretRare:.5/36});
define("black-white-emerging-powers",100,{fullArt:2/36});
define("black-white-noble-victories",101,{fullArt:2/36,secretRare:.5/36});
for(const [id,post] of [["black-white-next-destinies",104],["black-white-dark-explorers",105],["black-white-dragons-exalted",106]]) define(id,post,{ex:2/36,fullArt:1/36,secretRare:1/108});
for(const [id,post,ex,fa,sr,ace] of [["black-white-boundaries-crossed",114,2,1.5,1/3,2],["black-white-plasma-storm",116,8/3,1,1/3,1.5],["black-white-plasma-freeze",117,2,4/3,1/3,1],["black-white-plasma-blast",118,2,1,1/3,1.5]]) define(id,post,{ex:ex/36,fullArt:fa/36,secretRare:sr/36},{aceSpec:ace/36});
define("black-white-legendary-treasures",119,{ex:6/36,secretRare:1/108},{holoRare:.5},{rare:{rare:1-6/36-1/108,ex:6/36,secretRare:1/108},radiantPremium:.30});
export const VINTAGE_PULL_RATES = rates;

// These are product inserts, not random booster contents. Preserve their IDs
// in historical collections, but never fabricate a booster chance for them.
export const NON_BOOSTER_CARDS = {
  "base1-8": 2,
  "ex4-96": 38,
  "ex5-102": 40,
  "ex6-113": 44,
  "ex7-110": 47,
  "ex8-108": 48,
  "ex9-107": 51,
  "ex10-116": 52,
  "ex11-114": 54,
  "ex12-93": 55,
  "ex13-111": 57,
};
