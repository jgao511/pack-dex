import { normalizeCardName } from "./normalizeScannerText.js";

export function extractNameCandidates(rawText) {
  const lines = String(rawText ?? "").split(/\r?\n/);
  const expanded = lines.flatMap((line) => {
    const clean = line.trim().replace(/\s*(?:HP)?\s*\d{2,3}\s*$/i, "").replace(/\bXeA\s*$/i, "X ex");
    const variants = [clean];
    const charizard = clean.match(/\b(?:Mega\s+)?Charizard(?:\s+[XY])?(?:\s+ex)?/i)?.[0];
    if (charizard) {
      variants.push(charizard, charizard.replace(/\s+ex$/i, ""), charizard.replace(/^Mega\s+/i, "").replace(/\s+[XY](?:\s+ex)?$/i, ""));
    }
    return [...new Set(variants)];
  });
  return expanded.map((line) => ({ raw: line.trim(), normalized: normalizeCardName(line) }))
    .filter(({ normalized }) => normalized.length >= 3 && /[a-z]/.test(normalized) && !/^(?:copyright|pokemon|creatures|nintendo|inc)(?: |$)/.test(normalized));
}
