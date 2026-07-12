import { extractCollectorNumbers } from "./extractCollectorNumbers.js";
import { extractNameCandidates } from "./extractNameCandidates.js";
import { getScannerCatalog } from "./buildScannerCatalog.js";
import { normalizeCardName, normalizeScannerText } from "./normalizeScannerText.js";

function editDistance(a, b) {
  const row = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) { let prev = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = old; } }
  return row[b.length];
}
function similarity(a, b) { return a && b ? 1 - editDistance(a, b) / Math.max(a.length, b.length) : 0; }
const NON_NAME_TOKENS = new Set(["mega", "stage", "evolves", "from", "rule", "pokemon", "energy", "weakness", "resistance", "retreat", "damage", "discard", "copyright", "creatures", "nintendo", "game", "freak"]);
function shortlistCatalog(catalog, collectors, names) {
  const numbers = new Set(collectors.map(({ normalized }) => normalized));
  const exactNames = new Set(names.map(({ normalized }) => normalized));
  const prefixes = new Set(names.flatMap(({ normalized }) => normalized.split(" ")).filter((token) => token.length >= 4 && !NON_NAME_TOKENS.has(token)).map((token) => token.slice(0, 4)));
  if (!numbers.size && !prefixes.size && !exactNames.size) return [];
  return catalog.filter((entry) => numbers.has(entry.normalizedNumber) || exactNames.has(entry.normalizedName) || entry.normalizedName.split(" ").some((token) => token.length >= 4 && prefixes.has(token.slice(0, 4))));
}

export function rankCardMatches({ rawText = "", textBlocks = [], maxResults = 5 } = {}, catalog = getScannerCatalog()) {
  const normalized = normalizeScannerText(rawText);
  const collectors = extractCollectorNumbers(rawText, textBlocks);
  const names = extractNameCandidates(rawText, textBlocks);
  const scored = shortlistCatalog(catalog, collectors, names).map((entry) => {
    let score = 0; const reasons = [];
    const number = collectors.find((item) => item.normalized === entry.normalizedNumber);
    if (number) { score += entry.normalizedNumber.match(/^[A-Z]/) ? 58 : 50; if (/^collector-bottom/.test(number.sourcePass)) score += 8; reasons.push(`${entry.normalizedNumber.match(/^[A-Z]/) ? "exact prefixed collector number" : "exact collector number"} (${number.sourcePass})`); }
    if (number?.printedSetTotal && number.normalizedTotal === String(entry.printedSetTotal).toUpperCase()) { score += 25; reasons.push("exact printed set total"); }
    let bestName = 0; let corrected = false; let nameFromTop = false;
    for (const candidate of names) { const exact = candidate.normalized === entry.normalizedName; const sim = similarity(candidate.normalized, entry.normalizedName); if (exact || sim > bestName) { bestName = exact ? 1 : sim; nameFromTop = candidate.sourcePass === "name-top"; } if (!exact && sim >= .82 && /0|1/.test(candidate.raw)) corrected = true; }
    if (bestName === 1) { score += 30; reasons.push("exact normalized name"); }
    else if (bestName >= .82) { score += Math.round(25 * bestName); reasons.push("strong name similarity"); if (corrected) reasons.push("possible OCR correction"); }
    if (bestName >= .82 && nameFromTop) { score += 5; reasons.push("name read from top crop"); }
    return { entry, score, reasons };
  }).filter((item) => item.score >= 23).sort((a, b) => b.score - a.score || a.entry.cardId.localeCompare(b.entry.cardId));
  const top = scored[0]; const gap = top && scored[1] ? top.score - scored[1].score : top?.score || 0;
  let confidence = "low";
  const hasNumber = top?.reasons.some((r) => r.includes("collector number"));
  const hasSupport = top?.reasons.some((r) => r === "exact printed set total" || r.includes("name"));
  if (top && top.score >= 75 && hasNumber && hasSupport && gap >= 12) confidence = "high";
  else if (top && top.score >= 45 && gap >= 5) confidence = "medium";
  const strongIntersection = scored.some((item) => item.reasons.some((r) => r.includes("collector number")) && item.reasons.includes("exact printed set total") && item.reasons.some((r) => r.includes("name")));
  const defensible = scored.filter((item) => strongIntersection
    ? item.reasons.some((r) => r.includes("collector number")) && item.reasons.includes("exact printed set total") && item.reasons.some((r) => r.includes("name"))
    : item.reasons.some((r) => r.includes("name") || r.includes("printed set total") || r.includes("prefixed collector")));
  const results = defensible.slice(0, Math.max(1, Math.min(3, maxResults))).map(({ entry, score, reasons }, index) => ({ cardId: entry.cardId, card: entry.card, score, confidence: index === 0 ? confidence : "low", reasons, setId: entry.setId, setName: entry.setName, printedSetTotal: entry.printedSetTotal }));
  return { ...normalized, collectorNumbers: collectors, nameCandidates: names, narrowedSetIds: [...new Set(defensible.map((item) => item.entry.setId))], narrowedCardIds: defensible.map((item) => item.entry.cardId), confidence, scoreGap: gap, primaryMatch: confidence === "high" ? results[0] : null, results };
}
