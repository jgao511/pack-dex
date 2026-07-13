const DEFAULT_LIMIT = 20;

function float16ToNumber(value) {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >>> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

export function decodeFloat16LittleEndian(buffer) {
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : new Uint8Array(buffer?.buffer || buffer || new ArrayBuffer(0), buffer?.byteOffset || 0, buffer?.byteLength);
  if (bytes.byteLength % 2 !== 0) throw new TypeError("Float16 embedding data must contain an even number of bytes.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Float32Array(bytes.byteLength / 2);
  for (let offset = 0; offset < bytes.byteLength; offset += 2) output[offset / 2] = float16ToNumber(view.getUint16(offset, true));
  return output;
}

/**
 * Validates and materializes the generated typed-array catalog index once,
 * when the scanner-AI screen opens. Scan-time search never fetches artifacts.
 */
export function createTypedEmbeddingIndex(metadata, vectorBuffer) {
  const dimensions = Number(metadata?.dimensions || 0);
  const cardIds = Array.from(metadata?.cardIds || []);
  const count = Number(metadata?.count ?? cardIds.length);
  const dtype = String(metadata?.dtype || "").toLowerCase();
  if (metadata?.schemaVersion !== 2) throw new TypeError(`Unsupported embedding index schema version: ${metadata?.schemaVersion ?? "missing"}.`);
  if (!String(metadata?.indexVersion || "").trim()) throw new TypeError("Embedding index version is required.");
  if (!String(metadata?.model?.version || metadata?.modelVersion || "").trim()) throw new TypeError("Embedding model version is required.");
  if (!String(metadata?.model?.sha256 || metadata?.model?.fileSha256 || "").trim()) throw new TypeError("Embedding model checksum is required.");
  if (metadata?.normalized !== true) throw new TypeError("Embedding index must explicitly declare L2-normalized vectors.");
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new TypeError("Embedding index dimensions must be a positive integer.");
  if (!Number.isInteger(count) || count <= 0 || cardIds.length !== count) throw new TypeError("Embedding index card count does not match its ordered card IDs.");
  if (new Set(cardIds).size !== cardIds.length || cardIds.some((cardId) => !String(cardId))) throw new TypeError("Embedding index card IDs must be unique and non-empty.");

  const bytes = vectorBuffer instanceof Uint8Array
    ? vectorBuffer
    : new Uint8Array(vectorBuffer?.buffer || vectorBuffer || new ArrayBuffer(0), vectorBuffer?.byteOffset || 0, vectorBuffer?.byteLength);
  let vectors;
  if (dtype === "float16-le") vectors = decodeFloat16LittleEndian(bytes);
  else if (dtype === "float32-le") {
    if (bytes.byteLength % 4 !== 0) throw new TypeError("Float32 embedding data must contain a multiple of four bytes.");
    vectors = new Float32Array(bytes.byteLength / 4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < bytes.byteLength; offset += 4) vectors[offset / 4] = view.getFloat32(offset, true);
  } else throw new TypeError(`Unsupported embedding index dtype: ${metadata?.dtype || "missing"}.`);
  if (vectors.length !== count * dimensions) throw new TypeError(`Embedding vector length ${vectors.length} does not match ${count} x ${dimensions}.`);
  const normTolerance = dtype === "float16-le" ? 0.02 : 0.005;
  for (let row = 0; row < count; row += 1) {
    let normSquared = 0;
    const offset = row * dimensions;
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      const value = Number(vectors[offset + dimension]);
      if (!Number.isFinite(value)) throw new TypeError(`Embedding vector ${row} contains a non-finite value.`);
      normSquared += value * value;
    }
    const norm = Math.sqrt(normSquared);
    if (!Number.isFinite(norm) || norm <= 0 || Math.abs(norm - 1) > normTolerance) {
      throw new TypeError(`Embedding vector ${row} is not L2-normalized (norm ${norm}).`);
    }
  }
  return {
    ...metadata,
    count,
    dimensions,
    cardIds,
    vectors,
    normalized: true,
    cardIdToIndex: new Map(cardIds.map((cardId, index) => [cardId, index])),
  };
}

export function l2Normalize(values) {
  const vector = Array.from(values || [], Number);
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return vector.map(() => 0);
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return Number.NEGATIVE_INFINITY;
  let score = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = Number(a[index]); const right = Number(b[index]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.NEGATIVE_INFINITY;
    score += left * right;
  }
  return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
}

export function decodeEmbeddingVector(entry) {
  if (Array.isArray(entry?.embedding)) return l2Normalize(entry.embedding);
  if (Array.isArray(entry?.vector)) return l2Normalize(entry.vector);
  return null;
}

export function searchEmbeddingIndex(queryEmbedding, index, options = {}) {
  const query = l2Normalize(queryEmbedding);
  const dimensions = options.dimensions || index?.dimensions || query.length;
  const limit = options.limit || DEFAULT_LIMIT;
  if (!query.length || query.length !== dimensions || query.some((value) => !Number.isFinite(value))
    || !query.some((value) => Math.abs(value) > 0)) return [];

  if (index?.vectors && Array.isArray(index?.cardIds)) {
    const requestedIds = options.candidateIds ? [...new Set(options.candidateIds)] : index.cardIds;
    const positions = requestedIds.map((cardId) => index.cardIdToIndex?.get(cardId)).filter(Number.isInteger);
    const results = [];
    for (const position of positions) {
      const vectorOffset = position * dimensions;
      let dot = 0;
      let magnitudeSquared = 0;
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        const value = Number(index.vectors[vectorOffset + dimension]);
        dot += query[dimension] * value;
        if (!index.normalized) magnitudeSquared += value * value;
      }
      const visualScore = index.normalized ? dot : magnitudeSquared > 0 ? dot / Math.sqrt(magnitudeSquared) : Number.NEGATIVE_INFINITY;
      if (visualScore >= (options.minSimilarity ?? -1)) {
        results.push({
          cardId: index.cardIds[position],
          visualScore,
          modelVersion: index.modelVersion || index.model?.version || null,
          indexVersion: index.indexVersion || null,
        });
      }
    }
    return results.sort((a, b) => b.visualScore - a.visualScore || a.cardId.localeCompare(b.cardId)).slice(0, limit);
  }

  const allowedIds = options.candidateIds ? new Set(options.candidateIds) : null;

  return (index?.cards || [])
    .filter((entry) => !allowedIds || allowedIds.has(entry.cardId))
    .map((entry) => {
      const embedding = decodeEmbeddingVector(entry);
      if (!embedding || embedding.length !== dimensions) return null;
      return {
        cardId: entry.cardId,
        visualScore: cosineSimilarity(query, embedding),
        modelVersion: index.modelVersion || null,
        indexVersion: index.indexVersion || null,
      };
    })
    .filter(Boolean)
    .filter((candidate) => candidate.visualScore >= (options.minSimilarity ?? -1))
    .sort((a, b) => b.visualScore - a.visualScore)
    .slice(0, limit);
}

export function summarizeEmbeddingRetrieval(candidates) {
  const [first, second] = candidates || [];
  return {
    topCardId: first?.cardId || null,
    topScore: first?.visualScore ?? null,
    margin: first && second ? first.visualScore - second.visualScore : null,
    candidateCount: candidates?.length || 0,
  };
}
