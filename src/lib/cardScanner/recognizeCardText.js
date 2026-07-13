export class CardRecognitionError extends Error {
  constructor(code, message) { super(message); this.name = "CardRecognitionError"; this.code = code; }
}

function normalizeBox(box) {
  if (!box || typeof box !== "object") return undefined;
  return { ...box };
}

function normalizeLine(line) { return { text: String(line?.text || "").trim(), boundingBox: normalizeBox(line?.boundingBox), elements: (line?.elements || []).map((element) => ({ text: String(element?.text || "").trim(), boundingBox: normalizeBox(element?.boundingBox) })) }; }

export function normalizeOcrResult(result) {
  if (!result) return { fullText: "", blocks: [] };
  const sourceBlocks = result.blocks || result.textBlocks || result.lines || [];
  const blocks = sourceBlocks.map((block) => typeof block === "string" ? { text: block } : ({
    text: String(block?.text || "").trim(),
    ...(Number.isFinite(Number(block?.confidence)) ? { confidence: Number(block.confidence) } : {}),
    ...(block?.boundingBox || block?.frame ? { boundingBox: normalizeBox(block.boundingBox || block.frame) } : {}),
    ...(block?.lines ? { lines: block.lines.map(normalizeLine) } : {}),
    ...(block?.sourcePass ? { sourcePass: block.sourcePass } : {}),
  })).filter((block) => block.text);
  return { fullText: String(result.fullText ?? result.text ?? blocks.map((block) => block.text).join("\n")).trim(), blocks, ...(result.passes ? { passes: result.passes } : {}), ...(result.ocrMatch ? { ocrMatch: result.ocrMatch } : {}), ...(result.visualMatch ? { visualMatch: result.visualMatch } : {}), ...(result.visualError ? { visualError: result.visualError } : {}), ...(result.scannerTiming ? { scannerTiming: result.scannerTiming } : {}), ...(result.previewUrl ? { previewUrl: result.previewUrl } : {}), ...(result.proposalPreviews ? { proposalPreviews: result.proposalPreviews } : {}), ...(result.originalPreviewUrl ? { originalPreviewUrl: result.originalPreviewUrl } : {}), ...(result.outlinePreviewUrl ? { outlinePreviewUrl: result.outlinePreviewUrl } : {}), ...(result.bottomPreviewUrl ? { bottomPreviewUrl: result.bottomPreviewUrl } : {}), ...(result.imageDiagnostics ? { imageDiagnostics: result.imageDiagnostics } : {}) };
}

export async function recognizeCardText(image, { adapter } = {}) {
  if (!adapter?.recognize) throw new CardRecognitionError("unavailable", "Card reading is not available in this browser build.");
  try { return normalizeOcrResult(await adapter.recognize(image)); }
  catch (error) { if (error instanceof CardRecognitionError) throw error; throw new CardRecognitionError("failed", "We couldn’t read this card. Try another photo with the full card in view."); }
}
