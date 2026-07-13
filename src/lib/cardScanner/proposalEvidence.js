const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function scoreTextBlockLayout(blocks = [], width = 0, height = 0) {
  if (!(width > 0 && height > 0)) return 0;
  const boxes = blocks.filter(({ sourcePass, boundingBox }) => (!sourcePass || sourcePass === "full-card") && boundingBox)
    .map(({ boundingBox }) => ({
      left: Number(boundingBox.left), top: Number(boundingBox.top),
      right: Number(boundingBox.right), bottom: Number(boundingBox.bottom),
    })).filter((box) => Object.values(box).every(Number.isFinite));
  if (!boxes.length) return 0;
  const top = Math.min(...boxes.map((box) => box.top)) / height;
  const bottom = Math.max(...boxes.map((box) => box.bottom)) / height;
  const left = Math.min(...boxes.map((box) => box.left)) / width;
  const right = Math.max(...boxes.map((box) => box.right)) / width;
  const topNameRegion = top <= .28 ? 1 : Math.max(0, 1 - (top - .28) / .3);
  const verticalCoverage = Math.min(1, Math.max(0, bottom - top) / .55);
  const horizontalCoverage = Math.min(1, Math.max(0, right - left) / .55);
  return clamp(topNameRegion * .45 + verticalCoverage * .35 + horizontalCoverage * .2);
}

export function scoreProposalEvidence({ proposal, ocrMatch, lightweight, blocks = [] } = {}) {
  const candidates = lightweight?.candidates || [];
  const topVisual = candidates[0] || null;
  const secondVisual = candidates[1] || null;
  const visualLead = topVisual ? Math.max(0, topVisual.score - (secondVisual?.score || 0)) : 0;
  const ocrTop = ocrMatch?.results?.[0] || null;
  const ocrVisualRank = ocrTop ? candidates.findIndex(({ cardId }) => cardId === ocrTop.cardId) + 1 : 0;
  const compatible = Boolean(ocrTop && ocrVisualRank > 0 && ocrVisualRank <= 40);
  const geometry = clamp(proposal?.geometryScore);
  const visualStrength = clamp(topVisual?.score);
  const ocrStrength = clamp((ocrTop?.score || 0) / 110);
  const textClusterScore = scoreTextBlockLayout(blocks, proposal?.width, proposal?.height);
  let score = geometry * .12 + visualStrength * .27 + Math.min(1, visualLead / .1) * .11 + ocrStrength * .27 + textClusterScore * .08;
  if (compatible) score += .2 * (1 - Math.min(39, ocrVisualRank - 1) / 78);
  if (ocrTop?.reasons?.some((reason) => reason.includes("collector number"))) score += .05;
  if (proposal?.isFallback) score -= .16;
  return {
    proposalId: proposal?.id || null,
    score: clamp(score),
    geometry,
    topVisualId: topVisual?.cardId || null,
    topVisualScore: topVisual?.score || 0,
    visualLead,
    ocrTopId: ocrTop?.cardId || null,
    ocrScore: ocrTop?.score || 0,
    ocrVisualRank,
    compatible,
    textClusterScore,
  };
}

export function rankProposalEvidence(proposalRuns = []) {
  return proposalRuns.map((run) => ({ ...run, evidence: scoreProposalEvidence(run) }))
    .sort((left, right) => right.evidence.score - left.evidence.score || left.proposal.id.localeCompare(right.proposal.id));
}

export function rankFinalProposalRuns(proposalRuns = []) {
  const confidence = { high: 1, medium: .62, low: 0 };
  return proposalRuns.map((run) => {
    const result = run.fusedMatch?.results?.[0] || null;
    const resultId = result?.cardId || null;
    const orb = run.visualMatch?.orb?.candidates?.find(({ cardId }) => cardId === resultId) || null;
    const finalScore = clamp(
      (run.evidence?.score || scoreProposalEvidence(run).score) * .2
      + clamp((result?.score || 0) / 100) * .34
      + (confidence[run.fusedMatch?.confidence] || 0) * .2
      + clamp(orb?.score) * .2
      + Math.min(1, (orb?.inliers || 0) / 35) * .06,
    );
    return { ...run, finalScore, resultId, orbForResult: orb };
  }).filter(({ resultId }) => resultId).sort((left, right) => right.finalScore - left.finalScore || left.proposal.id.localeCompare(right.proposal.id));
}
