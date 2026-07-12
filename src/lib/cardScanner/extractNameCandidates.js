import { normalizeCardName } from "./normalizeScannerText.js";

export function extractNameCandidates(rawText) {
  return String(rawText ?? "").split(/\r?\n/).map((line) => ({ raw: line.trim(), normalized: normalizeCardName(line) }))
    .filter(({ normalized }) => normalized.length >= 3 && /[a-z]/.test(normalized) && !/^(?:copyright|pokemon|creatures|nintendo|inc)(?: |$)/.test(normalized));
}
