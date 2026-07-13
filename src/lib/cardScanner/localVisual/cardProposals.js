import { detectCardBoundary, rectifyCardPerspective } from "./cardBoundary.js";
import { expandQuad, getQuadMetrics, scoreCardQuad } from "./quadGeometry.js";

const CARD_RATIO = 2.5 / 3.5;
// The real Pixel fixtures place cards at roughly one-half to three-quarters of frame height.
// The smallest scale also covers a user backing farther away and showing substantially more table.
const DEFAULT_SCALES = Object.freeze([0.46, 0.52, 0.58, 0.66, 0.74, 0.84]);
const deleteMats = (...mats) => mats.forEach((mat) => mat?.delete?.());
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function rectangleCorners({ x, y, width, height }) {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

function qualityFor(points, imageSize) {
  const metrics = getQuadMetrics(points, imageSize);
  return {
    width: metrics.width,
    height: metrics.height,
    portraitAspectRatio: metrics.portraitAspectRatio,
    areaFraction: metrics.areaFraction,
    center: metrics.center,
    centerDistance: metrics.centerDistance,
    aspectError: Math.abs(Math.log(Math.max(Number.EPSILON, metrics.portraitAspectRatio) / CARD_RATIO)),
  };
}

function bounds(points) {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

function duplicate(existing, points, imageSize) {
  const second = bounds(points);
  const diagonal = Math.hypot(imageSize.width, imageSize.height);
  return existing.some((item) => {
    const first = bounds(item.corners);
    const overlapWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
    const overlapHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
    const intersection = overlapWidth * overlapHeight;
    const union = (first.right - first.left) * (first.bottom - first.top)
      + (second.right - second.left) * (second.bottom - second.top) - intersection;
    if (intersection / Math.max(Number.EPSILON, union) < 0.92) return false;
    const meanDistance = item.corners.reduce((sum, point, index) => (
      sum + Math.hypot(point.x - points[index].x, point.y - points[index].y) / 4
    ), 0);
    return meanDistance / diagonal < 0.025;
  });
}

/** Recovers rounded/glare-broken card edges without requiring approxPolyDP to return four points. */
function minimumAreaProposals(cv, source, limit = 1) {
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let kernel;
  const candidates = [];
  try {
    if (source.channels() === 4) cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    else if (source.channels() === 3) cv.cvtColor(source, gray, cv.COLOR_RGB2GRAY);
    else source.copyTo(gray);
    cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 32, 128);
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const imageSize = { width: source.cols, height: source.rows };
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      try {
        const contourAreaFraction = Math.abs(cv.contourArea(contour)) / (source.cols * source.rows);
        if (contourAreaFraction < 0.035 || contourAreaFraction > 0.97) continue;
        const rotated = cv.minAreaRect(contour);
        if (!rotated?.size?.width || !rotated?.size?.height) continue;
        const points = cv.RotatedRect.points(rotated).map(({ x, y }) => ({ x, y }));
        const scored = scoreCardQuad(points, imageSize, {
          minimumAreaFraction: 0.08,
          maximumAreaFraction: 0.96,
          minimumAspectRatio: 0.48,
          maximumAspectRatio: 0.9,
          maximumCenterDistance: 0.72,
        });
        if (!scored.accepted) continue;
        const support = Math.min(1, contourAreaFraction / Math.max(0.02, scored.metrics.areaFraction));
        candidates.push({
          corners: expandQuad(scored.metrics.ordered, imageSize, 0.012),
          geometryScore: scored.score * 0.82 + support * 0.18,
          detector: { contourAreaFraction },
        });
      } finally {
        contour.delete();
      }
    }
  } finally {
    deleteMats(kernel, hierarchy, contours, edges, blurred, gray);
  }
  const distinct = [];
  const imageSize = { width: source.cols, height: source.rows };
  for (const candidate of candidates.sort((a, b) => b.geometryScore - a.geometryScore)) {
    if (duplicate(distinct, candidate.corners, imageSize)) continue;
    distinct.push(candidate);
    if (distinct.length === limit) break;
  }
  return distinct;
}

function line(x1, y1, x2, y2) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return length ? {
    x1, y1, x2, y2, length,
    midpoint: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
    angle: Math.atan2(y2 - y1, x2 - x1),
    a: y1 - y2,
    b: x2 - x1,
    c: x2 * y1 - x1 * y2,
  } : null;
}

function intersect(first, second) {
  const determinant = first.a * second.b - second.a * first.b;
  return Math.abs(determinant) < 1e-5 ? null : {
    x: (first.c * second.b - second.c * first.b) / determinant,
    y: (first.a * second.c - second.a * first.c) / determinant,
  };
}

function parallelDifference(first, second) {
  let difference = Math.abs(first.angle - second.angle) % Math.PI;
  if (difference > Math.PI / 2) difference = Math.PI - difference;
  return difference;
}

/** Supplies one conservative line-based quad when four supported border lines are available. */
function houghProposal(cv, source) {
  if (typeof cv.HoughLinesP !== "function") return null;
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const linesMat = new cv.Mat();
  let best = null;
  try {
    if (source.channels() === 4) cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    else if (source.channels() === 3) cv.cvtColor(source, gray, cv.COLOR_RGB2GRAY);
    else source.copyTo(gray);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(gray, edges, 42, 145);
    const minimumDimension = Math.min(source.cols, source.rows);
    cv.HoughLinesP(edges, linesMat, 1, Math.PI / 180, 70, minimumDimension * 0.16, minimumDimension * 0.035);
    const all = [];
    for (let index = 0; index < linesMat.data32S.length; index += 4) {
      const item = line(...linesMat.data32S.slice(index, index + 4));
      if (item) all.push(item);
    }
    const longest = (items) => items.sort((a, b) => b.length - a.length).slice(0, 10);
    const horizontal = longest(all.filter((item) => Math.abs(Math.cos(item.angle)) >= Math.cos(Math.PI / 5)));
    const vertical = longest(all.filter((item) => Math.abs(Math.sin(item.angle)) >= Math.cos(Math.PI / 5)));
    const pairs = (items, axis, minimumGap) => {
      const results = [];
      for (let first = 0; first < items.length; first += 1) {
        for (let second = first + 1; second < items.length; second += 1) {
          const pair = [items[first], items[second]].sort((a, b) => a.midpoint[axis] - b.midpoint[axis]);
          if (pair[1].midpoint[axis] - pair[0].midpoint[axis] < minimumGap) continue;
          if (parallelDifference(...pair) <= Math.PI / 10) results.push(pair);
        }
      }
      return results.slice(0, 14);
    };
    const horizontalPairs = pairs(horizontal, "y", source.rows * 0.28);
    const verticalPairs = pairs(vertical, "x", source.cols * 0.2);
    const imageSize = { width: source.cols, height: source.rows };
    for (const [top, bottom] of horizontalPairs) {
      for (const [left, right] of verticalPairs) {
        const corners = [intersect(top, left), intersect(top, right), intersect(bottom, right), intersect(bottom, left)];
        if (corners.some((point) => !point || point.x < -20 || point.y < -20 || point.x > source.cols + 20 || point.y > source.rows + 20)) continue;
        const scored = scoreCardQuad(corners, imageSize, {
          minimumAreaFraction: 0.08,
          maximumAreaFraction: 0.95,
          minimumAspectRatio: 0.48,
          maximumAspectRatio: 0.9,
          maximumCenterDistance: 0.72,
        });
        if (!scored.accepted) continue;
        const horizontalSupport = Math.min(1, (top.length + bottom.length) / (2 * scored.metrics.width));
        const verticalSupport = Math.min(1, (left.length + right.length) / (2 * scored.metrics.height));
        const support = horizontalSupport * verticalSupport;
        const geometryScore = scored.score * 0.84 + support * 0.16;
        if (!best || geometryScore > best.geometryScore) {
          best = { corners: expandQuad(scored.metrics.ordered, imageSize, 0.012), geometryScore, detector: { lineSupport: support } };
        }
      }
    }
    return best;
  } finally {
    deleteMats(linesMat, edges, gray);
  }
}

function normalizeOutline(outline) {
  if (Array.isArray(outline) && outline.length === 4) return outline;
  if (Array.isArray(outline?.corners) && outline.corners.length === 4) return outline.corners;
  if ([outline?.x, outline?.y, outline?.width, outline?.height].every(Number.isFinite)) return rectangleCorners(outline);
  if ([outline?.left, outline?.top, outline?.right, outline?.bottom].every(Number.isFinite)) {
    return rectangleCorners({ x: outline.left, y: outline.top, width: outline.right - outline.left, height: outline.bottom - outline.top });
  }
  return null;
}

function centeredCrop(imageSize, scale, offsetX = 0, offsetY = 0) {
  const height = Math.min(imageSize.height * scale, imageSize.width / CARD_RATIO);
  const width = height * CARD_RATIO;
  const x = clamp((imageSize.width - width) / 2 + offsetX * imageSize.width, 0, imageSize.width - width);
  const y = clamp((imageSize.height - height) / 2 + offsetY * imageSize.height, 0, imageSize.height - height);
  return rectangleCorners({ x, y, width, height });
}

/**
 * Returns bounded, consistently rectified card proposals. Each proposal owns its `mat`; callers
 * must call `releaseCardProposals`. The source Mat remains caller-owned. Full image is always last.
 */
export function generateCardProposals(cv, source, {
  output = { width: 750, height: 1050 },
  outline = null,
  outlineExpansion = 0.045,
  centeredHeightFractions = DEFAULT_SCALES,
  centeredOffsets = [{ x: 0, y: -0.045 }, { x: 0, y: 0.045 }, { x: -0.04, y: 0 }, { x: 0.04, y: 0 }],
  offsetHeightFraction = 0.56,
  maxProposals = 16,
} = {}) {
  if (!source?.rows || !source?.cols) return [];
  const imageSize = { width: source.cols, height: source.rows };
  const definitions = [];
  const add = (definition) => {
    if (!definition?.corners || definitions.length >= maxProposals - 1 || duplicate(definitions, definition.corners, imageSize)) return;
    definitions.push(definition);
  };

  const detection = detectCardBoundary(cv, source, {
    minimumAreaFraction: 0.08,
    maximumAreaFraction: 0.97,
    minimumScore: 0.37,
  });
  if (detection.found) add({
    source: "contour",
    corners: detection.expandedCorners,
    geometryScore: detection.score,
    detector: { candidatesExamined: detection.candidatesExamined, boundaryScore: detection.score },
  });

  const outlineCorners = normalizeOutline(outline);
  if (outlineCorners) {
    const scored = scoreCardQuad(outlineCorners, imageSize, {
      minimumAreaFraction: 0.04, maximumAreaFraction: 1, minimumAspectRatio: 0.45, maximumAspectRatio: 0.95, maximumCenterDistance: 1,
    });
    add({
      source: "outline-expanded",
      corners: expandQuad(outlineCorners, imageSize, outlineExpansion),
      geometryScore: scored.accepted ? scored.score * 0.86 : 0.24,
      detector: { outlineExpansion },
    });
  }

  for (const candidate of minimumAreaProposals(cv, source)) add({ source: "min-area-rect", ...candidate });
  const hough = houghProposal(cv, source);
  if (hough) add({ source: "hough-lines", ...hough });

  for (const heightFraction of centeredHeightFractions) {
    const corners = centeredCrop(imageSize, heightFraction);
    const scored = scoreCardQuad(corners, imageSize, { minimumAreaFraction: 0.02, maximumAreaFraction: 1 });
    add({ source: "centered-aspect", corners, geometryScore: (scored.accepted ? scored.score : 0.4) * 0.72, detector: { heightFraction, offsetX: 0, offsetY: 0 } });
  }
  for (const offset of centeredOffsets) {
    const corners = centeredCrop(imageSize, offsetHeightFraction, offset.x, offset.y);
    const scored = scoreCardQuad(corners, imageSize, { minimumAreaFraction: 0.02, maximumAreaFraction: 1 });
    add({ source: "centered-aspect", corners, geometryScore: (scored.accepted ? scored.score : 0.4) * 0.68, detector: { heightFraction: offsetHeightFraction, offsetX: offset.x, offsetY: offset.y } });
  }

  definitions.push({
    source: "full-fallback",
    corners: rectangleCorners({ x: 0, y: 0, width: source.cols - 1, height: source.rows - 1 }),
    geometryScore: 0.05,
    isFallback: true,
  });

  const proposals = [];
  try {
    for (const [index, definition] of definitions.slice(0, maxProposals).entries()) {
      const mat = rectifyCardPerspective(cv, source, definition.corners, output);
      proposals.push({
        id: `${definition.source}-${index + 1}`,
        source: definition.source,
        corners: definition.corners,
        geometryScore: definition.geometryScore,
        quality: qualityFor(definition.corners, imageSize),
        detector: definition.detector ?? null,
        isFallback: Boolean(definition.isFallback),
        width: mat.cols,
        height: mat.rows,
        mat,
      });
    }
    return proposals;
  } catch (error) {
    releaseCardProposals(proposals);
    throw error;
  }
}

export function releaseCardProposals(proposals) {
  for (const proposal of proposals ?? []) proposal?.mat?.delete?.();
}

/**
 * Orders proposal execution without changing the proposal set or its geometry. This is kept
 * separate from generation so staged analysis can try the highest-yield real-photo crops first
 * while retaining every proposal and the full-frame fallback.
 */
export function orderCardProposalsForExecution(proposals, targetCenteredScale = 0.58) {
  const entries = (proposals ?? []).map((proposal, index) => ({ proposal, index }));
  const centered = entries.filter(({ proposal }) => proposal.source === "centered-aspect");
  const unoffsetCentered = centered.filter(({ proposal }) => {
    const { offsetX = 0, offsetY = 0 } = proposal.detector ?? {};
    return offsetX === 0 && offsetY === 0;
  });
  const preferredCentered = [...unoffsetCentered].sort((first, second) => (
    Math.abs((first.proposal.detector?.heightFraction ?? 0) - targetCenteredScale)
      - Math.abs((second.proposal.detector?.heightFraction ?? 0) - targetCenteredScale)
      || first.index - second.index
  ))[0]?.proposal;

  const priority = ({ proposal, index }) => {
    if (proposal.source === "contour") return [0, 0, index];
    if (proposal.source === "min-area-rect") return [1, 0, index];
    if (proposal.source === "outline-expanded") return [2, 0, index];
    if (proposal === preferredCentered) return [3, 0, index];
    if (proposal.source === "hough-lines") return [4, 0, index];
    if (proposal.source === "centered-aspect") {
      const { heightFraction = 0, offsetX = 0, offsetY = 0 } = proposal.detector ?? {};
      const isOffset = offsetX !== 0 || offsetY !== 0;
      return [isOffset ? 6 : 5, Math.abs(heightFraction - targetCenteredScale), index];
    }
    if (proposal.source === "full-fallback" || proposal.isFallback) return [100, 0, index];
    return [7, 0, index];
  };

  return entries.sort((first, second) => {
    const firstPriority = priority(first);
    const secondPriority = priority(second);
    for (let index = 0; index < firstPriority.length; index += 1) {
      if (firstPriority[index] !== secondPriority[index]) return firstPriority[index] - secondPriority[index];
    }
    return 0;
  }).map(({ proposal }) => proposal);
}
