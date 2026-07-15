import { extractCollectorNumbers } from "./extractCollectorNumbers.js";
import { extractNameCandidates } from "./extractNameCandidates.js";

function unique(values) { return [...new Set(values.filter(Boolean))]; }

// These fields are intentionally extracted independently of catalog support.
// Current PackDex scanner metadata has canonical name, collector number, set
// total, set/year, and rarity; it does not carry HP, attacks, abilities,
// stages/types, or regulation marks to safely index against.
export function extractStructuredCardText(rawText, textBlocks = []) {
  const text = String(rawText || "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hp = unique([...text.matchAll(/\b(?:HP\s*)?(\d{2,3})\s*HP\b|\bHP\s*(\d{2,3})\b/gi)].map((match) => match[1] || match[2]));
  const stageOrType = unique(lines.filter((line) => /\b(?:basic|stage\s*[12]|pokemon|trainer|supporter|item|stadium|energy)\b/i.test(line)).slice(0, 6));
  const abilityNames = unique(lines.flatMap((line, index) => /\bability\b/i.test(line) ? [line.replace(/^.*?ability\s*[:\-]?\s*/i, "") || lines[index + 1]] : []).slice(0, 4));
  const attackNames = unique(lines.filter((line) => /(?:\b\d{1,3}[+×]?\b|\b(?:weakness|resistance|retreat|ability|regulation|copyright|pok[eé]mon)\b)/i.test(line) === false && /^[A-Za-z][A-Za-z '\-]{2,40}$/.test(line)).slice(0, 6));
  const regulationMarks = unique([...text.matchAll(/\b(?:regulation\s*)?([A-H])\b/gi)].map((match) => match[1].toUpperCase()));
  const copyrightYears = unique([...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) => match[1]));
  return {
    nameCandidates: extractNameCandidates(rawText, textBlocks),
    collectorNumbers: extractCollectorNumbers(rawText, textBlocks),
    hp,
    abilityNames,
    attackNames,
    stageOrType,
    regulationMarks,
    copyrightYears,
  };
}
