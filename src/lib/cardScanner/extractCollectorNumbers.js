import { normalizeCollectorNumber } from "./normalizeScannerText.js";

const YEAR = /^(?:19\d{2}|20\d{2})$/;
const BOTTOM_PASS = /^collector-bottom/;
function correctPart(value) {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const prefix = compact.match(/^(TG|GG|SV|XY|SWSH)/)?.[0] || "";
  const tail = compact.slice(prefix.length).replace(/[O]/g, "0").replace(/[IL]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
  return `${prefix}${tail}`;
}
function parseSegment(text, sourcePass = "full-card") {
  const normalizedText = String(text || "").normalize("NFKC").replace(/[／⁄]/g, "/"); const results = []; const occupied = [];
  const paired = /\b((?:TG|GG|SV|XY|SWSH)?\s*[A-Z0-9]{1,5})\s*\/\s*((?:TG|GG|SV|XY|SWSH)?\s*[A-Z0-9]{1,5})\b/gi;
  for (const match of normalizedText.matchAll(paired)) {
    const cardNumber = correctPart(match[1]), printedSetTotal = correctPart(match[2]);
    if (!/\d/.test(cardNumber) || !/\d/.test(printedSetTotal) || YEAR.test(cardNumber)) continue;
    const prefix = cardNumber.match(/^[A-Z]+/)?.[0] || "";
    results.push({ raw: match[0], cardNumber, printedSetTotal, prefix, numericComponent: Number(cardNumber.match(/\d+/)?.[0]), normalized: normalizeCollectorNumber(cardNumber), normalizedTotal: normalizeCollectorNumber(printedSetTotal), sourcePass }); occupied.push([match.index, match.index + match[0].length]);
  }
  const standalone = /\b(?:TG|GG|SV|XY|SWSH)\s*[A-Z0-9]{1,5}\b|\b\d{1,3}\b/gi;
  for (const match of normalizedText.matchAll(standalone)) {
    if (occupied.some(([a, b]) => match.index >= a && match.index < b)) continue;
    const before = normalizedText.slice(Math.max(0, match.index - 5), match.index).toLowerCase(); const after = normalizedText.slice(match.index + match[0].length, match.index + match[0].length + 5).toLowerCase();
    const cardNumber = correctPart(match[0]); if (YEAR.test(cardNumber) || /hp\s*$/.test(before) || /^\s*(?:hp|damage)/.test(after)) continue;
    const prefix = cardNumber.match(/^[A-Z]+/)?.[0] || ""; if (!prefix && !BOTTOM_PASS.test(sourcePass) && sourcePass !== "full-card") continue;
    results.push({ raw: match[0], cardNumber, printedSetTotal: null, prefix, numericComponent: Number(cardNumber.match(/\d+/)?.[0]), normalized: normalizeCollectorNumber(cardNumber), normalizedTotal: null, sourcePass });
  }
  return results;
}

export function extractCollectorNumbers(rawText, textBlocks = []) {
  const segments = textBlocks.length ? textBlocks.map((block) => ({ text: block.text, sourcePass: block.sourcePass || "full-card" })) : [{ text: rawText, sourcePass: "full-card" }];
  const unique = new Map();
  for (const segment of segments) for (const result of parseSegment(segment.text, segment.sourcePass)) {
    const key = `${result.normalized}/${result.normalizedTotal || ""}`; const prior = unique.get(key);
    if (!prior || (BOTTOM_PASS.test(result.sourcePass) && !BOTTOM_PASS.test(prior.sourcePass))) unique.set(key, result);
  }
  return [...unique.values()];
}
