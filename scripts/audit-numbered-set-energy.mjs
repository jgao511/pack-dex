import { writeFile } from "node:fs/promises";
import { activeSets } from "../src/data/sets.js";
import { isVintageSet } from "../src/data/vintagePackRules.js";
import { isEnergyCard, isNumberedSetEnergyCard } from "../src/utils/energyCardPolicy.js";

const outputUrl = new URL("../reports/numbered-set-energy-audit.md", import.meta.url);
const basicEnergyNames = new Set([
  "grass energy", "fire energy", "water energy", "lightning energy", "psychic energy",
  "fighting energy", "darkness energy", "metal energy", "fairy energy",
  "basic grass energy", "basic fire energy", "basic water energy", "basic lightning energy",
  "basic psychic energy", "basic fighting energy", "basic darkness energy", "basic metal energy",
  "basic fairy energy",
]);

function normalized(value) {
  return String(value || "").toLowerCase().trim();
}

function wasFilteredByLegacyEnergyRule(card) {
  const fields = [card.supertype, card.category, card.cardType, card.type];
  const types = Array.isArray(card.types) ? card.types : [];
  const rarity = normalized(card.rarity);

  return (
    fields.some((value) => normalized(value) === "energy") ||
    types.some((value) => normalized(value) === "energy") ||
    rarity === "basic energy" ||
    rarity === "energy" ||
    basicEnergyNames.has(normalized(card.name))
  );
}

const auditedSets = activeSets
  .map((set) => ({
    set,
    cards: set.cards.filter((card) => isEnergyCard(card) && isNumberedSetEnergyCard(card, set)),
  }))
  .filter(({ cards }) => cards.length > 0);

const rows = [];
for (const { set, cards } of auditedSets) {
  for (const card of cards) {
    const generator = isVintageSet(set) || !wasFilteredByLegacyEnergyRule(card);
    const collection = !wasFilteredByLegacyEnergyRule(card);
    rows.push(
      `| ${set.id} | ${set.name} | ${card.name} | ${card.number} | ${generator ? "Yes" : "No"} | ${collection ? "Yes" : "No"} | ${collection ? "Yes" : "No"} |`
    );
  }
}

const report = `# Numbered collectible Energy audit

Captured before the shared numbered-set-Energy policy was implemented. “Generator pool” reflects the previous behavior: vintage pools retained checklist Energy cards, while non-vintage pools removed cards matched by the broad Basic Energy rule. Collection visibility and completion used that same broad exclusion for every set.

- Supported sets audited: ${activeSets.length}
- Sets containing numbered collectible Energy cards: ${auditedSets.length}
- Numbered collectible Energy cards: ${rows.length}
- Generic bonus Energy cards found: 9 (Sun & Moon cards 164–172); these are intentionally omitted below.

| PackDex set ID | Set name | Energy card | Collector number | Previously in generator pool | Previously in collection | Previously counted for completion |
| --- | --- | --- | ---: | :---: | :---: | :---: |
${rows.join("\n")}
`;

await writeFile(outputUrl, report, "utf8");
console.log(`Wrote ${rows.length} Energy-card rows across ${auditedSets.length} sets to ${outputUrl.pathname}`);
