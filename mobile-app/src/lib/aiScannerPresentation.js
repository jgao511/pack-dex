const MAX_USER_CANDIDATES = 3;

export function getAiScanPresentation(scan) {
  const candidates = (scan?.result?.results || []).slice(0, MAX_USER_CANDIDATES).map((candidate, index) => ({
    ...candidate,
    margin: index === 0 ? (scan?.result?.diagnostics?.fusedGap ?? null) : null,
  }));
  if (scan?.result?.confirmedCardId) {
    return { kind: "high", title: "High-confidence match", candidates };
  }
  if (candidates.length) {
    return { kind: "possible", title: "Possible matches", candidates };
  }
  return { kind: "none", title: "No reliable match", candidates: [] };
}

export function getAiQualityGuidance(quality = {}) {
  const guidance = [];
  if (quality.glareWarning) guidance.push("Glare detected — tilt the card or reduce overhead reflection.");
  if ((quality.cropAreaFraction ?? 1) < 0.4) guidance.push("Move closer so the card fills more of the frame.");
  if (Number.isFinite(quality.sharpnessEstimate) && quality.sharpnessEstimate < 12) guidance.push("Hold steadier before scanning again.");
  if (Number.isFinite(quality.meanLuminance) && quality.meanLuminance < 65) guidance.push("Improve lighting so the card text is visible.");
  if (quality.progressiveResult) guidance.push("The OCR time budget ended; these are early candidates.");
  return guidance;
}

export function canRetryAiFoilScan(scan) {
  return Boolean(scan?.scanQuality?.glareWarning || !scan?.result?.confirmedCardId);
}

export function isAiSelectionExplicit(selection) {
  return Boolean(selection?.cardId);
}
