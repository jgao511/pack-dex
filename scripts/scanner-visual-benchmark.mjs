import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
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
const targetWidth = 360;

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

async function loadRgbMat(cv, imagePath) {
  const { data, info } = await sharp(imagePath).rotate().resize({ width: targetWidth }).removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  return cv.matFromArray(info.height, info.width, cv.CV_8UC3, data);
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
    const values = [];
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
        values.push(coefficient);
      }
    }
    const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    return Uint8Array.from(values, (value) => Number(value >= median));
  } finally {
    gray.delete(); small.delete();
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
  const orb = new cv.ORB(700);
  try {
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    orb.detectAndCompute(gray, mask, keypoints, descriptors);
    return { keypoints, descriptors };
  } catch (error) {
    keypoints.delete(); descriptors.delete();
    throw error;
  } finally {
    gray.delete(); mask.delete(); orb.delete();
  }
}

function buildDescriptor(cv, rgb) {
  return {
    pHash: calculatePerceptualHash(cv, rgb),
    color: calculateColorHistogram(rgb),
    orb: calculateOrbFeatures(cv, rgb),
  };
}

function deleteDescriptor(descriptor) {
  descriptor.orb.keypoints.delete();
  descriptor.orb.descriptors.delete();
}

function perceptualHashSimilarity(left, right) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) distance += Number(left[index] !== right[index]);
  return 1 - distance / left.length;
}

function cosineSimilarity(left, right) {
  let dot = 0; let a = 0; let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]; a += left[index] ** 2; b += right[index] ** 2;
  }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

function orbRansacSimilarity(cv, query, candidate) {
  if (query.descriptors.empty() || candidate.descriptors.empty()) return { score: 0, goodMatches: 0, inliers: 0 };
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const matches = new cv.DMatchVectorVector();
  let sourcePoints; let destinationPoints; let inlierMask; let homography;
  try {
    matcher.knnMatch(query.descriptors, candidate.descriptors, matches, 2);
    const good = [];
    for (let index = 0; index < matches.size(); index += 1) {
      const row = matches.get(index);
      if (row.size() >= 2 && row.get(0).distance < 0.75 * row.get(1).distance) good.push(row.get(0));
    }
    if (good.length < 4) return { score: Math.min(0.15, good.length / 30), goodMatches: good.length, inliers: 0 };
    const source = []; const destination = [];
    for (const match of good) {
      const from = query.keypoints.get(match.queryIdx).pt;
      const to = candidate.keypoints.get(match.trainIdx).pt;
      source.push(from.x, from.y); destination.push(to.x, to.y);
    }
    sourcePoints = cv.matFromArray(good.length, 1, cv.CV_32FC2, source);
    destinationPoints = cv.matFromArray(good.length, 1, cv.CV_32FC2, destination);
    inlierMask = new cv.Mat();
    homography = cv.findHomography(sourcePoints, destinationPoints, cv.RANSAC, 3, inlierMask);
    const inliers = [...inlierMask.data].reduce((total, value) => total + Number(value > 0), 0);
    const inlierRatio = inliers / good.length;
    const score = Math.min(1, good.length / 90) * 0.25
      + Math.min(1, inliers / 55) * 0.5
      + inlierRatio * 0.25;
    return { score, goodMatches: good.length, inliers };
  } finally {
    matcher.delete(); matches.delete(); sourcePoints?.delete(); destinationPoints?.delete(); inlierMask?.delete(); homography?.delete();
  }
}

function transformMat(cv, source, variation) {
  const output = new cv.Mat();
  if (variation === "perspective") {
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, source.cols - 1, 0, source.cols - 1, source.rows - 1, 0, source.rows - 1]);
    const dx = source.cols * 0.045; const dy = source.rows * 0.035;
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [dx, dy, source.cols - 1 - dx * 0.35, 0, source.cols - 1, source.rows - 1 - dy, 0, source.rows - 1]);
    const matrix = cv.getPerspectiveTransform(from, to);
    cv.warpPerspective(source, output, matrix, new cv.Size(source.cols, source.rows), cv.INTER_LINEAR, cv.BORDER_REFLECT_101);
    from.delete(); to.delete(); matrix.delete();
  } else if (variation === "rotation") {
    const matrix = cv.getRotationMatrix2D(new cv.Point(source.cols / 2, source.rows / 2), 4.5, 1);
    cv.warpAffine(source, output, matrix, new cv.Size(source.cols, source.rows), cv.INTER_LINEAR, cv.BORDER_REFLECT_101);
    matrix.delete();
  } else if (variation === "brightness") {
    source.convertTo(output, -1, 0.7, -8);
  } else if (variation === "blur") {
    cv.GaussianBlur(source, output, new cv.Size(7, 7), 1.4, 1.4, cv.BORDER_DEFAULT);
  } else if (variation === "glare") {
    const overlay = source.clone();
    const stripe = cv.matFromArray(4, 1, cv.CV_32SC2, [
      Math.round(source.cols * 0.58), 0,
      Math.round(source.cols * 0.82), 0,
      Math.round(source.cols * 0.48), source.rows - 1,
      Math.round(source.cols * 0.25), source.rows - 1,
    ]);
    cv.fillConvexPoly(overlay, stripe, new cv.Scalar(255, 255, 255, 255));
    cv.addWeighted(overlay, 0.55, source, 0.45, 0, output);
    overlay.delete(); stripe.delete();
  } else {
    throw new Error(`Unknown in-memory variation: ${variation}`);
  }
  return output;
}

async function createVariation(cv, source, variation) {
  if (variation !== "jpeg") return transformMat(cv, source, variation);
  const compressed = await sharp(Buffer.from(source.data), { raw: { width: source.cols, height: source.rows, channels: 3 } })
    .jpeg({ quality: 38, chromaSubsampling: "4:2:0" }).toBuffer();
  return decodeRgbBuffer(cv, compressed);
}

function createOcrObservation(card, variation) {
  const numberReadable = variation === "brightness" || variation === "jpeg";
  return {
    nameText: numberReadable ? card.name : card.group,
    collectorAlternatives: numberReadable ? [card.number] : [],
    printedTotal: numberReadable ? card.printedTotal : "",
  };
}

function calculateOcrScore(observation, candidate) {
  const name = tokenSimilarity(observation.nameText, candidate.name);
  const number = observation.collectorAlternatives.some((value) => String(value).toUpperCase() === String(candidate.number).toUpperCase()) ? 1 : 0;
  const total = observation.printedTotal && String(observation.printedTotal) === String(candidate.printedTotal) ? 1 : 0;
  return name * 0.6 + number * 0.3 + total * 0.1;
}

function rankCandidates(cv, queryDescriptor, observation, candidates) {
  return candidates.map((candidate) => {
    const pHash = perceptualHashSimilarity(queryDescriptor.pHash, candidate.descriptor.pHash);
    const color = cosineSimilarity(queryDescriptor.color, candidate.descriptor.color);
    const baselineVisual = pHash * 0.72 + color * 0.28;
    const orb = orbRansacSimilarity(cv, queryDescriptor.orb, candidate.descriptor.orb);
    const ocr = calculateOcrScore(observation, candidate);
    return {
      cardId: candidate.cardId,
      baselineScore: baselineVisual * 0.7 + ocr * 0.3,
      orbScore: baselineVisual * 0.42 + orb.score * 0.4 + ocr * 0.18,
      pHash, color, ocr, goodMatches: orb.goodMatches, inliers: orb.inliers,
    };
  });
}

function topIds(rows, scoreName) {
  return [...rows].sort((a, b) => b[scoreName] - a[scoreName]).map((row) => row.cardId);
}

function summarize(results, prefix) {
  const top1 = results.filter((row) => row[`${prefix}Rank`] === 1).length;
  const top3 = results.filter((row) => row[`${prefix}Rank`] <= 3).length;
  return {
    top1: top1 / results.length,
    top3: top3 / results.length,
    top1Count: top1,
    top3Count: top3,
    total: results.length,
  };
}

function percentage(value) { return `${(value * 100).toFixed(1)}%`; }

function createMarkdown(report) {
  const lines = [
    "# PackDex local scanner visual benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "This development-only benchmark compares each synthetic scan only with its OCR-narrowed card-family shortlist (3–5 trusted catalog cards), never the full catalog. It uses no network services or uploads.",
    "",
    "## Results",
    "",
    "| Pipeline | Top-1 | Top-3 |",
    "| --- | ---: | ---: |",
    `| pHash + color + OCR | ${percentage(report.baseline.top1)} (${report.baseline.top1Count}/${report.baseline.total}) | ${percentage(report.baseline.top3)} (${report.baseline.top3Count}/${report.baseline.total}) |`,
    `| pHash + color + ORB/RANSAC + OCR | ${percentage(report.orb.top1)} (${report.orb.top1Count}/${report.orb.total}) | ${percentage(report.orb.top3)} (${report.orb.top3Count}/${report.orb.total}) |`,
    "",
    `Mean processing time: ${report.timing.meanMs.toFixed(1)} ms/query; p50 ${report.timing.p50Ms.toFixed(1)} ms; p95 ${report.timing.p95Ms.toFixed(1)} ms. Reference descriptor setup (${report.cardCount} cards): ${report.timing.referenceSetupMs.toFixed(1)} ms.`,
    "",
    `ORB Top-1 change: ${(report.orbImprovementTop1 * 100).toFixed(1)} percentage points. ${report.orbMateriallyImproves ? "ORB materially improved this benchmark." : "ORB did not materially improve Top-1 accuracy by the benchmark's 2-point threshold."}`,
    "",
    "## Supplied Mega Charizard reference",
    "",
    `Expected: \`${report.referenceImage.expectedCardId}\`; pHash baseline rank: ${report.referenceImage.baselineRank}; ORB/RANSAC rank: ${report.referenceImage.orbRank}; shortlist: ${report.referenceImage.shortlist.join(", ")}.`,
    "",
    "The reference observation uses the Pixel diagnostic text (`Mega Charizard XeA360`, `O1B/094`) and the bounded collector alternatives `013/094` and `018/094`; the image itself still supplies the visual evidence.",
    "",
    "## Coverage",
    "",
    `- ${report.cardCount} PackDex cards; ${report.queryCount} generated queries plus the supplied reference query`,
    `- Eras: ${report.eras.join(", ")}`,
    `- Rarities: ${report.rarities.join(", ")}`,
    `- Variations: ${report.variations.join(", ")}`,
    "",
    "## Failure examples",
    "",
  ];
  if (!report.failures.length) lines.push("No Top-1 failures.");
  for (const failure of report.failures) {
    lines.push(`- ${failure.variation}: expected \`${failure.cardId}\`; baseline #${failure.baselineRank} (picked \`${failure.baselineTop}\`); ORB #${failure.orbRank} (picked \`${failure.orbTop}\`).`);
  }
  lines.push(
    "",
    "## Interpretation",
    "",
    "The benchmark is a feasibility check, not a production accuracy claim: its OCR shortlist is simulated from a stable family token and selectively available collector evidence. The next useful step is to collect a labeled Pixel corpus (including sleeves, glare, real backgrounds, and failed crops), replay the real OCR shortlists, and rerun this harness before choosing an Android implementation.",
    "",
  );
  return lines.join("\n");
}

const cv = await getOpenCv();
const cards = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (cards.length < 20) throw new Error(`Visual benchmark requires at least 20 cards; found ${cards.length}.`);
const trustedCatalog = new Map(buildScannerCatalog().map((card) => [card.cardId, card]));
for (const card of cards) {
  const trusted = trustedCatalog.get(card.cardId);
  if (!trusted || trusted.name !== card.name || trusted.cardNumber !== card.number || trusted.setId !== card.setId) {
    throw new Error(`Visual fixture metadata no longer matches the trusted catalog: ${card.cardId}.`);
  }
}
const variations = ["perspective", "rotation", "brightness", "blur", "jpeg", "glare"];
const references = [];
const referenceSetupStarted = performance.now();
for (const card of cards) {
  const image = await loadRgbMat(cv, path.join(fixtureRoot, card.fixture));
  references.push({ ...card, image, descriptor: buildDescriptor(cv, image) });
}
const referenceSetupMs = performance.now() - referenceSetupStarted;
const results = [];
try {
  for (const target of references) {
    const candidates = references.filter((candidate) => candidate.group === target.group);
    if (candidates.length > 5) throw new Error(`OCR shortlist exceeded five cards for ${target.group}.`);
    for (const variation of variations) {
      const started = performance.now();
      const query = await createVariation(cv, target.image, variation);
      const descriptor = buildDescriptor(cv, query);
      const ranked = rankCandidates(cv, descriptor, createOcrObservation(target, variation), candidates);
      const baseline = topIds(ranked, "baselineScore");
      const orb = topIds(ranked, "orbScore");
      results.push({
        cardId: target.cardId, group: target.group, variation,
        baselineRank: baseline.indexOf(target.cardId) + 1,
        orbRank: orb.indexOf(target.cardId) + 1,
        baselineTop: baseline[0], orbTop: orb[0],
        processingMs: performance.now() - started,
      });
      deleteDescriptor(descriptor); query.delete();
    }
  }

  const supplied = await loadRgbMat(cv, referenceTestPath);
  const suppliedDescriptor = buildDescriptor(cv, supplied);
  const expected = references.find((card) => card.cardId === "phantasmal-flames-13-mega-charizard-x-ex");
  const suppliedCandidates = references.filter((candidate) => candidate.group === "charizard");
  const suppliedObservation = { nameText: "Mega Charizard XeA360", collectorAlternatives: ["13", "18"], printedTotal: "94" };
  const suppliedRanked = rankCandidates(cv, suppliedDescriptor, suppliedObservation, suppliedCandidates);
  const suppliedBaseline = topIds(suppliedRanked, "baselineScore");
  const suppliedOrb = topIds(suppliedRanked, "orbScore");
  const timings = results.map((row) => row.processingMs).sort((a, b) => a - b);
  const baseline = summarize(results, "baseline");
  const orb = summarize(results, "orb");
  const failures = results.filter((row) => row.baselineRank !== 1 || row.orbRank !== 1).slice(0, 12);
  const report = {
    generatedAt: new Date().toISOString(),
    developmentOnly: true,
    trustedCatalogValidated: true,
    cardCount: cards.length,
    queryCount: results.length,
    shortlistSize: { minimum: Math.min(...references.map((card) => references.filter((candidate) => candidate.group === card.group).length)), maximum: Math.max(...references.map((card) => references.filter((candidate) => candidate.group === card.group).length)) },
    variations,
    eras: [...new Set(cards.map((card) => card.era))],
    rarities: [...new Set(cards.map((card) => card.rarity))],
    baseline,
    orb,
    orbImprovementTop1: orb.top1 - baseline.top1,
    orbMateriallyImproves: orb.top1 - baseline.top1 >= 0.02,
    timing: {
      referenceSetupMs,
      meanMs: timings.reduce((total, value) => total + value, 0) / timings.length,
      p50Ms: timings[Math.floor(timings.length * 0.5)],
      p95Ms: timings[Math.floor(timings.length * 0.95)],
    },
    referenceImage: {
      path: path.relative(projectRoot, referenceTestPath).replaceAll("\\", "/"),
      expectedCardId: expected.cardId,
      baselineRank: suppliedBaseline.indexOf(expected.cardId) + 1,
      orbRank: suppliedOrb.indexOf(expected.cardId) + 1,
      baselineTop: suppliedBaseline[0],
      orbTop: suppliedOrb[0],
      shortlist: suppliedCandidates.map((card) => card.cardId),
    },
    failures,
    results,
  };
  await fs.mkdir(path.dirname(reportJsonPath), { recursive: true });
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(reportMarkdownPath, createMarkdown(report));
  console.log(createMarkdown(report));
  deleteDescriptor(suppliedDescriptor); supplied.delete();
  if (report.referenceImage.baselineRank !== 1 || report.referenceImage.orbRank !== 1) process.exitCode = 1;
} finally {
  for (const reference of references) { deleteDescriptor(reference.descriptor); reference.image.delete(); }
}
