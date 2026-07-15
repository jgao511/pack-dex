import { normalizeCardName } from "./normalizeScannerText.js";

function editDistance(left, right) {
  const row = [...Array(right.length + 1).keys()];
  for (let i = 1; i <= left.length; i += 1) { let prior = row[0]; row[0] = i; for (let j = 1; j <= right.length; j += 1) { const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prior + (left[i - 1] === right[j - 1] ? 0 : 1)); prior = old; } }
  return row[right.length];
}

function correctBoundedPokemonName(value) {
  if (!/\bmega\b/i.test(value)) return value;
  let corrected = value.replace(/[A-Za-z]{6,11}/g, (token) => editDistance(token.toLowerCase(), "charizard") <= 2 ? "Charizard" : token);
  corrected = corrected.replace(/\bCharizard([XY])\b/i, "Charizard $1").replace(/\b([XY])\s+e[A-Z0-9]?\b/i, "$1 ex");
  return corrected;
}

export function extractNameCandidates(rawText, textBlocks = []) {
  const segments = textBlocks.length
    ? [...textBlocks].sort((a, b) => Number(b.sourcePass === "name-top") - Number(a.sourcePass === "name-top")).map((block) => ({ text: block.text, sourcePass: block.sourcePass || "full-card" }))
    : [{ text: rawText, sourcePass: "full-card" }];
  const expanded = segments.flatMap(({ text, sourcePass }) => {
    const lines = String(text ?? "").split(/\r?\n/);
    const linesAndJoins = lines.flatMap((line, index) => index + 1 < lines.length ? [line, `${line} ${lines[index + 1]}`] : [line]);
    return linesAndJoins.flatMap((line) => {
      const clean = correctBoundedPokemonName(line.trim()
        .replace(/\s*(?:HP)?\s*\d{2,3}\s*$/i, "")
        .replace(/\s+(?:supporter|item|stadium|tool)\s*$/i, "")
        .replace(/\bXeA\s*$/i, "X ex"));
      const variants = [clean];
      const charizard = clean.match(/\b(?:Mega\s+)?Charizard(?:\s+[XY])?(?:\s+ex)?/i)?.[0];
      if (charizard) variants.push(charizard, charizard.replace(/\s+ex$/i, ""));
      return [...new Set(variants)].map((value) => ({ value, sourcePass }));
    });
  });
  return expanded.map(({ value, sourcePass }) => ({ raw: value.trim(), normalized: normalizeCardName(value), sourcePass }))
    .filter(({ normalized }) => normalized.length >= 3 && /[a-z]/.test(normalized) && !/^(?:copyright|pokemon|creatures|nintendo|inc)(?: |$)/.test(normalized));
}
