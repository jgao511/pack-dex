const EVOLUTION_SUFFIX = /\b(?:ex|gx|v|vmax|vstar|break|lv\s*x|level\s*x|legend|star|δ|delta\s*species)\b$/i;
const CATALOG_LABEL_SUFFIX = /\b(?:mega\s+hyper|mega\s+att|radiant|hyper)\b$/i;
const OWNER_MARK_SUFFIX = /\s+(?:g|c|gl|fb|e4)$/i;
const LEADING_FORMS = /^(?:(?:m|mega|primal|alolan|galarian|hisuian|paldean|dark|light|shining|radiant|ultra|flying|surfing|bloodmoon|teal\s+mask|hearthflame\s+mask|wellspring\s+mask|cornerstone\s+mask|origin\s+forme?|therian\s+forme?|dusk\s+mane|dawn\s+wings|ice\s+rider|shadow\s+rider|rapid\s+strike|single\s+strike|white|black)\s+)+/i;
const TRAILING_FORMS = /\s+(?:x|y|sandy\s+cloak|trash\s+cloak|plant\s+cloak)$/i;

export function normalizeExploreText(value) {
  return String(value || "")
    .replace(/â™€/g, " female ")
    .replace(/â™‚/g, " male ")
    .replace(/â€™/g, "'")
    .replace(/Ã©/g, "é")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/♀/g, " female ")
    .replace(/♂/g, " male ")
    .replace(/&/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function createSpeciesLookup(pokemon, aliases = {}) {
  const lookup = new Map(Object.entries(aliases).map(([name, id]) => [normalizeExploreText(name), Number(id)]));
  for (const species of pokemon || []) {
    [species.name, species.displayName, ...(species.forms || [])].forEach((name) => {
      const key = normalizeExploreText(name);
      if (key && !lookup.has(key)) lookup.set(key, species.id);
    });
  }
  return lookup;
}

export function getCardSpeciesCandidates(cardName) {
  return String(cardName || "")
    .split(/\s+(?:&|and)\s+|\s*\/\s*/i)
    .map((part) => part.replace(/â€™/g, "'").replace(/^(?:[^’']+)[’']s\s+/i, "").replace(/^team\s+(?:aquas|magmas)\s+/i, "").trim())
    .map((part) => {
      let candidate = normalizeExploreText(part);
      let previous = "";
      while (candidate && candidate !== previous) {
        previous = candidate;
        candidate = candidate.replace(CATALOG_LABEL_SUFFIX, "").trim();
        candidate = candidate.replace(EVOLUTION_SUFFIX, "").trim();
      }
      candidate = candidate.replace(OWNER_MARK_SUFFIX, "").replace(LEADING_FORMS, "").replace(TRAILING_FORMS, "").trim();
      return candidate;
    })
    .filter(Boolean);
}

export function mapCardNameToSpeciesIds(cardName, lookup) {
  const ids = getCardSpeciesCandidates(cardName)
    .map((candidate) => lookup.get(candidate))
    .filter(Number.isInteger);
  return [...new Set(ids)];
}

export function buildEvolutionTree(chain, speciesById) {
  if (!chain?.species?.length) return [];
  const childrenByParent = new Map();
  for (const entry of chain.species) {
    const parentId = entry.evolvesFromId || 0;
    const children = childrenByParent.get(parentId) || [];
    children.push(entry.id);
    childrenByParent.set(parentId, children);
  }
  const visit = (id) => ({ species: speciesById.get(id), children: (childrenByParent.get(id) || []).map(visit) });
  return (childrenByParent.get(0) || []).map(visit);
}

export function getUniqueOwnershipProgress(cards, collection, getCardKey) {
  const uniqueCards = new Map((cards || []).map((entry) => [`${entry.set.id}:${entry.card.id}`, entry]));
  const owned = [...uniqueCards.values()].filter(({ set, card }) => Number(collection?.[set.id]?.[getCardKey(card, set.id)]?.count || 0) > 0).length;
  const total = uniqueCards.size;
  return { owned, total, missing: Math.max(0, total - owned), percent: total ? Math.round((owned / total) * 100) : 0 };
}
