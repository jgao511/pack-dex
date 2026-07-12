const SIZE = 32;
const HASH_WIDTH = 8;
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
function sampleRgba(rgba, width, height) {
  const rgb = new Uint8Array(SIZE * SIZE * 3); const gray = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const sourceX = Math.min(width - 1, Math.floor((x + .5) * width / SIZE));
    const sourceY = Math.min(height - 1, Math.floor((y + .5) * height / SIZE));
    const source = (sourceY * width + sourceX) * 4; const target = (y * SIZE + x) * 3;
    const r = rgba[source]; const g = rgba[source + 1]; const b = rgba[source + 2];
    rgb[target] = r; rgb[target + 1] = g; rgb[target + 2] = b;
    gray[y * SIZE + x] = Math.round(r * .299 + g * .587 + b * .114);
  }
  return { rgb, gray };
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
export function calculateVisualDescriptorFromRgba(rgba, width, height) {
  if (!(rgba?.length && width > 0 && height > 0)) throw new TypeError("RGBA image dimensions are required.");
  const sampled = sampleRgba(rgba, width, height);
  return [perceptualHash(sampled.gray), edgeHash(sampled.gray), colorHistogram(sampled.rgb)];
}
function hashSimilarity(left, right) {
  if (left.length !== right.length) return 0; let different = 0;
  for (let index = 0; index < left.length; index += 1) { let value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16); while (value) { different += value & 1; value >>= 1; } }
  return 1 - different / (left.length * 4);
}
function histogramSimilarity(left, right) {
  const a = base64ToBytes(left); const b = base64ToBytes(right); let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) { dot += a[index] * b[index]; aa += a[index] ** 2; bb += b[index] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function compareVisualDescriptors(query, candidate) {
  const pHash = hashSimilarity(query[0], candidate[0]); const edgeHash = hashSimilarity(query[1], candidate[1]); const color = histogramSimilarity(query[2], candidate[2]);
  return { score: pHash * .55 + edgeHash * .25 + color * .2, pHash, edgeHash, color };
}
