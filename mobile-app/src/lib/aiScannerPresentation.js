const MAX_USER_CANDIDATES = 3;

function exactPrinting(candidate) { return Boolean(candidate?.evidence?.exactCollector && candidate?.evidence?.printedTotal); }
function printingName(candidate) { return String(candidate?.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

export function getAiUserCandidates(scan) {
  return [...(scan?.result?.results || [])]
    // This only changes the selectable presentation order. Fusion confidence,
    // similarity, and automatic-confirmation policy remain frozen.
    .sort((left, right) => Number(exactPrinting(right)) - Number(exactPrinting(left)) || right.score - left.score)
    .slice(0, MAX_USER_CANDIDATES)
    .map((candidate, index) => ({ ...candidate, displayRank: index + 1 }));
}

export function getAiScanPresentation(scan) {
  const candidates = getAiUserCandidates(scan).map((candidate, index) => ({
    ...candidate,
    margin: index === 0 ? (scan?.result?.diagnostics?.fusedGap ?? null) : null,
  }));
  const sameNamePrintings = new Set(candidates.map(printingName)).size === 1 && candidates.length > 1;
  const printingUnresolved = Boolean(scan?.result?.safeNoResult && sameNamePrintings && !candidates.some(exactPrinting));
  if (scan?.result?.confirmedCardId) {
    return { kind: "high", title: "High-confidence match", candidates, printingUnresolved };
  }
  if (candidates.length) {
    return { kind: "possible", title: "Possible matches", candidates, printingUnresolved };
  }
  return { kind: "none", title: "No reliable match", candidates: [], printingUnresolved: false };
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
