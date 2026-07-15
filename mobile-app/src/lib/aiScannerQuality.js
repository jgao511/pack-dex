function luma(red, green, blue) { return (red * .2126) + (green * .7152) + (blue * .0722); }

function componentMetrics(mask, width, height, luminance) {
  const seen = new Uint8Array(mask.length); let largest = null;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let count = 0; let topCount = 0; let touchesEdge = false; let boundarySum = 0; let boundaryCount = 0;
    while (queue.length) {
      const point = queue.pop(); const x = point % width; const y = Math.floor(point / width); count += 1;
      if (y < height * .3) topCount += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
        if (!mask[next]) { boundarySum += Math.abs(luminance[point] - luminance[next]); boundaryCount += 1; }
      }
    }
    const result = { count, topFraction: topCount / Math.max(1, count), touchesEdge, boundaryContrast: boundarySum / Math.max(1, boundaryCount) };
    if (!largest || result.count > largest.count) largest = result;
  }
  return largest || { count: 0, topFraction: 0, touchesEdge: false, boundaryContrast: 0 };
}

// Reflection must be a clipped, smooth, interior, sharply bounded highlight.
// Printed white artwork frequently clips too, but typically reaches an image
// edge or lacks the compact highlight boundary; it is intentionally not enough.
export function measureAiScanQuality({ data, width, height, cropAreaFraction = 1 }) {
  const step = 3; const sampledWidth = Math.floor(width / step); const sampledHeight = Math.floor(height / step);
  const luminance = new Float32Array(sampledWidth * sampledHeight); const highlight = new Uint8Array(luminance.length);
  let samples = 0; let clipped = 0; let lumaTotal = 0; let laplacian = 0; let laplacianSamples = 0;
  for (let y = 0; y < sampledHeight; y += 1) for (let x = 0; x < sampledWidth; x += 1) {
    const source = ((y * step) * width + (x * step)) * 4; const red = data[source]; const green = data[source + 1]; const blue = data[source + 2];
    const index = y * sampledWidth + x; const value = luma(red, green, blue); luminance[index] = value; lumaTotal += value; samples += 1;
    // Requiring all three channels to clip rejects merely bright colored art.
    if (red >= 250 && green >= 250 && blue >= 250 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 12) { highlight[index] = 1; clipped += 1; }
  }
  for (let y = 1; y < sampledHeight - 1; y += 1) for (let x = 1; x < sampledWidth - 1; x += 1) {
    const index = y * sampledWidth + x; const value = luminance[index];
    laplacian += Math.abs((4 * value) - luminance[index - 1] - luminance[index + 1] - luminance[index - sampledWidth] - luminance[index + sampledWidth]); laplacianSamples += 1;
  }
  const largest = componentMetrics(highlight, sampledWidth, sampledHeight, luminance);
  const clippedFraction = clipped / Math.max(1, samples); const largestHighlightFraction = largest.count / Math.max(1, samples);
  const concentratedTop = largest.topFraction >= .28;
  const glareWarning = clippedFraction >= .012
    && largestHighlightFraction >= .008
    && !largest.touchesEdge
    && largest.boundaryContrast >= 20
    && concentratedTop;
  return {
    cropAreaFraction,
    sharpnessEstimate: laplacian / Math.max(1, laplacianSamples),
    meanLuminance: lumaTotal / Math.max(1, samples),
    clippedFraction,
    largestHighlightFraction,
    highlightBoundaryContrast: largest.boundaryContrast,
    topHighlightFraction: largest.topFraction * largestHighlightFraction,
    glareWarning,
  };
}

export function measureAiCanvasQuality(canvas, boundary) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const cropAreaFraction = Number.isFinite(boundary?.metrics?.areaFraction) ? boundary.metrics.areaFraction
    : Number.isFinite(boundary?.crop?.retainedAreaFraction) ? boundary.crop.retainedAreaFraction : 1;
  return measureAiScanQuality({ ...image, cropAreaFraction });
}
