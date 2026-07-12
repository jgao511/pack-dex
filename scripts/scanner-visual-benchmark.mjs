import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import cvModule from "@techstark/opencv-js";
import sharp from "sharp";
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const fixtureRoot = path.join(projectRoot, "tests", "fixtures", "scanner");
const manifestPath = path.join(fixtureRoot, "visual-benchmark-cards.json");
const reportJsonPath = path.join(projectRoot, "reports", "scanner-visual-benchmark.json");
const reportMarkdownPath = path.join(projectRoot, "reports", "scanner-visual-benchmark.md");
const referenceTestPath = path.join(fixtureRoot, "mega-charizard-x-ex-013-094.jpg");
const expectedMegaId = "phantasmal-flames-13-mega-charizard-x-ex";
const targetWidth = 320;
const orbCandidateLimit = 8;
const generalVariations = [
  "exact",
  "shifted-outside-outline",
  "missing-margin",
  "perspective",
  "rotation",
  "blur",
  "jpeg",
  "brightness",
  "glare",
];
const megaAcceptanceVariations = [
  "direct-fixture",
  "file-blob-equivalent",
  "shifted-outside-outline",
  "missing-margin",
  "perspective",
  "rotation",
  "blur",
  "brightness",
  "glare",
];

async function getOpenCv() {
  if (cvModule instanceof Promise) return cvModule;
  if (cvModule.Mat) return cvModule;
  await new Promise((resolve) => { cvModule.onRuntimeInitialized = resolve; });
  return cvModule;
}

function normalizeWords(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizeWords(left));
  const b = new Set(normalizeWords(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / new Set([...a, ...b]).size;
}

async function ensureFixtureCache(cards) {
  const downloaded = [];
  const cacheHits = [];
  const failures = [];
  for (const card of cards) {
    const fixturePath = path.join(fixtureRoot, card.fixture);
    try {
      const metadata = await sharp(fixturePath).metadata();
      if (!metadata.width || !metadata.height) throw new Error("image has no dimensions");
      cacheHits.push(card.cardId);
      continue;
    } catch (cacheError) {
      if (!card.sourceUrl) {
        failures.push({ cardId: card.cardId, reason: cacheError.message, sourceUrl: null });
        continue;
      }
    }
    try {
      const response = await fetch(card.sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = Buffer.from(await response.arrayBuffer());
      await fs.mkdir(path.dirname(fixturePath), { recursive: true });
      await sharp(source).rotate().resize({ width: 480, withoutEnlargement: true })
        .jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toFile(fixturePath);
      downloaded.push(card.cardId);
    } catch (error) {
      failures.push({ cardId: card.cardId, reason: error.message, sourceUrl: card.sourceUrl });
    }
  }
  return { downloaded, cacheHits, failures };
}

async function loadRgbMat(cv, imagePath) {
  return decodeRgbBuffer(cv, await fs.readFile(imagePath));
}

async function decodeRgbBuffer(cv, buffer) {
  const { data, info } = await sharp(buffer).rotate().resize({ width: targetWidth }).removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  return cv.matFromArray(info.height, info.width, cv.CV_8UC3, data);
}

function calculatePerceptualHash(cv, rgb) {
  const gray = new cv.Mat();
  const small = new cv.Mat();
  try {
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    cv.resize(gray, small, new cv.Size(32, 32), 0, 0, cv.INTER_AREA);
    const coefficients = [];
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        if (!row && !column) continue;
        let coefficient = 0;
        for (let y = 0; y < 32; y += 1) {
          for (let x = 0; x < 32; x += 1) {
            coefficient += small.data[y * 32 + x]
              * Math.cos(((2 * x + 1) * column * Math.PI) / 64)
              * Math.cos(((2 * y + 1) * row * Math.PI) / 64);
          }
        }
        coefficients.push(coefficient);
      }
    }
    const median = [...coefficients].sort((a, b) => a - b)[Math.floor(coefficients.length / 2)];
    return Uint8Array.from(coefficients, (value) => Number(value >= median));
  } finally {
    gray.delete();
    small.delete();
  }
}

function calculateDifferenceHash(cv, rgb) {
  const gray = new cv.Mat();
  const small = new cv.Mat();
  try {
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    cv.resize(gray, small, new cv.Size(9, 8), 0, 0, cv.INTER_AREA);
    const bits = [];
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const offset = row * 9 + column;
        bits.push(Number(small.data[offset] >= small.data[offset + 1]));
      }
    }
    return Uint8Array.from(bits);
  } finally {
    gray.delete();
    small.delete();
  }
}

function calculateColorHistogram(rgb) {
  const histogram = new Float64Array(24);
  const pixels = rgb.rows * rgb.cols;
  for (let index = 0; index < rgb.data.length; index += 3) {
    histogram[Math.min(7, rgb.data[index] >> 5)] += 1;
    histogram[8 + Math.min(7, rgb.data[index + 1] >> 5)] += 1;
    histogram[16 + Math.min(7, rgb.data[index + 2] >> 5)] += 1;
  }
  return Float64Array.from(histogram, (value) => value / pixels);
}

function calculateOrbFeatures(cv, rgb) {
  const gray = new cv.Mat();
  const mask = new cv.Mat();
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const orb = new cv.ORB(600);
  try {
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    orb.detectAndCompute(gray, mask, keypoints, descriptors);
    return { keypoints, descriptors };
  } catch (error) {
    keypoints.delete();
    descriptors.delete();
    throw error;
  } finally {
    gray.delete();
    mask.delete();
    orb.delete();
  }
}

function buildDescriptor(cv, rgb) {
  return {
    pHash: calculatePerceptualHash(cv, rgb),
    dHash: calculateDifferenceHash(cv, rgb),
    color: calculateColorHistogram(rgb),
    orb: calculateOrbFeatures(cv, rgb),
  };
}

function deleteDescriptor(descriptor) {
  descriptor.orb.keypoints.delete();
  descriptor.orb.descriptors.delete();
}

function hashSimilarity(left, right) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) distance += Number(left[index] !== right[index]);
  return 1 - distance / left.length;
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    a += left[index] ** 2;
    b += right[index] ** 2;
  }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

function orbRansacSimilarity(cv, query, candidate) {
  if (query.descriptors.empty() || candidate.descriptors.empty()) {
    return { score: 0, goodMatches: 0, inliers: 0 };
  }
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const matches = new cv.DMatchVectorVector();
  let sourcePoints;
  let destinationPoints;
  let inlierMask;
  let homography;
  try {
    matcher.knnMatch(query.descriptors, candidate.descriptors, matches, 2);
    const good = [];
    for (let index = 0; index < matches.size(); index += 1) {
      const row = matches.get(index);
      if (row.size() >= 2 && row.get(0).distance < 0.75 * row.get(1).distance) good.push(row.get(0));
    }
    if (good.length < 4) {
      return { score: Math.min(0.12, good.length / 35), goodMatches: good.length, inliers: 0 };
    }
    const source = [];
    const destination = [];
    for (const match of good) {
      const from = query.keypoints.get(match.queryIdx).pt;
      const to = candidate.keypoints.get(match.trainIdx).pt;
      source.push(from.x, from.y);
      destination.push(to.x, to.y);
    }
    sourcePoints = cv.matFromArray(good.length, 1, cv.CV_32FC2, source);
    destinationPoints = cv.matFromArray(good.length, 1, cv.CV_32FC2, destination);
    inlierMask = new cv.Mat();
    homography = cv.findHomography(sourcePoints, destinationPoints, cv.RANSAC, 3, inlierMask);
    const inliers = [...inlierMask.data].reduce((total, value) => total + Number(value > 0), 0);
    const inlierRatio = inliers / good.length;
    const score = Math.min(1, good.length / 85) * 0.25
      + Math.min(1, inliers / 50) * 0.5
      + inlierRatio * 0.25;
    return { score, goodMatches: good.length, inliers };
  } finally {
    matcher.delete();
    matches.delete();
    sourcePoints?.delete();
    destinationPoints?.delete();
    inlierMask?.delete();
    homography?.delete();
  }
}

function cropAndResize(cv, source, x, y, width, height) {
  const crop = source.roi(new cv.Rect(x, y, width, height));
  const output = new cv.Mat();
  try {
    cv.resize(crop, output, new cv.Size(source.cols, source.rows), 0, 0, cv.INTER_LINEAR);
    return output;
  } finally {
    crop.delete();
  }
}

function transformMat(cv, source, variation) {
  if (variation === "exact") return source.clone();
  if (variation === "shifted-outside-outline") {
    const x = Math.max(1, Math.round(source.cols * 0.025));
    const y = Math.max(1, Math.round(source.rows * 0.015));
    return cropAndResize(cv, source, x, y, source.cols - x, source.rows - y);
  }
  if (variation === "missing-margin") {
    const x = Math.max(1, Math.round(source.cols * 0.025));
    const y = Math.max(1, Math.round(source.rows * 0.025));
    return cropAndResize(cv, source, x, y, source.cols - 2 * x, source.rows - 2 * y);
  }
  const output = new cv.Mat();
  if (variation === "perspective") {
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, source.cols - 1, 0, source.cols - 1, source.rows - 1, 0, source.rows - 1,
    ]);
    const dx = source.cols * 0.055;
    const dy = source.rows * 0.04;
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
      dx, dy, source.cols - 1 - dx * 0.25, 0,
      source.cols - 1, source.rows - 1 - dy, 0, source.rows - 1,
    ]);
    const matrix = cv.getPerspectiveTransform(from, to);
    cv.warpPerspective(source, output, matrix, new cv.Size(source.cols, source.rows), cv.INTER_LINEAR, cv.BORDER_REFLECT_101);
    from.delete();
    to.delete();
    matrix.delete();
  } else if (variation === "rotation") {
    const matrix = cv.getRotationMatrix2D(new cv.Point(source.cols / 2, source.rows / 2), 5, 1);
    cv.warpAffine(source, output, matrix, new cv.Size(source.cols, source.rows), cv.INTER_LINEAR, cv.BORDER_REFLECT_101);
    matrix.delete();
  } else if (variation === "brightness") {
    source.convertTo(output, -1, 0.66, -10);
  } else if (variation === "blur") {
    cv.GaussianBlur(source, output, new cv.Size(7, 7), 1.5, 1.5, cv.BORDER_DEFAULT);
  } else if (variation === "glare") {
    const overlay = source.clone();
    const stripe = cv.matFromArray(4, 1, cv.CV_32SC2, [
      Math.round(source.cols * 0.57), 0,
      Math.round(source.cols * 0.83), 0,
      Math.round(source.cols * 0.5), source.rows - 1,
      Math.round(source.cols * 0.23), source.rows - 1,
    ]);
    cv.fillConvexPoly(overlay, stripe, new cv.Scalar(255, 255, 255, 255));
    cv.addWeighted(overlay, 0.58, source, 0.42, 0, output);
    overlay.delete();
    stripe.delete();
  } else {
    output.delete();
    throw new Error(`Unknown in-memory variation: ${variation}`);
  }
  return output;
}

async function createVariation(cv, source, variation) {
  if (variation !== "jpeg") return transformMat(cv, source, variation);
  const compressed = await sharp(Buffer.from(source.data), {
    raw: { width: source.cols, height: source.rows, channels: 3 },
  }).jpeg({ quality: 38, chromaSubsampling: "4:2:0" }).toBuffer();
  return decodeRgbBuffer(cv, compressed);
}

function createOcrObservation(card, variation) {
  const firstNameToken = normalizeWords(card.name)[0] || "";
  if (variation === "exact" || variation === "jpeg") {
    return { nameText: card.name, collectorAlternatives: [card.number], printedTotal: card.printedTotal };
  }
  if (variation === "shifted-outside-outline" || variation === "brightness") {
    return { nameText: card.name, collectorAlternatives: [], printedTotal: "" };
  }
  if (variation === "missing-margin" || variation === "perspective") {
    return { nameText: String(card.name).replace(/[^a-z0-9]+$/i, "").slice(0, -1), collectorAlternatives: [], printedTotal: "" };
  }
  if (variation === "rotation" || variation === "glare") {
    return { nameText: firstNameToken, collectorAlternatives: [], printedTotal: "" };
  }
  return { nameText: "", collectorAlternatives: [], printedTotal: "" };
}

function calculateOcrScore(observation, candidate) {
  const name = tokenSimilarity(observation.nameText, candidate.name);
  const number = observation.collectorAlternatives.some((value) => (
    String(value).toUpperCase() === String(candidate.number).toUpperCase()
  )) ? 1 : 0;
  const total = observation.printedTotal
    && String(observation.printedTotal) === String(candidate.printedTotal) ? 1 : 0;
  return name * 0.58 + number * 0.3 + total * 0.12;
}

function calculateVisualScore(queryDescriptor, candidateDescriptor) {
  const pHash = hashSimilarity(queryDescriptor.pHash, candidateDescriptor.pHash);
  const dHash = hashSimilarity(queryDescriptor.dHash, candidateDescriptor.dHash);
  const color = cosineSimilarity(queryDescriptor.color, candidateDescriptor.color);
  return { pHash, dHash, color, score: pHash * 0.55 + dHash * 0.2 + color * 0.25 };
}

function rankOcrOnly(observation, candidates) {
  return candidates.map((candidate) => ({
    cardId: candidate.cardId,
    ocr: calculateOcrScore(observation, candidate),
  })).sort((a, b) => b.ocr - a.ocr || a.cardId.localeCompare(b.cardId));
}

function rankQuery(cv, queryDescriptor, ocrScores, candidates) {
  const lightweightStarted = performance.now();
  const rows = candidates.map((candidate) => {
    const visual = calculateVisualScore(queryDescriptor, candidate.descriptor);
    const ocr = ocrScores.get(candidate.cardId) || 0;
    return {
      cardId: candidate.cardId,
      ocr,
      visual: visual.score,
      pHash: visual.pHash,
      dHash: visual.dHash,
      color: visual.color,
      seed: visual.score * 0.72 + ocr * 0.28,
    };
  });
  const visual = [...rows].sort((a, b) => b.visual - a.visual);
  const shortlist = [...rows].sort((a, b) => b.seed - a.seed).slice(0, orbCandidateLimit);
  const lightweightMs = performance.now() - lightweightStarted;
  const orbStarted = performance.now();
  for (const row of shortlist) {
    const candidate = candidates.find((item) => item.cardId === row.cardId);
    const orb = orbRansacSimilarity(cv, queryDescriptor.orb, candidate.descriptor.orb);
    row.orb = orb.score;
    row.goodMatches = orb.goodMatches;
    row.inliers = orb.inliers;
    row.reranked = row.visual * 0.34 + orb.score * 0.5 + row.ocr * 0.16;
  }
  shortlist.sort((a, b) => b.reranked - a.reranked);
  return { visual, orb: shortlist, lightweightMs, orbMs: performance.now() - orbStarted };
}

function rankOf(rows, cardId, catalogSize) {
  const index = rows.findIndex((row) => row.cardId === cardId);
  return index >= 0 ? index + 1 : catalogSize + 1;
}

function classifyReranked(rows) {
  const top = rows[0];
  const runnerUp = rows[1];
  const gap = top ? top.reranked - (runnerUp?.reranked || 0) : 0;
  return {
    accepted: Boolean(top && top.reranked >= 0.54 && gap >= 0.035),
    topCardId: top?.cardId || null,
    topScore: top?.reranked || 0,
    gap,
  };
}

function summarize(results, prefix) {
  const top1Count = results.filter((row) => row[`${prefix}Rank`] === 1).length;
  const top3Count = results.filter((row) => row[`${prefix}Rank`] <= 3).length;
  return {
    top1: top1Count / results.length,
    top3: top3Count / results.length,
    top1Count,
    top3Count,
    total: results.length,
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
}

function summarizeTiming(values) {
  return {
    meanMs: values.reduce((total, value) => total + value, 0) / Math.max(1, values.length),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

function bitsToHex(bits) {
  let result = "";
  for (let index = 0; index < bits.length; index += 4) {
    let nibble = 0;
    for (let offset = 0; offset < 4; offset += 1) nibble = (nibble << 1) | (bits[index + offset] || 0);
    result += nibble.toString(16);
  }
  return result;
}

function calculateIndexSize(references) {
  const manifest = references.map((reference) => ({
    cardId: reference.cardId,
    pHash: bitsToHex(reference.descriptor.pHash),
    dHash: bitsToHex(reference.descriptor.dHash),
    color: [...reference.descriptor.color].map((value) => Number(value.toFixed(5))),
  }));
  const json = JSON.stringify(manifest);
  return {
    cardCount: manifest.length,
    jsonBytes: Buffer.byteLength(json),
    gzipBytes: gzipSync(json).length,
    descriptors: ["63-bit DCT perceptual hash", "64-bit difference hash", "24-bin RGB histogram"],
    excludesOrb: true,
  };
}

function percentage(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function createMarkdown(report) {
  const lines = [
    "# PackDex local scanner visual benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `This development-only benchmark searches the complete ${report.cardCount}-card trusted test catalog. Lightweight visual search evaluates every reference; ORB/RANSAC runs only against the strongest ${report.orbCandidateLimit} fused visual/OCR candidates. It uses no cloud vision, uploads, or paid services.`,
    "",
    "## Accuracy",
    "",
    "| Pipeline | Top-1 | Top-3 |",
    "| --- | ---: | ---: |",
    `| Simulated OCR-only evidence | ${percentage(report.ocrOnly.top1)} (${report.ocrOnly.top1Count}/${report.ocrOnly.total}) | ${percentage(report.ocrOnly.top3)} (${report.ocrOnly.top3Count}/${report.ocrOnly.total}) |`,
    `| Lightweight pHash + dHash + color | ${percentage(report.lightweightVisual.top1)} (${report.lightweightVisual.top1Count}/${report.lightweightVisual.total}) | ${percentage(report.lightweightVisual.top3)} (${report.lightweightVisual.top3Count}/${report.lightweightVisual.total}) |`,
    `| Fused evidence + top-${report.orbCandidateLimit} ORB/RANSAC | ${percentage(report.orbReranked.top1)} (${report.orbReranked.top1Count}/${report.orbReranked.total}) | ${percentage(report.orbReranked.top3)} (${report.orbReranked.top3Count}/${report.orbReranked.total}) |`,
    "",
    "OCR-only numbers measure deterministic, degraded text observations; this harness does not run ML Kit OCR. They are a matching benchmark, not an OCR-engine accuracy claim.",
    "",
    "## Timing",
    "",
    "| Stage | Mean | p95 |",
    "| --- | ---: | ---: |",
    `| OCR score/rank only (excludes OCR inference) | ${report.timing.ocrOnly.meanMs.toFixed(1)} ms | ${report.timing.ocrOnly.p95Ms.toFixed(1)} ms |`,
    `| Query descriptors + full lightweight search | ${report.timing.lightweightVisual.meanMs.toFixed(1)} ms | ${report.timing.lightweightVisual.p95Ms.toFixed(1)} ms |`,
    `| Top-${report.orbCandidateLimit} ORB/RANSAC rerank | ${report.timing.orbReranked.meanMs.toFixed(1)} ms | ${report.timing.orbReranked.p95Ms.toFixed(1)} ms |`,
    `| End to end (excluding OCR inference) | ${report.timing.endToEnd.meanMs.toFixed(1)} ms | ${report.timing.endToEnd.p95Ms.toFixed(1)} ms |`,
    "",
    `Reference descriptor setup: ${report.timing.referenceSetupMs.toFixed(1)} ms. Times are desktop Node/OpenCV.js measurements, not Pixel timings.`,
    "",
    "## Mega Charizard acceptance matrix",
    "",
    "| Input | OCR rank | Lightweight rank | ORB rank | ORB top |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const row of report.megaAcceptance.results) {
    lines.push(`| ${row.variation} | ${row.ocrRank} | ${row.visualRank} | ${row.orbRank} | \`${row.orbTop}\` |`);
  }
  lines.push(
    "",
    `Expected: \`${report.megaAcceptance.expectedCardId}\`. Direct fixture and File/Blob-equivalent bytes both use the normal decode/resize/descriptor/ranking functions; the Blob case creates a real Node Blob and decodes its bytes. Browser preview geometry, ML Kit, and physical-camera behavior are outside this development harness.`,
    "",
    "## Catalog and variation coverage",
    "",
    `- ${report.cardCount} trusted cards; ${report.queryCount} generated catalog queries`,
    `- Eras: ${report.eras.join(", ")}`,
    `- Sets: ${report.sets.length}; rarities: ${report.rarities.join(", ")}`,
    `- Variations: ${report.variations.join(", ")}`,
    `- Estimated lightweight index: ${report.lightweightIndex.jsonBytes} JSON bytes; ${report.lightweightIndex.gzipBytes} gzip bytes`,
    `- Reference cache: ${report.cache.cacheHits.length} hits, ${report.cache.downloaded.length} downloads, ${report.cache.failures.length} failures`,
    "",
    "## Failures and false positives",
    "",
    `Top-1 failures: OCR-only ${report.failureCounts.ocrOnly}/${report.queryCount}; lightweight visual ${report.failureCounts.lightweightVisual}/${report.queryCount}; ORB reranked ${report.failureCounts.orbReranked}/${report.queryCount}. Confident ORB false positives at the benchmark threshold: ${report.falsePositiveCount}/${report.queryCount}.`,
    "",
  );
  if (!report.failures.length) lines.push("No Top-1 failures in any pipeline.");
  for (const failure of report.failures) {
    lines.push(`- ${failure.variation}: expected \`${failure.cardId}\`; OCR #${failure.ocrRank}, visual #${failure.visualRank} (\`${failure.visualTop}\`), ORB #${failure.orbRank} (\`${failure.orbTop}\`), accepted=${failure.accepted}.`);
  }
  if (report.falsePositives.length) {
    lines.push("", "False-positive examples:");
    for (const falsePositive of report.falsePositives) {
      lines.push(`- ${falsePositive.variation}: expected \`${falsePositive.cardId}\`, accepted \`${falsePositive.orbTop}\` (score ${falsePositive.topScore.toFixed(3)}, gap ${falsePositive.gap.toFixed(3)}).`);
    }
  }
  lines.push(
    "",
    "## Gardevoir/Groudon confusion check",
    "",
    `The benchmark contains both \`${report.confusionCheck.gardevoirCardId}\` and \`${report.confusionCheck.groudonCardId}\`. Across Gardevoir's nine variations, Groudon was ${report.confusionCheck.groudonBestRankLabel}; Gardevoir ORB Top-1 accuracy was ${percentage(report.confusionCheck.gardevoirOrbTop1)}.`,
    "",
    "## Limits",
    "",
    "These are synthetic transforms of catalog/reference images on a desktop, not a labeled physical Pixel corpus. They do not reproduce sleeves, arbitrary backgrounds, motion during capture, incorrect preview-to-sensor mapping, real ML Kit OCR, or every crop failure. A correct benchmark result must not be described as proof that physical scanning is fixed.",
    "",
  );
  return lines.join("\n").trimEnd();
}

const cv = await getOpenCv();
const cards = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (cards.length < 50) throw new Error(`Visual benchmark requires at least 50 cards; found ${cards.length}.`);

const trustedCatalog = new Map(buildScannerCatalog().map((card) => [card.cardId, card]));
for (const card of cards) {
  const trusted = trustedCatalog.get(card.cardId);
  if (!trusted || trusted.name !== card.name || trusted.cardNumber !== card.number
    || trusted.printedSetTotal !== card.printedTotal || trusted.setId !== card.setId) {
    throw new Error(`Visual fixture metadata no longer matches the trusted catalog: ${card.cardId}.`);
  }
}

const cache = await ensureFixtureCache(cards);
if (cache.failures.length) {
  throw new Error(`Missing or unreadable benchmark images: ${JSON.stringify(cache.failures)}`);
}

const references = [];
const referenceSetupStarted = performance.now();
for (const card of cards) {
  const fixturePath = path.join(fixtureRoot, card.fixture);
  const image = await loadRgbMat(cv, fixturePath);
  references.push({ ...card, image, descriptor: buildDescriptor(cv, image) });
}
const referenceSetupMs = performance.now() - referenceSetupStarted;
const results = [];

async function evaluateQuery(query, target, variation, observation) {
  const started = performance.now();
  const ocrStarted = performance.now();
  const ocr = rankOcrOnly(observation, references);
  const ocrMs = performance.now() - ocrStarted;
  const ocrScores = new Map(ocr.map((row) => [row.cardId, row.ocr]));
  const descriptorStarted = performance.now();
  const descriptor = buildDescriptor(cv, query);
  const descriptorMs = performance.now() - descriptorStarted;
  const ranked = rankQuery(cv, descriptor, ocrScores, references);
  const classification = classifyReranked(ranked.orb);
  const row = {
    cardId: target.cardId,
    variation,
    ocrRank: rankOf(ocr, target.cardId, references.length),
    visualRank: rankOf(ranked.visual, target.cardId, references.length),
    orbRank: rankOf(ranked.orb, target.cardId, references.length),
    ocrTop: ocr[0]?.cardId || null,
    visualTop: ranked.visual[0]?.cardId || null,
    orbTop: ranked.orb[0]?.cardId || null,
    groudonDiagnosticRank: target.cardId === "ex1-7"
      ? rankOf(ranked.orb, "ex9-5", references.length) : null,
    accepted: classification.accepted,
    topScore: classification.topScore,
    gap: classification.gap,
    timing: {
      ocrOnlyMs: ocrMs,
      lightweightVisualMs: descriptorMs + ranked.lightweightMs,
      orbRerankedMs: ranked.orbMs,
      endToEndMs: performance.now() - started,
    },
  };
  deleteDescriptor(descriptor);
  return row;
}

try {
  for (const target of references) {
    for (const variation of generalVariations) {
      const query = await createVariation(cv, target.image, variation);
      try {
        results.push(await evaluateQuery(query, target, variation, createOcrObservation(target, variation)));
      } finally {
        query.delete();
      }
    }
  }

  const expectedMega = references.find((card) => card.cardId === expectedMegaId);
  if (!expectedMega) throw new Error(`Expected Mega Charizard fixture is not in the benchmark catalog: ${expectedMegaId}.`);
  const megaDirect = await loadRgbMat(cv, referenceTestPath);
  const megaBytes = await fs.readFile(referenceTestPath);
  const megaBlob = new Blob([megaBytes], { type: "image/jpeg" });
  const megaBlobMat = await decodeRgbBuffer(cv, Buffer.from(await megaBlob.arrayBuffer()));
  const megaObservation = {
    nameText: "Mega Charizard XeA360",
    collectorAlternatives: ["13", "18"],
    printedTotal: "94",
  };
  const megaAcceptanceResults = [];
  try {
    for (const variation of megaAcceptanceVariations) {
      let query;
      if (variation === "direct-fixture") query = megaDirect.clone();
      else if (variation === "file-blob-equivalent") query = megaBlobMat.clone();
      else query = await createVariation(cv, megaDirect, variation);
      try {
        megaAcceptanceResults.push(await evaluateQuery(query, expectedMega, variation, megaObservation));
      } finally {
        query.delete();
      }
    }
  } finally {
    megaDirect.delete();
    megaBlobMat.delete();
  }

  const ocrFailures = results.filter((row) => row.ocrRank !== 1);
  const lightweightFailures = results.filter((row) => row.visualRank !== 1);
  const orbFailures = results.filter((row) => row.orbRank !== 1);
  const failures = [
    ...lightweightFailures,
    ...orbFailures.filter((row) => !lightweightFailures.includes(row)),
    ...ocrFailures.filter((row) => !lightweightFailures.includes(row) && !orbFailures.includes(row)),
  ];
  const falsePositives = results.filter((row) => row.accepted && row.orbTop !== row.cardId);
  const gardevoirCardId = "ex1-7";
  const groudonCardId = "ex9-5";
  const gardevoirResults = results.filter((row) => row.cardId === gardevoirCardId);
  const report = {
    generatedAt: new Date().toISOString(),
    developmentOnly: true,
    trustedCatalogValidated: true,
    fullTestCatalogSearch: true,
    cardCount: cards.length,
    queryCount: results.length,
    orbCandidateLimit,
    variations: generalVariations,
    eras: [...new Set(cards.map((card) => card.era))],
    sets: [...new Set(cards.map((card) => card.setName))],
    rarities: [...new Set(cards.map((card) => card.rarity))],
    cache,
    lightweightIndex: calculateIndexSize(references),
    ocrOnly: summarize(results, "ocr"),
    lightweightVisual: summarize(results, "visual"),
    orbReranked: summarize(results, "orb"),
    timing: {
      referenceSetupMs,
      ocrOnly: summarizeTiming(results.map((row) => row.timing.ocrOnlyMs)),
      lightweightVisual: summarizeTiming(results.map((row) => row.timing.lightweightVisualMs)),
      orbReranked: summarizeTiming(results.map((row) => row.timing.orbRerankedMs)),
      endToEnd: summarizeTiming(results.map((row) => row.timing.endToEndMs)),
      environment: "desktop Node/OpenCV.js; excludes ML Kit OCR inference",
    },
    failureCounts: {
      ocrOnly: ocrFailures.length,
      lightweightVisual: lightweightFailures.length,
      orbReranked: orbFailures.length,
    },
    falsePositiveCount: falsePositives.length,
    failures: failures.slice(0, 20),
    falsePositives: falsePositives.slice(0, 20),
    confusionCheck: {
      gardevoirCardId,
      groudonCardId,
      gardevoirOrbTop1: gardevoirResults.filter((row) => row.orbRank === 1).length / gardevoirResults.length,
      bestGroudonRankForGardevoir: Math.min(...gardevoirResults.map((row) => row.groudonDiagnosticRank)),
    },
    megaAcceptance: {
      fixturePath: path.relative(projectRoot, referenceTestPath).replaceAll("\\", "/"),
      expectedCardId: expectedMegaId,
      variations: megaAcceptanceVariations,
      allOrbTop1: megaAcceptanceResults.every((row) => row.orbRank === 1),
      results: megaAcceptanceResults,
    },
    results,
    limitations: [
      "Synthetic catalog/reference transforms are not physical Pixel captures.",
      "OCR-only evidence is simulated; ML Kit OCR inference is not run by this Node harness.",
      "File/Blob-equivalent covers byte decoding, preparation, descriptors, and ranking, not browser preview geometry.",
      "Timing is desktop timing and must not be reported as Pixel performance.",
    ],
  };
  report.confusionCheck.groudonBestRankLabel = report.confusionCheck.bestGroudonRankForGardevoir > orbCandidateLimit
    ? `never shortlisted in the top ${orbCandidateLimit}`
    : `ranked as high as #${report.confusionCheck.bestGroudonRankForGardevoir}`;

  await fs.mkdir(path.dirname(reportJsonPath), { recursive: true });
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = createMarkdown(report);
  await fs.writeFile(reportMarkdownPath, `${markdown}\n`);
  console.log(markdown);

  if (!report.megaAcceptance.allOrbTop1) {
    process.exitCode = 1;
    console.error("Mega Charizard acceptance failed: one or more ORB-reranked variations were not Top-1.");
  }
} finally {
  for (const reference of references) {
    deleteDescriptor(reference.descriptor);
    reference.image.delete();
  }
}
