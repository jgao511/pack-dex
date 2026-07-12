function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Maps a CSS-space outline over an object-fit: cover preview into capture pixels. */
export function mapPreviewOutlineToCapture({ previewWidth, previewHeight, captureWidth, captureHeight, outline, safetyMargin = 0.025 }) {
  if (![previewWidth, previewHeight, captureWidth, captureHeight].every((value) => value > 0)) return null;
  const scale = Math.max(previewWidth / captureWidth, previewHeight / captureHeight);
  const renderedWidth = captureWidth * scale;
  const renderedHeight = captureHeight * scale;
  const offsetX = (renderedWidth - previewWidth) / 2;
  const offsetY = (renderedHeight - previewHeight) / 2;
  const marginX = outline.width * safetyMargin;
  const marginY = outline.height * safetyMargin;
  const left = clamp((outline.x - marginX + offsetX) / scale, 0, captureWidth);
  const top = clamp((outline.y - marginY + offsetY) / scale, 0, captureHeight);
  const right = clamp((outline.x + outline.width + marginX + offsetX) / scale, 0, captureWidth);
  const bottom = clamp((outline.y + outline.height + marginY + offsetY) / scale, 0, captureHeight);
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}
