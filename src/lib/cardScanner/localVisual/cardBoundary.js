import { expandQuad, orientQuadForPortrait, scoreCardQuad } from "./quadGeometry.js";

const deleteMats = (...mats) => {
  for (const mat of mats) mat?.delete?.();
};

function contourPoints(approximation) {
  const values = approximation.data32S?.length ? approximation.data32S : approximation.data32F;
  const points = [];
  for (let index = 0; index < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
  return points;
}

/**
 * Finds a plausible card border and returns only plain data. All temporary Mats are released here;
 * the supplied source Mat remains owned by the caller.
 */
export function detectCardBoundary(cv, source, {
  minimumScore = 0.43,
  borderMargin = 0.015,
  cannyLow = 45,
  cannyHigh = 145,
  ...scoreOptions
} = {}) {
  if (!source?.rows || !source?.cols) return { found: false, corners: null, fallbackReason: "empty-image", candidatesExamined: 0 };

  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let kernel;
  let candidatesExamined = 0;
  let best = null;

  try {
    if (source.channels() === 4) cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    else if (source.channels() === 3) cv.cvtColor(source, gray, cv.COLOR_RGB2GRAY);
    else source.copyTo(gray);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, cannyLow, cannyHigh);
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imageSize = { width: source.cols, height: source.rows };
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const approximation = new cv.Mat();
      try {
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approximation, perimeter * 0.02, true);
        if (approximation.rows !== 4 || !cv.isContourConvex(approximation)) continue;
        candidatesExamined += 1;
        const points = contourPoints(approximation);
        const scored = scoreCardQuad(points, imageSize, scoreOptions);
        if (scored.accepted && (!best || scored.score > best.score)) best = { ...scored, points };
      } finally {
        deleteMats(approximation, contour);
      }
    }

    if (!best || best.score < minimumScore) {
      return {
        found: false,
        corners: null,
        fallbackReason: best ? "uncertain-card-boundary" : "no-card-quadrilateral",
        candidatesExamined,
        bestScore: best?.score ?? 0,
      };
    }

    return {
      found: true,
      corners: best.metrics.ordered,
      expandedCorners: expandQuad(best.metrics.ordered, imageSize, borderMargin),
      score: best.score,
      metrics: { ...best.metrics, ordered: undefined },
      fallbackReason: null,
      candidatesExamined,
    };
  } finally {
    deleteMats(kernel, hierarchy, contours, edges, blurred, gray);
  }
}

/**
 * Returns a new portrait Mat. The caller must call delete() on the returned Mat.
 * A contour cannot resolve semantic 180-degree orientation; later OCR/visual scoring must do that.
 */
export function rectifyCardPerspective(cv, source, corners, {
  width = 750,
  height = 1050,
  interpolation = cv.INTER_LINEAR,
} = {}) {
  const portraitCorners = orientQuadForPortrait(corners);
  const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, portraitCorners.flatMap(({ x, y }) => [x, y]));
  const destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
  let transform;
  const output = new cv.Mat();
  try {
    transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);
    cv.warpPerspective(source, output, transform, new cv.Size(width, height), interpolation, cv.BORDER_REPLICATE);
    return output;
  } catch (error) {
    output.delete();
    throw error;
  } finally {
    deleteMats(transform, destinationPoints, sourcePoints);
  }
}

/** Browser convenience wrapper. It owns and releases every Mat it creates. */
export function detectAndRectifyToCanvas(cv, imageElementOrCanvas, outputCanvas, options = {}) {
  const source = cv.imread(imageElementOrCanvas);
  let rectified;
  try {
    const detection = detectCardBoundary(cv, source, options.detection);
    if (!detection.found) return detection;
    rectified = rectifyCardPerspective(cv, source, detection.expandedCorners, options.output);
    cv.imshow(outputCanvas, rectified);
    return { ...detection, outputWidth: rectified.cols, outputHeight: rectified.rows };
  } finally {
    deleteMats(rectified, source);
  }
}
