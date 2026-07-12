import { sets } from "../../data/sets.js";
import { normalizeCardName, normalizeCollectorNumber } from "./normalizeScannerText.js";

function deriveTotals(cards) {
  const values = new Map();
  for (const card of cards) {
    const match = String(card.number || "").toUpperCase().match(/^([A-Z]*)(\d+)$/);
    if (match) (values.get(match[1]) || values.set(match[1], new Set()).get(match[1])).add(Number(match[2]));
  }
  const derived = Object.fromEntries([...values].map(([prefix, numbers]) => {
    let total = 0; while (numbers.has(total + 1)) total += 1;
    return [prefix, total || Math.max(...numbers)];
  }));
  const numericCards = cards.map((card) => ({ number: Number(card.number), rarity: String(card.rarity || "").toLowerCase() }))
    .filter((item) => Number.isInteger(item.number)).sort((a, b) => a.number - b.number);
  const isSecretRarity = (item) => /^(?:ultra rare|illustration rare|special illustration rare|hyper rare)/.test(item.rarity);
  const firstSecretIndex = numericCards.findIndex((item, index) => item.number > 20 && numericCards.slice(index, index + 5).length === 5 && numericCards.slice(index, index + 5).every(isSecretRarity));
  if (firstSecretIndex >= 0 && numericCards[firstSecretIndex].number <= derived[""]) derived[""] = numericCards[firstSecretIndex].number - 1;
  return derived;
}

export function buildScannerCatalog(sourceSets = sets) {
  return sourceSets.flatMap((set) => {
    const totals = deriveTotals(set.cards || []);
    return (set.cards || []).map((card) => {
      const normalizedNumber = normalizeCollectorNumber(card.number);
      const prefix = normalizedNumber.match(/^[A-Z]+/)?.[0] || "";
      return {
        cardId: String(card.id), apiCardId: card.apiCardId || card.pokemonTcgId || null,
        card, name: card.name, normalizedName: normalizeCardName(card.name), cardNumber: String(card.number), normalizedNumber,
        printedSetTotal: String(set.printedTotal ?? totals[prefix] ?? ""), setId: set.id, setName: set.name,
        series: set.series || set.era || null, releaseYear: set.releaseDate ? Number(set.releaseDate.slice(0, 4)) : null,
        rarity: card.rarity || null, imageUrl: card.image || null, priceReferenceIds: [card.id, card.apiCardId].filter(Boolean),
      };
    });
  });
}

let cached;
export function getScannerCatalog() { return cached ||= buildScannerCatalog(); }
