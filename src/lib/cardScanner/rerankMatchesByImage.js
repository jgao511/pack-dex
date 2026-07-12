/**
 * Optional second-stage image reranker.
 *
 * The OCR/catalog matcher remains authoritative. A future on-device image
 * embedding implementation may reorder only this already-filtered shortlist;
 * it must not introduce cards that were not supplied by the matcher.
 */
export async function rerankMatchesByImage(photo, candidates, reranker) {
  const shortlist = Array.isArray(candidates) ? candidates : [];

  if (!photo || typeof reranker !== "function" || shortlist.length < 2) {
    return shortlist;
  }

  const allowedIds = new Set(shortlist.map((candidate) => candidate.card?.id));
  const reranked = await reranker(photo, shortlist);

  if (!Array.isArray(reranked) || reranked.length !== shortlist.length) {
    return shortlist;
  }

  const returnedIds = reranked.map((candidate) => candidate.card?.id);
  const isSameShortlist =
    new Set(returnedIds).size === allowedIds.size &&
    returnedIds.every((id) => allowedIds.has(id));

  return isSameShortlist ? reranked : shortlist;
}
