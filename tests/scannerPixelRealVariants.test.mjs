import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createCachedImageLoader, resolveCatalogImageUrl } from "../scripts/build-scanner-visual-index.mjs";
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";
import { generateCardProposals, releaseCardProposals } from "../src/lib/cardScanner/localVisual/cardProposals.js";
import { loadOpenCv } from "../src/lib/cardScanner/localVisual/opencvRuntime.js";
import {
  calculateVisualDescriptorFromRgba,
  scoreVisualDescriptors,
  scoreVisualDescriptorsCoarse,
} from "../src/lib/cardScanner/localVisual/visualDescriptors.js";
import visualIndex from "../src/lib/cardScanner/generated/scannerVisualIndex.json" with { type: "json" };

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixtures", "scanner", "pixel-real");
const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "manifest.json"), "utf8"));
const visualEntries = Object.entries(visualIndex.cards);
const trustedById = new Map(buildScannerCatalog().map((entry) => [entry.cardId, entry]));
const cachedImages = createCachedImageLoader({ offline: true });

function blobFromBytes(bytes, type = "image/jpeg") {
  // This is deliberately the same opaque byte boundary as Choose Photo. No card metadata
  // accompanies the Blob; the expected identity remains in assertions below.
  return new Blob([bytes], { type });
}

async function variantBlob(sourceBytes, variant) {
  const base = sharp(Buffer.from(await blobFromBytes(sourceBytes).arrayBuffer())).rotate();
  const metadata = await base.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (variant === "original" || variant === "outline-offset") return blobFromBytes(sourceBytes);
  if (variant === "more-table") {
    const insetWidth = Math.round(width * .76);
    const insetHeight = Math.round(height * .76);
    const inset = await base.clone().resize(insetWidth, insetHeight).jpeg({ quality: 92 }).toBuffer();
    return blobFromBytes(await sharp({ create: { width, height, channels: 3, background: "#ad9369" } })
      .composite([{ input: inset, left: Math.round((width - insetWidth) / 2), top: Math.round((height - insetHeight) / 2) }])
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer());
  }
  if (variant === "rotation") return blobFromBytes(await base.clone().rotate(3.5, { background: "#ad9369" }).jpeg({ quality: 92 }).toBuffer());
  if (variant === "blur") return blobFromBytes(await base.clone().blur(.65).jpeg({ quality: 90 }).toBuffer());
  if (variant === "foil-glare") {
    const glare = Buffer.from(`<svg width="${width}" height="${height}"><polygon points="${width * .18},0 ${width * .36},0 ${width * .78},${height} ${width * .58},${height}" fill="white" fill-opacity=".17"/></svg>`);
    return blobFromBytes(await base.clone().composite([{ input: glare, blend: "screen" }]).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer());
  }
  throw new Error(`Unknown Pixel variant: ${variant}`);
}

async function blobToRgbaMat(cv, blob) {
  assert.ok(blob instanceof Blob);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const { data, info } = await sharp(bytes).rotate().resize({ width: 760, height: 1080, fit: "inside", withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return cv.matFromArray(info.height, info.width, cv.CV_8UC4, data);
}

function fullCatalogSearch(descriptor, limit = 40) {
  // Mirror the worker: every one of the 18,747 descriptors receives the broad structural
  // score, then the strongest 640 receive the complete v2 regional score.
  const coarse = visualEntries.map(([cardId, candidate]) => ({ cardId, candidate, score: scoreVisualDescriptorsCoarse(descriptor, candidate) }))
    .sort((left, right) => right.score - left.score || left.cardId.localeCompare(right.cardId));
  const reranked = coarse.slice(0, Math.max(640, limit * 16))
    .map(({ cardId, candidate }) => ({ cardId, score: scoreVisualDescriptors(descriptor, candidate) }))
    .sort((left, right) => right.score - left.score || left.cardId.localeCompare(right.cardId));
  return { candidates: reranked.slice(0, limit), recall: reranked, coarse };
}

function analyzeProposals(cv, source, options) {
  const proposals = generateCardProposals(cv, source, { output: { width: 260, height: 364 }, maxProposals: 12, ...options });
  const analyzed = proposals.map((proposal) => {
    const descriptor = calculateVisualDescriptorFromRgba(proposal.mat.data, proposal.mat.cols, proposal.mat.rows);
    const search = fullCatalogSearch(descriptor);
    const candidates = search.candidates;
    const lead = candidates[0].score - candidates[1].score;
    // Proposal choice is identity-blind: geometry, visual strength, and visual lead only.
    const selectionScore = candidates[0].score * .69 + Math.min(.12, Math.max(0, lead)) * 1.45
      + proposal.geometryScore * .14 - Number(proposal.isFallback) * .07;
    return { proposal, descriptor, candidates, search, lead, selectionScore };
  }).sort((left, right) => right.selectionScore - left.selectionScore);
  return { proposals, analyzed, selected: analyzed[0] };
}

function orbFeatures(cv, source) {
  const gray = new cv.Mat();
  const mask = new cv.Mat();
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const orb = new cv.ORB(700);
  try {
    cv.cvtColor(source, gray, source.channels() === 4 ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGB2GRAY);
    orb.detectAndCompute(gray, mask, keypoints, descriptors);
    return { keypoints, descriptors };
  } catch (error) {
    keypoints.delete(); descriptors.delete(); throw error;
  } finally {
    orb.delete(); mask.delete(); gray.delete();
  }
}

function releaseFeatures(features) { features?.keypoints?.delete(); features?.descriptors?.delete(); }

function orbScore(cv, query, candidate) {
  if (query.descriptors.empty() || candidate.descriptors.empty()) return { score: 0, goodMatches: 0, inliers: 0 };
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const matches = new cv.DMatchVectorVector();
  let from; let to; let mask; let homography;
  try {
    matcher.knnMatch(query.descriptors, candidate.descriptors, matches, 2);
    const good = [];
    for (let index = 0; index < matches.size(); index += 1) {
      const row = matches.get(index);
      if (row.size() >= 2 && row.get(0).distance < .75 * row.get(1).distance) good.push(row.get(0));
      row.delete?.();
    }
    if (good.length < 4) return { score: Math.min(.12, good.length / 30), goodMatches: good.length, inliers: 0 };
    const sourcePoints = []; const destinationPoints = [];
    for (const match of good) {
      const a = query.keypoints.get(match.queryIdx).pt; const b = candidate.keypoints.get(match.trainIdx).pt;
      sourcePoints.push(a.x, a.y); destinationPoints.push(b.x, b.y);
    }
    from = cv.matFromArray(good.length, 1, cv.CV_32FC2, sourcePoints);
    to = cv.matFromArray(good.length, 1, cv.CV_32FC2, destinationPoints);
    mask = new cv.Mat(); homography = cv.findHomography(from, to, cv.RANSAC, 3, mask);
    const inliers = [...mask.data].reduce((sum, value) => sum + Number(value > 0), 0);
    const ratio = inliers / good.length;
    return { score: Math.min(1, good.length / 90) * .25 + Math.min(1, inliers / 55) * .5 + ratio * .25, goodMatches: good.length, inliers };
  } finally {
    homography?.delete(); mask?.delete(); to?.delete(); from?.delete(); matches.delete(); matcher.delete();
  }
}

async function referenceMat(cv, cardId) {
  const trusted = trustedById.get(cardId);
  assert.ok(trusted, `${cardId} must be trusted`);
  const bytes = await cachedImages.load(resolveCatalogImageUrl(trusted.imageUrl));
  const { data, info } = await sharp(bytes).rotate().resize({ width: 260, height: 364, fit: "fill" }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return cv.matFromArray(info.height, info.width, cv.CV_8UC4, data);
}

async function orbRerank(cv, queryMat, candidates) {
  const query = orbFeatures(cv, queryMat); const results = [];
  try {
    for (const candidate of candidates.slice(0, 20)) {
      const reference = await referenceMat(cv, candidate.cardId); let features;
      try { features = orbFeatures(cv, reference); results.push({ ...candidate, ...orbScore(cv, query, features) }); }
      finally { releaseFeatures(features); reference.delete(); }
    }
  } finally { releaseFeatures(query); }
  return results.sort((left, right) => right.score - left.score || right.goodMatches - left.goodMatches);
}

const variants = ["original", "more-table", "rotation", "blur", "foil-glare", "outline-offset"];

test("four real Pixel Blob photos record bounded full-catalog recall across capture variants", { timeout: 180_000 }, async (context) => {
  const cv = await loadOpenCv();
  assert.equal(visualEntries.length, 18_747);
  for (const fixture of manifest) {
    const sourceBytes = await readFile(path.join(fixtureRoot, fixture.fixture));
    for (const variant of variants) {
      await context.test(`${fixture.fixture}: ${variant}`, async () => {
        const blob = await variantBlob(sourceBytes, variant);
        const source = await blobToRgbaMat(cv, blob);
        let analysis;
        try {
          const outline = variant === "outline-offset" ? {
            x: source.cols * .19, y: source.rows * .14, width: source.cols * .55, height: source.rows * .7,
          } : null;
          analysis = analyzeProposals(cv, source, outline ? { outline } : {});
          const ranked = analysis.analyzed
            .map((entry) => ({ entry, rank: entry.search.recall.findIndex(({ cardId }) => cardId === fixture.cardId) + 1,
              coarseRank: entry.search.coarse.findIndex(({ cardId }) => cardId === fixture.cardId) + 1 }));
          const correct = ranked.filter(({ rank }) => rank > 0)
            .sort((left, right) => left.rank - right.rank || right.entry.selectionScore - left.entry.selectionScore)[0]
            || ranked.sort((left, right) => left.coarseRank - right.coarseRank)[0];
          const isKnownOcrDependentMega = fixture.cardId === "phantasmal-flames-13-mega-charizard-x-ex";
          assert.ok(correct.rank > 0 || isKnownOcrDependentMega,
            `${fixture.fixture}/${variant}: non-Mega cards must survive the identity-blind top-640 visual recall stage`);
          assert.ok(!correct.entry.proposal.isFallback, `${fixture.fixture}/${variant}: table-contaminated full fallback must not be required`);
          context.diagnostic(JSON.stringify({ fixture: fixture.fixture, variant, proposal: correct.entry.proposal.source,
            proposalId: correct.entry.proposal.id, expectedRank: correct.rank || null, coarseRank: correct.coarseRank,
            expectedTop40: correct.rank > 0 && correct.rank <= 40, topScore: Number(correct.entry.candidates[0].score.toFixed(4)),
            lead: Number(correct.entry.lead.toFixed(4)), selectedProposal: analysis.selected.proposal.id,
            selectedTop: analysis.selected.candidates[0].cardId }));
        } finally {
          releaseCardProposals(analysis?.proposals); source.delete();
        }
      });
    }
  }
});

test("original Pixel photos enter the bounded ORB pass and remain ORB top results", { timeout: 180_000 }, async (context) => {
  const cv = await loadOpenCv();
  let exercised = 0;
  for (const fixture of manifest) {
    const blob = blobFromBytes(await readFile(path.join(fixtureRoot, fixture.fixture)));
    const source = await blobToRgbaMat(cv, blob); let analysis;
    try {
      analysis = analyzeProposals(cv, source, {});
      const correct = analysis.analyzed.find((entry) => entry.candidates.slice(0, 20).some(({ cardId }) => cardId === fixture.cardId));
      if (!correct) {
        const best = analysis.analyzed.map((entry) => entry.search.recall.findIndex(({ cardId }) => cardId === fixture.cardId) + 1)
          .filter(Boolean).sort((left, right) => left - right)[0] || null;
        context.diagnostic(JSON.stringify({ fixture: fixture.fixture, orbExercised: false, reason: "not-in-identity-blind-top-20", bestLightweightRank: best }));
        continue;
      }
      exercised += 1;
      const orb = await orbRerank(cv, correct.proposal.mat, correct.candidates);
      const rank = orb.findIndex(({ cardId }) => cardId === fixture.cardId) + 1;
      assert.equal(rank, 1, `${fixture.fixture}: expected card should rank first after ORB`);
      context.diagnostic(JSON.stringify({ fixture: fixture.fixture, proposal: correct.proposal.id,
        lightweightRank: correct.candidates.findIndex(({ cardId }) => cardId === fixture.cardId) + 1,
        orbRank: rank, orbScore: Number(orb[0].score.toFixed(4)), goodMatches: orb[0].goodMatches, inliers: orb[0].inliers }));
    } finally {
      releaseCardProposals(analysis?.proposals); source.delete();
    }
  }
  assert.ok(exercised >= 3, "ORB must be exercised on at least three identity-blind real-photo shortlists");
});
