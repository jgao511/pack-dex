import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSetAssetUrl } from "../src/utils/assetUrls.js";
import { generatePack, getRarityCategory } from "../src/utils/packGenerator.js";
import { sets } from "../src/data/sets.js";
import { getVintagePackRule, VINTAGE_PACK_RULES } from "../src/data/vintagePackRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const EXPECTED_SET_IDS = [
  "base-set",
  "jungle",
  "fossil",
  "base-set-2",
  "team-rocket",
  "gym-heroes",
  "gym-challenge",
  "neo-genesis",
  "neo-discovery",
  "neo-revelation",
  "neo-destiny",
  "legendary-collection",
  "expedition-base-set",
  "aquapolis",
  "skyridge",
  "ex-ruby-sapphire",
  "ex-sandstorm",
  "ex-dragon",
  "ex-team-magma-vs-team-aqua",
  "ex-hidden-legends",
  "ex-firered-leafgreen",
  "ex-team-rocket-returns",
  "ex-deoxys",
  "ex-emerald",
  "ex-unseen-forces",
  "ex-delta-species",
  "ex-legend-maker",
  "ex-holon-phantoms",
  "ex-crystal-guardians",
  "ex-dragon-frontiers",
  "ex-power-keepers",
  "diamond-pearl",
  "diamond-pearl-mysterious-treasures",
  "diamond-pearl-secret-wonders",
  "diamond-pearl-great-encounters",
  "diamond-pearl-majestic-dawn",
  "diamond-pearl-legends-awakened",
  "diamond-pearl-stormfront",
  "platinum",
  "platinum-rising-rivals",
  "platinum-supreme-victors",
  "platinum-arceus",
  "heartgold-soulsilver",
  "hs-unleashed",
  "hs-undaunted",
  "hs-triumphant",
  "call-of-legends",
  "black-white",
  "black-white-emerging-powers",
  "black-white-noble-victories",
  "black-white-next-destinies",
  "black-white-dark-explorers",
  "black-white-dragons-exalted",
  "dragon-vault",
  "black-white-boundaries-crossed",
  "black-white-plasma-storm",
  "black-white-plasma-freeze",
  "black-white-plasma-blast",
  "black-white-legendary-treasures",
];

const VALID_RARITY_CATEGORIES = new Set(["common", "uncommon", "rare", "holoRare", "ultraRare", "secretRare"]);
const MODERN_ONLY_RARITIES = [
  "Illustration Rare",
  "Special Illustration Rare",
  "Hyper Rare",
  "Double Rare",
  "Mega Hyper Rare",
  "Mega Double Rare",
];

function fail(message, details = "") {
  throw new Error(details ? `${message}\n${details}` : message);
}

function getSet(id) {
  return sets.find((set) => set.id === id);
}

function countConfiguredBasicEnergy(pack, rule) {
  const basicEnergyFileNames = new Set(rule?.basicEnergyFileNames || []);

  return pack.filter((card) => basicEnergyFileNames.has(card.fileName)).length;
}

function countByCategory(pack, category, set) {
  return pack.filter((card) => getRarityCategory(card, set) === category).length;
}

function auditSetData() {
  const missingSets = EXPECTED_SET_IDS.filter((id) => !getSet(id));
  if (missingSets.length) fail("Missing vintage sets.", missingSets.join(", "));

  const extraRules = Object.keys(VINTAGE_PACK_RULES).filter((id) => !EXPECTED_SET_IDS.includes(id));
  if (extraRules.length) fail("Unexpected vintage pack rules.", extraRules.join(", "));

  const problems = [];

  for (const id of EXPECTED_SET_IDS) {
    const set = getSet(id);
    const logoPath = path.join(repoRoot, "public", "set-logos", `${id}.png`);

    if (!fs.existsSync(logoPath)) problems.push(`${id}: missing local logo ${logoPath}`);
    if (!getVintagePackRule(set)) problems.push(`${id}: missing vintage pack rule`);
    if (!set.cards?.length) problems.push(`${id}: no cards`);

    const seen = new Set();
    for (const card of set.cards || []) {
      const key = `${card.number}:${card.name}:${card.fileName}`;
      const imagePath = card.image || "";
      const imageUrl = getSetAssetUrl(imagePath);
      const category = getRarityCategory(card, set);

      if (seen.has(key)) problems.push(`${id}: duplicate card ${key}`);
      seen.add(key);
      if (!imagePath.startsWith(`sets/${id}/cards/`)) problems.push(`${id}: invalid image path ${imagePath}`);
      if (imageUrl.includes("/sets/sets/")) problems.push(`${id}: doubled sets path ${imageUrl}`);
      if (!VALID_RARITY_CATEGORIES.has(category)) problems.push(`${id}: unmapped rarity ${card.rarity} on ${card.number} ${card.name}`);
      if (MODERN_ONLY_RARITIES.includes(card.rarity)) problems.push(`${id}: modern-only rarity label ${card.rarity}`);
    }
  }

  if (problems.length) fail("Vintage data audit failed.", problems.slice(0, 80).join("\n"));
}

function auditPackRules() {
  const checks = [
    ["base-set", 11, 2],
    ["base-set-2", 11, 2],
    ["gym-heroes", 11, 1],
    ["gym-challenge", 11, 1],
    ["neo-genesis", 11, 1],
    ["dragon-vault", 5, null],
  ];

  for (const [id, expectedSize, expectedEnergy] of checks) {
    const set = getSet(id);
    const pack = generatePack(set);
    const rule = getVintagePackRule(set);

    if (pack.length !== expectedSize) fail(`${id}: expected ${expectedSize} cards, got ${pack.length}`);
    if (expectedEnergy !== null && countConfiguredBasicEnergy(pack, rule) !== expectedEnergy) {
      fail(`${id}: expected ${expectedEnergy} Basic Energy cards, got ${countConfiguredBasicEnergy(pack, rule)}`);
    }
  }

  for (const id of ["jungle", "fossil", "team-rocket", "neo-discovery", "neo-revelation", "neo-destiny"]) {
    const set = getSet(id);
    const pack = generatePack(set);

    if (pack.length !== 11) fail(`${id}: expected 11 cards, got ${pack.length}`);
  }

  const baseSet = getSet("base-set");
  const basePack = generatePack(baseSet);
  const dce = basePack.find((card) => card.fileName === "96_Double_Colorless_Energy_Uncommon.png");
  if (dce && getRarityCategory(dce, baseSet) !== "uncommon") fail("Base Set Double Colorless Energy was not treated as Uncommon.");

  for (const id of EXPECTED_SET_IDS) {
    const set = getSet(id);
    const pack = generatePack(set);
    const rareCount = countByCategory(pack, "rare", set) + countByCategory(pack, "holoRare", set) + countByCategory(pack, "ultraRare", set) + countByCategory(pack, "secretRare", set);

    if (rareCount < 1) fail(`${id}: generated pack has no final rare/chase card.`);
  }
}

auditSetData();
auditPackRules();

console.log(`Vintage audit passed for ${EXPECTED_SET_IDS.length} sets.`);
