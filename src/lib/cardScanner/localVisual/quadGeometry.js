export const POKEMON_CARD_ASPECT_RATIO = 2.5 / 3.5;

const finitePoint = (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function signedPolygonArea(points) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

/** Returns corners clockwise in screen coordinates: top-left, top-right, bottom-right, bottom-left. */
export function orderQuadCorners(points) {
  if (!Array.isArray(points) || points.length !== 4 || !points.every(finitePoint)) {
    throw new TypeError("A quadrilateral requires four finite {x, y} points.");
  }

  const unique = new Set(points.map(({ x, y }) => `${x}:${y}`));
  if (unique.size !== 4) throw new TypeError("Quadrilateral corners must be distinct.");

  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const cyclic = points
    .map(({ x, y }) => ({ x, y }))
    .sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const topLeftIndex = cyclic.reduce((best, point, index) => point.x + point.y < cyclic[best].x + cyclic[best].y ? index : best, 0);
  let ordered = [...cyclic.slice(topLeftIndex), ...cyclic.slice(0, topLeftIndex)];

  // Clockwise screen-space quads have positive shoelace area.
  if (signedPolygonArea(ordered) < 0) ordered = [ordered[0], ...ordered.slice(1).reverse()];
  if (Math.abs(signedPolygonArea(ordered)) < 1e-6) throw new TypeError("Quadrilateral corners must enclose an area.");
  return ordered;
}

export function getQuadMetrics(points, imageSize) {
  const ordered = orderQuadCorners(points);
  const [topLeft, topRight, bottomRight, bottomLeft] = ordered;
  const width = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2;
  const height = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2;
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const area = Math.abs(signedPolygonArea(ordered));
  const frameArea = imageSize?.width > 0 && imageSize?.height > 0 ? imageSize.width * imageSize.height : 0;
  const center = ordered.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const halfDiagonal = frameArea ? Math.hypot(imageSize.width, imageSize.height) / 2 : 0;
  const centerDistance = halfDiagonal
    ? Math.hypot(center.x - imageSize.width / 2, center.y - imageSize.height / 2) / halfDiagonal
    : 0;

  return {
    ordered,
    width,
    height,
    portraitAspectRatio: longEdge ? shortEdge / longEdge : 0,
    area,
    areaFraction: frameArea ? area / frameArea : 0,
    center,
    centerDistance,
  };
}

export function scoreCardQuad(points, imageSize, {
  targetAspectRatio = POKEMON_CARD_ASPECT_RATIO,
  minimumAreaFraction = 0.14,
  maximumAreaFraction = 0.99,
  minimumAspectRatio = 0.5,
  maximumAspectRatio = 0.88,
  maximumCenterDistance = 0.82,
} = {}) {
  let metrics;
  try {
    metrics = getQuadMetrics(points, imageSize);
  } catch {
    return { accepted: false, score: 0, reason: "invalid-quadrilateral", metrics: null };
  }

  if (metrics.areaFraction < minimumAreaFraction) return { accepted: false, score: 0, reason: "card-too-small", metrics };
  if (metrics.areaFraction > maximumAreaFraction) return { accepted: false, score: 0, reason: "contour-fills-frame", metrics };
  if (metrics.portraitAspectRatio < minimumAspectRatio || metrics.portraitAspectRatio > maximumAspectRatio) {
    return { accepted: false, score: 0, reason: "unlikely-card-aspect-ratio", metrics };
  }
  if (metrics.centerDistance > maximumCenterDistance) return { accepted: false, score: 0, reason: "card-too-far-from-frame", metrics };

  const aspectScore = Math.exp(-Math.abs(Math.log(metrics.portraitAspectRatio / targetAspectRatio)) * 4);
  const areaScore = Math.min(1, metrics.areaFraction / 0.55);
  const locationScore = Math.max(0, 1 - metrics.centerDistance / maximumCenterDistance);
  return {
    accepted: true,
    score: 0.48 * aspectScore + 0.37 * areaScore + 0.15 * locationScore,
    reason: null,
    metrics,
  };
}

/** Expands a detected edge slightly so perspective correction retains the printed border. */
export function expandQuad(points, imageSize, marginFraction = 0.015) {
  const ordered = orderQuadCorners(points);
  const center = ordered.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const scale = 1 + Math.max(0, marginFraction) * 2;
  const maximumX = imageSize?.width > 0 ? imageSize.width - 1 : Number.POSITIVE_INFINITY;
  const maximumY = imageSize?.height > 0 ? imageSize.height - 1 : Number.POSITIVE_INFINITY;
  return ordered.map((point) => ({
    x: clamp(center.x + (point.x - center.x) * scale, 0, maximumX),
    y: clamp(center.y + (point.y - center.y) * scale, 0, maximumY),
  }));
}

/** Makes the short edge the output width. Semantic 180-degree orientation needs OCR/visual evidence. */
export function orientQuadForPortrait(points) {
  const ordered = orderQuadCorners(points);
  const metrics = getQuadMetrics(ordered);
  return metrics.width <= metrics.height ? ordered : [ordered[1], ordered[2], ordered[3], ordered[0]];
}
