const SIZE = 32;
const HASH_WIDTH = 8;
const REGIONS = Object.freeze({
  full: Object.freeze([0, 0, 1, 1]),
  top: Object.freeze([0, 0, 1, .27]),
  artwork: Object.freeze([0, .18, 1, .63]),
  lower: Object.freeze([0, .57, 1, 1]),
});

// Compact v2 layout. Color is intentionally retained only once and at a low
// comparison weight because lighting and foil treatments make it unreliable.
export const VISUAL_DESCRIPTOR_SCHEMA = Object.freeze({
  version: 2,
  fields: Object.freeze([
    "full.pHash", "full.edgeHash", "full.colorHistogram",
    "top.pHash", "top.edgeHash",
    "artwork.pHash", "artwork.edgeHash",
    "lower.pHash", "lower.edgeHash",
    "contrastNormalized.pHash", "contrastNormalized.edgeHash",
  ]),
});

const COSINES = Array.from({ length: HASH_WIDTH }, (_, frequency) => (
  Float64Array.from({ length: SIZE }, (_, position) => Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * SIZE)))
));

function median(values) { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]; }
function bitsToHex(bits) {
  let result = "";
  for (let offset = 0; offset < bits.length; offset += 4) {
    let value = 0;
    for (let bit = 0; bit < 4; bit += 1) value = (value << 1) | Number(bits[offset + bit]);
    result += value.toString(16);
  }
  return result;
}
function bytesToBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]; const b = bytes[index + 1]; const c = bytes[index + 2];
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += index + 1 < bytes.length ? alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] : "=";
    output += index + 2 < bytes.length ? alphabet[c & 63] : "=";
  }
  return output;
}
function base64ToBytes(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(value || "").replace(/=+$/, ""); const output = [];
  let buffer = 0; let bits = 0;
  for (const character of clean) { const digit = alphabet.indexOf(character); if (digit < 0) continue; buffer = (buffer << 6) | digit; bits += 6; if (bits >= 8) { bits -= 8; output.push((buffer >> bits) & 255); } }
  return Uint8Array.from(output);
}

function sampleRgba(rgba, width, height, [left, top, right, bottom] = REGIONS.full) {
  const rgb = new Uint8Array(SIZE * SIZE * 3); const gray = new Uint8Array(SIZE * SIZE);
  const regionWidth = Math.max(1, (right - left) * width); const regionHeight = Math.max(1, (bottom - top) * height);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const sourceX = Math.max(0, Math.min(width - 1, Math.floor(left * width + (x + .5) * regionWidth / SIZE)));
    const sourceY = Math.max(0, Math.min(height - 1, Math.floor(top * height + (y + .5) * regionHeight / SIZE)));
    const source = (sourceY * width + sourceX) * 4; const target = (y * SIZE + x) * 3;
    const r = rgba[source]; const g = rgba[source + 1]; const b = rgba[source + 2];
    rgb[target] = r; rgb[target + 1] = g; rgb[target + 2] = b;
    gray[y * SIZE + x] = Math.round(r * .299 + g * .587 + b * .114);
  }
  return { rgb, gray };
}

function normalizeContrast(gray) {
  const sorted = Uint8Array.from(gray).sort();
  const low = sorted[Math.floor(sorted.length * .05)];
  const high = sorted[Math.floor(sorted.length * .95)];
  if (high <= low + 2) return Uint8Array.from(gray);
  return Uint8Array.from(gray, (value) => Math.round(Math.max(0, Math.min(1, (value - low) / (high - low))) * 255));
}

function perceptualHash(gray) {
  const rows = Array.from({ length: SIZE }, () => new Float64Array(HASH_WIDTH));
  for (let y = 0; y < SIZE; y += 1) for (let frequency = 0; frequency < HASH_WIDTH; frequency += 1) {
    let total = 0; for (let x = 0; x < SIZE; x += 1) total += gray[y * SIZE + x] * COSINES[frequency][x]; rows[y][frequency] = total;
  }
  const coefficients = [];
  for (let vertical = 0; vertical < HASH_WIDTH; vertical += 1) for (let horizontal = 0; horizontal < HASH_WIDTH; horizontal += 1) {
    let total = 0; for (let y = 0; y < SIZE; y += 1) total += rows[y][horizontal] * COSINES[vertical][y]; coefficients.push(total);
  }
  const threshold = median(coefficients.slice(1));
  return bitsToHex(coefficients.map((value, index) => index === 0 || value >= threshold));
}
function edgeHash(gray) {
  const averages = Array.from({ length: 8 }, () => new Float64Array(9));
  for (let row = 0; row < 8; row += 1) for (let column = 0; column < 9; column += 1) {
    const yStart = Math.floor(row * SIZE / 8); const yEnd = Math.floor((row + 1) * SIZE / 8);
    const xStart = Math.floor(column * SIZE / 9); const xEnd = Math.max(xStart + 1, Math.floor((column + 1) * SIZE / 9));
    let total = 0; let count = 0;
    for (let y = yStart; y < yEnd; y += 1) for (let x = xStart; x < xEnd; x += 1) { total += gray[y * SIZE + x]; count += 1; }
    averages[row][column] = total / count;
  }
  return bitsToHex(averages.flatMap((columns) => Array.from({ length: 8 }, (_, column) => columns[column] < columns[column + 1])));
}
function colorHistogram(rgb) {
  const histogram = new Uint32Array(24); const pixels = rgb.length / 3;
  for (let offset = 0; offset < rgb.length; offset += 3) { histogram[Math.min(7, rgb[offset] >> 5)] += 1; histogram[8 + Math.min(7, rgb[offset + 1] >> 5)] += 1; histogram[16 + Math.min(7, rgb[offset + 2] >> 5)] += 1; }
  return bytesToBase64(Uint8Array.from(histogram, (count) => Math.round(count * 255 / pixels)));
}
function hashes(sample) { return [perceptualHash(sample.gray), edgeHash(sample.gray)]; }

export function calculateVisualDescriptorFromRgba(rgba, width, height) {
  if (!(rgba?.length && width > 0 && height > 0)) throw new TypeError("RGBA image dimensions are required.");
  const full = sampleRgba(rgba, width, height, REGIONS.full);
  const [fullPHash, fullEdgeHash] = hashes(full);
  const top = hashes(sampleRgba(rgba, width, height, REGIONS.top));
  const artwork = hashes(sampleRgba(rgba, width, height, REGIONS.artwork));
  const lower = hashes(sampleRgba(rgba, width, height, REGIONS.lower));
  const contrast = hashes({ gray: normalizeContrast(full.gray) });
  return [fullPHash, fullEdgeHash, colorHistogram(full.rgb), ...top, ...artwork, ...lower, ...contrast];
}

function hashSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return 0; let different = 0;
  for (let index = 0; index < left.length; index += 1) { let value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16); while (value) { different += value & 1; value >>= 1; } }
  return 1 - different / (left.length * 4);
}
function histogramSimilarity(left, right) {
  const a = base64ToBytes(left); const b = base64ToBytes(right); let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) { dot += a[index] * b[index]; aa += a[index] ** 2; bb += b[index] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function compareVisualDescriptors(query, candidate) {
  const pHash = hashSimilarity(query?.[0], candidate?.[0]);
  const edgeHash = hashSimilarity(query?.[1], candidate?.[1]);
  const color = histogramSimilarity(query?.[2], candidate?.[2]);
  // Version-one manifests remain readable during development and cache migration.
  if ((query?.length || 0) < VISUAL_DESCRIPTOR_SCHEMA.fields.length || (candidate?.length || 0) < VISUAL_DESCRIPTOR_SCHEMA.fields.length) {
    return { score: pHash * .64 + edgeHash * .32 + color * .04, pHash, edgeHash, color, schemaVersion: 1 };
  }
  const top = { pHash: hashSimilarity(query[3], candidate[3]), edgeHash: hashSimilarity(query[4], candidate[4]) };
  const artwork = { pHash: hashSimilarity(query[5], candidate[5]), edgeHash: hashSimilarity(query[6], candidate[6]) };
  const lower = { pHash: hashSimilarity(query[7], candidate[7]), edgeHash: hashSimilarity(query[8], candidate[8]) };
  const contrastNormalized = { pHash: hashSimilarity(query[9], candidate[9]), edgeHash: hashSimilarity(query[10], candidate[10]) };
  const score = pHash * .18 + edgeHash * .13 + color * .03
    + top.pHash * .15 + top.edgeHash * .11
    + artwork.pHash * .14 + artwork.edgeHash * .11
    + lower.pHash * .04 + lower.edgeHash * .03
    + contrastNormalized.pHash * .05 + contrastNormalized.edgeHash * .03;
  return { score, pHash, edgeHash, color, top, artwork, lower, contrastNormalized, schemaVersion: 2 };
}

/** Hot-path score used by full-catalog search without allocating diagnostic objects per card. */
export function scoreVisualDescriptors(query, candidate) {
  const pHash = hashSimilarity(query?.[0], candidate?.[0]);
  const edgeHash = hashSimilarity(query?.[1], candidate?.[1]);
  const color = histogramSimilarity(query?.[2], candidate?.[2]);
  if ((query?.length || 0) < VISUAL_DESCRIPTOR_SCHEMA.fields.length || (candidate?.length || 0) < VISUAL_DESCRIPTOR_SCHEMA.fields.length) {
    return pHash * .64 + edgeHash * .32 + color * .04;
  }
  return pHash * .18 + edgeHash * .13 + color * .03
    + hashSimilarity(query[3], candidate[3]) * .15 + hashSimilarity(query[4], candidate[4]) * .11
    + hashSimilarity(query[5], candidate[5]) * .14 + hashSimilarity(query[6], candidate[6]) * .11
    + hashSimilarity(query[7], candidate[7]) * .04 + hashSimilarity(query[8], candidate[8]) * .03
    + hashSimilarity(query[9], candidate[9]) * .05 + hashSimilarity(query[10], candidate[10]) * .03;
}

/** Broad structural recall score; the worker fully reranks its bounded result. */
export function scoreVisualDescriptorsCoarse(query, candidate) {
  return hashSimilarity(query?.[0], candidate?.[0]) * .3
    + hashSimilarity(query?.[1], candidate?.[1]) * .22
    + hashSimilarity(query?.[3], candidate?.[3]) * .2
    + hashSimilarity(query?.[4], candidate?.[4]) * .14
    + hashSimilarity(query?.[5], candidate?.[5]) * .14;
}
