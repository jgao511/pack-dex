import { normalizeCollectorNumber } from "./normalizeScannerText.js";

const YEAR = /^(?:1999|20(?:2[4-6]))$/;

export function extractCollectorNumbers(rawText) {
  const text = String(rawText ?? "").normalize("NFKC").replace(/[／⁄]/g, "/");
  const results = [];
  const occupied = [];
  const paired = /\b([A-Za-z]{0,5}\d{1,4})\s*\/\s*([A-Za-z]{0,5}\d{1,4})\b/g;
  for (const match of text.matchAll(paired)) {
    const cardNumber = match[1].replace(/\s+/g, "").toUpperCase();
    const printedSetTotal = match[2].replace(/\s+/g, "").toUpperCase();
    const prefix = cardNumber.match(/^[A-Z]+/)?.[0] || "";
    results.push({ raw: match[0], cardNumber, printedSetTotal, prefix, numericComponent: Number(cardNumber.match(/\d+/)?.[0]), normalized: normalizeCollectorNumber(cardNumber), normalizedTotal: normalizeCollectorNumber(printedSetTotal) });
    occupied.push([match.index, match.index + match[0].length]);
  }
  const standalone = /\b(?:TG|GG|SV|XY|SWSH)\s*\d{1,4}\b|\b\d{1,3}\b/gi;
  for (const match of text.matchAll(standalone)) {
    if (occupied.some(([a, b]) => match.index >= a && match.index < b)) continue;
    const cardNumber = match[0].replace(/\s+/g, "").toUpperCase();
    if (YEAR.test(cardNumber)) continue;
    const prefix = cardNumber.match(/^[A-Z]+/)?.[0] || "";
    results.push({ raw: match[0], cardNumber, printedSetTotal: null, prefix, numericComponent: Number(cardNumber.match(/\d+/)?.[0]), normalized: normalizeCollectorNumber(cardNumber), normalizedTotal: null });
  }
  return results;
}
