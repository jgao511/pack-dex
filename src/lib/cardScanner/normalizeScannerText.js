const NOISE = /\b(?:copyright|pok(?:e|é|Ã©)mon|creatures|nintendo|trademark|all rights reserved|inc)\b/gi;

export function normalizeScannerText(value) {
  const rawText = String(value ?? "");
  return {
    rawText,
    normalizedText: rawText
      .normalize("NFKC")
      .replace(/[／⁄]/g, "/")
      .replace(NOISE, " ")
      .toLowerCase()
      .replace(/\s*\/\s*/g, "/")
      .replace(/[^\p{L}\p{N}/'&+.-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

export function normalizeCardName(value) {
  return String(value ?? "").normalize("NFKD").toLowerCase()
    .replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeCollectorNumber(value) {
  const match = String(value ?? "").normalize("NFKC").trim().toUpperCase().match(/^([A-Z]*)(0*\d+)$/);
  return match ? `${match[1]}${Number(match[2])}` : String(value ?? "").trim().toUpperCase();
}
