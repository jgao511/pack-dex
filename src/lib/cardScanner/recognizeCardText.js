export class CardRecognitionError extends Error {
  constructor(code, message) { super(message); this.name = "CardRecognitionError"; this.code = code; }
}

function normalizeBox(box) {
  if (!box || typeof box !== "object") return undefined;
  return { ...box };
}

export function normalizeOcrResult(result) {
  if (!result) return { fullText: "", blocks: [] };
  const sourceBlocks = result.blocks || result.textBlocks || result.lines || [];
  const blocks = sourceBlocks.map((block) => typeof block === "string" ? { text: block } : ({
    text: String(block?.text || "").trim(),
    ...(Number.isFinite(Number(block?.confidence)) ? { confidence: Number(block.confidence) } : {}),
    ...(block?.boundingBox || block?.frame ? { boundingBox: normalizeBox(block.boundingBox || block.frame) } : {}),
  })).filter((block) => block.text);
  return { fullText: String(result.fullText ?? result.text ?? blocks.map((block) => block.text).join("\n")).trim(), blocks };
}

export async function recognizeCardText(image, { adapter } = {}) {
  if (!adapter?.recognize) throw new CardRecognitionError("unavailable", "Card reading is not available in this browser build.");
  try { return normalizeOcrResult(await adapter.recognize(image)); }
  catch (error) { if (error instanceof CardRecognitionError) throw error; throw new CardRecognitionError("failed", "We couldn’t read this card. Try another photo with the full card in view."); }
}
