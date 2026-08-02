function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

const BASIC_ENERGY_NAMES = new Set([
  "grass energy",
  "fire energy",
  "water energy",
  "lightning energy",
  "psychic energy",
  "fighting energy",
  "darkness energy",
  "metal energy",
  "fairy energy",
  "basic grass energy",
  "basic fire energy",
  "basic water energy",
  "basic lightning energy",
  "basic psychic energy",
  "basic fighting energy",
  "basic darkness energy",
  "basic metal energy",
  "basic fairy energy",
]);

function hasEnergyMetadata(card = {}) {
  const energyFields = [card.supertype, card.category, card.cardType, card.type];
  const types = Array.isArray(card.types) ? card.types : [];
  const rarity = normalizeText(card.rarity);

  return (
    energyFields.some((value) => normalizeText(value) === "energy") ||
    types.some((value) => normalizeText(value) === "energy") ||
    rarity === "basic energy" ||
    rarity === "energy"
  );
}

function hasLegacyEnergyName(name) {
  return (
    /\benergy(?:\s+(?:hyper|ace spec))?$/u.test(name) ||
    /^holon energy (?:ff|gl|wp)$/u.test(name) ||
    /^(?:blend|unit) energy \S+$/u.test(name) ||
    /^(?:super boost|beast) energy ◇$/u.test(name)
  );
}

export function isEnergyCard(card = {}) {
  const name = normalizeText(card.name);

  // Older local datasets predate the supertype field. Requiring an Energy-style
  // name ending as well as checklist membership below keeps Trainer cards such as
  // Energy Search and Energy Retrieval out of this policy.
  return (
    hasEnergyMetadata(card) ||
    BASIC_ENERGY_NAMES.has(name) ||
    hasLegacyEnergyName(name)
  );
}

export function getCollectorNumber(card = {}) {
  const value = String(card.number ?? card.printedNumber ?? card.collectorNumber ?? "").trim();
  return /^[a-z]{0,4}\d+[a-z]?$/iu.test(value) ? value : "";
}

function numericCollectorNumber(card = {}) {
  const collectorNumber = getCollectorNumber(card);
  const match = collectorNumber.match(/^(\d+)/u);
  return match ? Number(match[1]) : null;
}

function getSetId(set = {}) {
  return String(set.id || set.setId || "").trim();
}

function cardBelongsToSet(card = {}, set = {}) {
  const setId = getSetId(set);
  const cardSetId = String(card.setId || card.set_id || "").trim();

  if (setId && cardSetId && setId !== cardSetId) return false;
  if (!Array.isArray(set.cards) || set.cards.length === 0) return true;

  return set.cards.some((candidate) => {
    if (card.id && candidate?.id) return String(candidate.id) === String(card.id);
    return getCollectorNumber(candidate) === getCollectorNumber(card) && candidate?.name === card.name;
  });
}

function officialChecklistLimit(set = {}) {
  for (const value of [set.officialChecklistTotal, set.total]) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }

  return null;
}

function isVerifiedSecretAbovePrintedTotal(card = {}) {
  const rarity = normalizeText(card.rarity);
  return /secret|hyper|rainbow|ultra/u.test(rarity) || card.isSecretRare === true;
}

export function isNumberedSetEnergyCard(card = {}, set = {}) {
  if (!isEnergyCard(card) || !getCollectorNumber(card)) return false;
  if (card.officialChecklist === false || card.isBonusEnergy === true) return false;
  if (!cardBelongsToSet(card, set)) return false;

  const number = numericCollectorNumber(card);
  const checklistLimit = officialChecklistLimit(set);

  if (number !== null && checklistLimit !== null) return number <= checklistLimit;

  const printedTotal = Number(set.printedTotal);
  if (number !== null && Number.isInteger(printedTotal) && printedTotal > 0 && number > printedTotal) {
    // Printed totals commonly omit genuine secret cards. A high-rarity card that
    // is present in this set's dataset remains collectible unless the set supplies
    // the stricter officialChecklistTotal boundary above.
    return isVerifiedSecretAbovePrintedTotal(card);
  }

  return true;
}

export function isGenericBonusEnergyCard(card = {}, set = {}) {
  return isEnergyCard(card) && !isNumberedSetEnergyCard(card, set);
}

export function isCollectibleSetCard(card = {}, set = {}) {
  if (normalizeText(card.name).includes("code card")) return false;
  return !isGenericBonusEnergyCard(card, set);
}
