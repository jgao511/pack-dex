const DEFAULT_LIMIT = 20;

export function l2Normalize(values) {
  const vector = Array.from(values || [], Number);
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return vector.map(() => 0);
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return Number.NEGATIVE_INFINITY;
  let score = 0;
  for (let index = 0; index < a.length; index += 1) score += Number(a[index]) * Number(b[index]);
  return score;
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
  if (!query.length || query.length !== dimensions) return [];

  return (index?.cards || [])
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
