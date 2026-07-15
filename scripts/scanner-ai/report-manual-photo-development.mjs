import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const reportRoot = path.join(root, "artifacts", "scanner-ai", "reports", "manual-photos-20260715");
const read = async (relative) => JSON.parse(await fs.readFile(path.join(reportRoot, relative), "utf8"));
const [before, after, catalogManifest] = await Promise.all([
  read("current-frozen/diagnostics-with-embeddings.json"),
  read("orientation-ocr-layout/diagnostics-with-embeddings.json"),
  JSON.parse(await fs.readFile(path.join(root, "artifacts", "scanner-ai", "catalog-manifest.json"), "utf8")),
]);

// These IDs are transcribed from the supplied physical cards' visible name,
// set/collector number, and rarity, then resolved against the frozen catalog.
// The two absent McDonald's 2022 printings intentionally remain review items.
const labels = {
  "PXL_20260712_231921723.jpg": "xy12-55-diglett",
  "PXL_20260712_231928828.jpg": "xy11-111-gardevoir-ex",
  "PXL_20260712_231932641.jpg": "xy12-113-here_comes_team_rocket",
  "PXL_20260712_231937609.jpg": "xy12-113-here_comes_team_rocket",
  "PXL_20260712_231941495.jpg": "phantasmal-flames-13-mega-charizard-x-ex",
  "PXL_20260713_001746850.jpg": "xy11-54-nosepass",
  "PXL_20260715_022444857.jpg": "guardians-rising-135-tapu-koko-gx",
  "PXL_20260715_022450007.jpg": "guardians-rising-135-tapu-koko-gx",
  "PXL_20260715_022503914.MP.jpg": "xy1-30-m_blastoise-ex",
  "PXL_20260715_022506123.jpg": "xy1-30-m_blastoise-ex",
  "PXL_20260715_022522633.jpg": "xy10-116-glaceon-ex",
  "PXL_20260715_022523828.jpg": "xy10-116-glaceon-ex",
  "PXL_20260715_022540364.jpg": "xy3-109-battle_reporter",
  "PXL_20260715_022542145.jpg": "xy3-109-battle_reporter",
  "PXL_20260715_022544561.jpg": "xy3-109-battle_reporter",
  "PXL_20260715_022559832.MP.jpg": "ultra-prism-100-dialga-gx",
  "PXL_20260715_022601155.jpg": "ultra-prism-100-dialga-gx",
  "PXL_20260715_022612765.jpg": "mega-evolution-161-mega-absol-ex",
  "PXL_20260715_022614409.jpg": "mega-evolution-161-mega-absol-ex",
  "PXL_20260715_022622347.MP.jpg": "xy8-66-mismagius",
  "PXL_20260715_022623396.jpg": "xy8-66-mismagius",
  "PXL_20260715_022625179.jpg": "xy8-66-mismagius",
  "PXL_20260715_022629216.jpg": "xy6-94-wally",
  "PXL_20260715_022630909.jpg": "xy6-94-wally",
  "PXL_20260715_022632136.jpg": "xy6-94-wally",
  "PXL_20260715_022636032.jpg": "unbroken-bonds-89-golem",
  "PXL_20260715_022637644.jpg": "unbroken-bonds-89-golem",
  "PXL_20260715_022640806.jpg": "xy5-83-solrock",
  "PXL_20260715_022641771.jpg": "xy5-83-solrock",
  "PXL_20260715_022645998.jpg": "xy8-25-fennekin",
  "PXL_20260715_022646932.jpg": "xy8-25-fennekin",
  "PXL_20260715_022650182.jpg": "xy8-118-snorlax",
  "PXL_20260715_022651007.jpg": "xy8-118-snorlax",
  "PXL_20260715_022655408.MP.jpg": "xy11-83-druddigon",
  "PXL_20260715_022656438.jpg": "xy11-83-druddigon",
  "PXL_20260715_022659633.jpg": "xy10-67-mr._mime",
  "PXL_20260715_022700739.jpg": "xy10-67-mr._mime",
};
const review = {
  "PXL_20260715_022704308.jpg": { canonicalName: "Flaaffy", set: "McDonald's Collection 2022", collectorNumber: "9", printedSetTotal: "15", rarity: "Unknown", reason: "The exact McDonald's 2022 9/15 printing is not present in the frozen PackDex catalog." },
  "PXL_20260715_022705292.jpg": { canonicalName: "Flaaffy", set: "McDonald's Collection 2022", collectorNumber: "9", printedSetTotal: "15", rarity: "Unknown", reason: "The exact McDonald's 2022 9/15 printing is not present in the frozen PackDex catalog." },
};
const reflectiveOrFullArt = new Set([
  "PXL_20260712_231928828.jpg", "PXL_20260715_022444857.jpg", "PXL_20260715_022450007.jpg",
  "PXL_20260715_022503914.MP.jpg", "PXL_20260715_022506123.jpg", "PXL_20260715_022522633.jpg", "PXL_20260715_022523828.jpg",
  "PXL_20260715_022540364.jpg", "PXL_20260715_022542145.jpg", "PXL_20260715_022544561.jpg", "PXL_20260715_022612765.jpg", "PXL_20260715_022614409.jpg",
]);
const cards = new Map((catalogManifest.cards || []).map((card) => [card.cardId, card]));
const byFixture = (rows) => new Map(rows.map((row) => [row.fixture, row]));
const baseline = byFixture(before); const improved = byFixture(after);
const number = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
function displayedRank(reading, cardId) { const rank = (reading.result?.results || []).findIndex((candidate) => candidate.cardId === cardId); return rank < 0 ? null : rank + 1; }
function visualRank(reading, cardId) { const rank = (reading.visualRanking || []).findIndex((candidate) => candidate.cardId === cardId); return rank < 0 ? null : rank + 1; }
function identity(reading, cardId) {
  const card = cards.get(cardId); if (!card) throw new Error(`Label ${cardId} is absent from the frozen catalog.`);
  const displayRank = displayedRank(reading, cardId);
  return {
    expectedRank: displayRank || `>${(reading.result?.results || []).length}`,
    visualRank: visualRank(reading, cardId) || `>${(reading.visualRanking || []).length}`,
    top1: reading.result?.results?.[0]?.cardId || null,
    top3: (reading.result?.results || []).slice(0, 3).map(({ cardId: id }) => id),
    exactInCandidateList: (reading.candidatePool?.candidateIds || []).includes(cardId),
    similarity: number((reading.result?.results || []).find(({ cardId: id }) => id === cardId)?.visualScore || null),
    confidence: reading.result?.confidence || "low",
    candidatePoolSize: reading.candidatePool?.size || 0,
    candidatePoolMode: reading.candidatePool?.mode || null,
    card,
  };
}
function ocrEvidence(reading) { return {
  cardName: (reading.ocr?.nameCandidates || []).map(({ raw }) => raw).filter(Boolean),
  collectorNumber: (reading.ocr?.collectorNumbers || []).map(({ raw }) => raw).filter(Boolean),
  hp: reading.ocr?.structuredText?.hp || [], abilityNames: reading.ocr?.structuredText?.abilityNames || [], attackNames: reading.ocr?.structuredText?.attackNames || [],
  regulationMark: reading.ocr?.structuredText?.regulationMarks || [], stage: reading.ocr?.structuredText?.stageOrType || [],
}; }
function scanData(reading) { return {
  preprocessingMs: number(reading.timing?.preparationMs), ocrMs: number(reading.timing?.ocrMs), embeddingMs: number((reading.timing?.modelInitMs || 0) + (reading.timing?.inferenceMs || 0)), rankingMs: number((reading.timing?.candidateBuildMs || 0) + (reading.timing?.candidateSearchMs || 0) + (reading.timing?.fusionMs || 0) + (reading.timing?.orbMs || 0)), totalLatencyMs: reading.timing?.totalMs || null,
  quality: { glareScore: reading.scanQuality?.largestHighlightFraction ?? 0, blurEstimate: reading.scanQuality?.sharpnessEstimate ?? 0, cropConfidence: reading.diagnostics?.boundary?.found ? "boundary" : "fallback", boundaryStatus: reading.diagnostics?.boundary?.found ? "detected" : "not-detected", fallbackUsed: Boolean(reading.diagnostics?.boundary?.fallback), centeredFallbackUsed: reading.diagnostics?.boundary?.fallback === "centered-pokemon-card-aspect", ocrBudgetStatus: reading.ocr?.timedOut ? "exhausted" : "within-budget" },
  orientation: reading.diagnostics?.orientation || { detected: "unknown", rotationApplied: 0, evidence: null },
  ocrEvidence: ocrEvidence(reading),
}; }
function categoryFor(row) {
  const categories = []; const afterReading = row.after; const card = row.groundTruth;
  const raw = String(afterReading.ocr?.rawText || "").toLowerCase();
  if (afterReading.diagnostics?.orientation?.rotationApplied) categories.push("rotation");
  if (reflectiveOrFullArt.has(row.fixture)) categories.push("foil-or-full-art");
  if (afterReading.diagnostics?.boundary?.fallback) categories.push("boundary-or-crop-fallback");
  if (!raw.includes(String(card.name || "").replace(/[-.]/g, "").toLowerCase().slice(0, 5))) categories.push("OCR-name-failure");
  if (!(afterReading.ocr?.collectorNumbers || []).some(({ normalized }) => String(normalized) === String(card.collectorNumber).replace(/^0+/, ""))) categories.push("collector-number-failure");
  if ((afterReading.result?.results || []).some((result) => result.name === card.name) && row.afterRetrieval.top1 !== row.expectedCardId) categories.push("same-name-printing-confusion");
  if (row.afterRetrieval.candidatePoolMode === "full-catalog-fallback") categories.push("background-clutter-or-visual-ambiguity");
  return categories.length ? categories : ["visual-ambiguity"];
}
const manifest = after.map((afterReading) => {
  const fixture = afterReading.fixture; const beforeReading = baseline.get(fixture); const expectedCardId = labels[fixture] || null;
  if (!beforeReading) throw new Error(`Missing baseline for ${fixture}`);
  if (!expectedCardId) return { fixture, groundTruthStatus: "review-required", ...review[fixture], before: scanData(beforeReading), after: scanData(afterReading) };
  const groundTruth = cards.get(expectedCardId);
  const row = { fixture, groundTruthStatus: "labelled", expectedCardId, groundTruth: { cardId: expectedCardId, canonicalName: groundTruth.name, set: groundTruth.setName, collectorNumber: groundTruth.collectorNumber, printedSetTotal: groundTruth.printedSetTotal, rarity: groundTruth.rarity }, before: scanData(beforeReading), after: scanData(afterReading), beforeRetrieval: identity(beforeReading, expectedCardId), afterRetrieval: identity(afterReading, expectedCardId) };
  row.failureCategories = row.afterRetrieval.top1 === expectedCardId ? [] : categoryFor({ ...row, afterReading });
  return row;
});
const labelled = manifest.filter(({ groundTruthStatus }) => groundTruthStatus === "labelled");
const stats = (retrievalKey, scanKey) => {
  const rows = labelled.map((row) => row[retrievalKey]); const latencies = labelled.map((row) => row[scanKey].totalLatencyMs).filter(Number.isFinite);
  const top1 = rows.filter((_, index) => rows[index].top1 === labelled[index].expectedCardId).length;
  const top3 = rows.filter((_, index) => rows[index].top3.includes(labelled[index].expectedCardId)).length;
  return { cases: rows.length, top1, top3, top1Accuracy: top1 / rows.length, top3Accuracy: top3 / rows.length, meanLatencyMs: number(latencies.reduce((sum, value) => sum + value, 0) / latencies.length), worstLatencyMs: Math.max(...latencies) };
};
const beforeStats = stats("beforeRetrieval", "before"); const afterStats = stats("afterRetrieval", "after");
const regressions = labelled.filter((row) => row.beforeRetrieval.top1 === row.expectedCardId && row.afterRetrieval.top1 !== row.expectedCardId);
const top1Gains = labelled.filter((row) => row.beforeRetrieval.top1 !== row.expectedCardId && row.afterRetrieval.top1 === row.expectedCardId);
const counts = {}; for (const row of labelled.filter((row) => row.afterRetrieval.top1 !== row.expectedCardId)) for (const category of row.failureCategories) counts[category] = (counts[category] || 0) + 1;
const report = { corpus: { inputDirectory: "input", originalCount: after.length, labelledCount: labelled.length, reviewRequiredCount: manifest.length - labelled.length, protocol: "Original Pixel 6a files only; no training, augmentation, model, index, embedding, calibration, threshold, or confirmation-policy change." }, before: beforeStats, after: afterStats, regressionCheck: { top1Regressions: regressions.map(({ fixture }) => fixture), top1Gains: top1Gains.map(({ fixture }) => fixture) }, failureCategoryCounts: counts, manifest };
await fs.writeFile(path.join(reportRoot, "development-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(reportRoot, "development-benchmark-report.json"), `${JSON.stringify(report, null, 2)}\n`);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const markdown = `# Pixel 6a scanner development benchmark\n\n- Corpus: ${after.length} original camera photos; ${labelled.length} exact PackDex labels; ${manifest.length - labelled.length} review-required (McDonald's 2022 Flaaffy 9/15 is absent from the frozen catalog).\n- Frozen baseline top-1/top-3: ${percent(beforeStats.top1Accuracy)} / ${percent(beforeStats.top3Accuracy)}.\n- Orientation OCR/layout top-1/top-3: ${percent(afterStats.top1Accuracy)} / ${percent(afterStats.top3Accuracy)}.\n- Mean/worst latency: ${afterStats.meanLatencyMs} ms / ${afterStats.worstLatencyMs} ms (baseline ${beforeStats.meanLatencyMs} ms / ${beforeStats.worstLatencyMs} ms).\n\n## Change\n\nSideways landscape gallery scans now run two bounded portrait quarter-turn OCR/layout probes (90 and 270 degrees, 650 ms each) before boundary detection, OCR, and embedding. Selection never uses visual similarity. Portrait camera/preview inputs retain the existing boundary-first plus centered-fallback path.\n\n## Failure categories (after; categories may overlap)\n\n${Object.entries(counts).map(([name, count]) => `- ${name}: ${count}`).join("\n")}\n\n## Remaining limitation\n\nFull-art/foil photos often still lack reliable collector-number OCR after orientation, leaving same-name printings or a full-catalog visual search unresolved. The next bounded scanner improvement should target bottom-right collector-number OCR on an already selected crop; it must be accepted only if this corpus shows a gain without a normal-card regression.\n`;
await fs.writeFile(path.join(reportRoot, "development-benchmark-report.md"), markdown);
console.log(JSON.stringify({ before: beforeStats, after: afterStats, failureCategoryCounts: counts, reviewRequired: manifest.filter(({ groundTruthStatus }) => groundTruthStatus === "review-required").map(({ fixture }) => fixture) }, null, 2));
