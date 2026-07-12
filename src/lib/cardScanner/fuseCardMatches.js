import { getScannerCatalog } from "./buildScannerCatalog.js";

const clamp = (value) => Math.max(0, Math.min(1, value));

export function fuseCardMatches(ocrMatch, visualMatch, catalog = getScannerCatalog()) {
  if (!visualMatch?.lightweight?.candidates?.length) return ocrMatch;
  const entries = new Map(catalog.map((entry) => [entry.cardId, entry]));
  const ocrById = new Map((ocrMatch?.results || []).map((result) => [result.cardId, result]));
  const lightById = new Map(visualMatch.lightweight.candidates.map((result) => [result.cardId, result]));
  const orbById = new Map((visualMatch.orb?.candidates || []).map((result) => [result.cardId, result]));
  const ocrTopId = ocrMatch?.results?.[0]?.cardId; const visualTopId = visualMatch.lightweight.candidates[0]?.cardId;
  const ids = [...new Set([...lightById.keys(), ...ocrById.keys()])];
  const scored = ids.map((cardId) => {
    const entry = entries.get(cardId); if (!entry) return null;
    const ocr = ocrById.get(cardId); const light = lightById.get(cardId); const orb = orbById.get(cardId);
    const ocrScore = clamp((ocr?.score || 0) / 110); const lightScore = light?.score || 0; const orbScore = orb?.score || 0;
    let fusedScore = ocr ? ocrScore * .44 + lightScore * .26 + orbScore * .3 : lightScore * .48 + orbScore * .52;
    if (ocrTopId && visualTopId && ocrTopId === visualTopId && cardId === ocrTopId) fusedScore += .08;
    if (ocrTopId && visualTopId && ocrTopId !== visualTopId && (cardId === ocrTopId || cardId === visualTopId)) fusedScore -= .04;
    const reasons = [...(ocr?.reasons || [])];
    if (light) reasons.push(`local visual ${(lightScore * 100).toFixed(1)}%`);
    if (orb) reasons.push(`ORB/RANSAC ${(orbScore * 100).toFixed(1)}% (${orb.inliers} inliers)`);
    return { entry, ocr, light, orb, score: clamp(fusedScore), reasons };
  }).filter(Boolean).filter((item) => item.ocr || item.light?.score >= .72 || item.orb?.score >= .18).sort((a, b) => b.score - a.score || a.entry.cardId.localeCompare(b.entry.cardId));
  const top = scored[0]; const second = scored[1]; const gap = top ? top.score - (second?.score || 0) : 0;
  const lightGap = top?.light ? top.light.score - (visualMatch.lightweight.candidates.find((item) => item.cardId !== top.entry.cardId)?.score || 0) : 0;
  const orbGap = top?.orb ? top.orb.score - (visualMatch.orb.candidates.find((item) => item.cardId !== top.entry.cardId)?.score || 0) : 0;
  const ocrHasNumber = top?.ocr?.reasons?.some((reason) => reason.includes("collector number"));
  const ocrHasSupport = top?.ocr?.reasons?.some((reason) => reason.includes("name") || reason.includes("printed set total"));
  const agreement = top && top.entry.cardId === ocrTopId && top.entry.cardId === visualTopId;
  let confidence = "low";
  if (top && agreement && ocrHasNumber && ocrHasSupport && top.score >= .68 && gap >= .06) confidence = "high";
  else if (top && top.light?.score >= .9 && top.orb?.score >= .35 && lightGap >= .06 && orbGap >= .1 && (!ocrTopId || ocrTopId === top.entry.cardId)) confidence = "high";
  else if (top && top.score >= .52 && gap >= .03 && (top.ocr || top.light?.score >= .8 || top.orb?.score >= .18)) confidence = "medium";
  const defensible = confidence === "low" && (!top || top.score < .46 || gap < .015) ? [] : scored.slice(0, 3);
  const results = defensible.map((item, index) => ({ cardId: item.entry.cardId, card: item.entry.card, setId: item.entry.setId, setName: item.entry.setName, printedSetTotal: item.entry.printedSetTotal, score: Math.round(item.score * 100), confidence: index === 0 ? confidence : "low", reasons: item.reasons, visualEvidence: { lightweight: item.light?.score || 0, orb: item.orb?.score || 0, inliers: item.orb?.inliers || 0 } }));
  return { ...ocrMatch, confidence, scoreGap: Math.round(gap * 100), primaryMatch: confidence === "high" ? results[0] : null, results, visualMatch: { topLightweightId: visualTopId || null, topOcrId: ocrTopId || null, agreement, lightGap, orbGap } };
}
