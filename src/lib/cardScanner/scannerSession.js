export function getScannerResultMode(match) {
  if (match?.confidence === "high" && match.primaryMatch) return "high";
  if (match?.confidence === "medium" && match.results?.length) return "medium";
  return "low";
}

export function getTrustedCandidate(match, cardId) {
  return match?.results?.find((result) => result.cardId === cardId && result.card && String(result.card.id) === String(cardId)) || null;
}

export function confirmTrustedCandidate(match, cardId) {
  const candidate = getTrustedCandidate(match, cardId);
  if (!candidate) return null;
  return { cardId: candidate.cardId, card: candidate.card, setId: candidate.setId, setName: candidate.setName };
}

export function releaseTemporaryImage(image) { image?.release?.(); }
