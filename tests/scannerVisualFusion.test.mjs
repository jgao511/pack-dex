import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import visualIndex from "../src/lib/cardScanner/generated/scannerVisualIndex.json" with { type: "json" };
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";
import { fuseCardMatches } from "../src/lib/cardScanner/fuseCardMatches.js";
import { calculateVisualDescriptorFromRgba, compareVisualDescriptors } from "../src/lib/cardScanner/localVisual/visualDescriptors.js";

const targetId = "phantasmal-flames-13-mega-charizard-x-ex";

async function descriptorFromBlob(blob) {
  const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).rotate().ensureAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return calculateVisualDescriptorFromRgba(data, info.width, info.height);
}
function search(descriptor, limit = 3) {
  return Object.entries(visualIndex.cards).map(([cardId, candidate]) => ({ cardId, ...compareVisualDescriptors(descriptor, candidate) })).sort((a, b) => b.score - a.score).slice(0, limit);
}

test("full visual manifest covers every trusted catalog card", () => {
  const catalog = buildScannerCatalog();
  assert.equal(Object.keys(visualIndex.cards).length, catalog.length);
  assert.equal(Object.keys(visualIndex.cards).length, 18747);
  assert.ok(visualIndex.cards[targetId]);
});

test("Mega reference follows a real Blob decode and ranks first in the full index", async () => {
  const bytes = await fs.readFile(new URL("./fixtures/scanner/mega-charizard-x-ex-013-094.jpg", import.meta.url));
  const descriptor = await descriptorFromBlob(new Blob([bytes], { type: "image/jpeg" }));
  const results = search(descriptor);
  assert.equal(results[0].cardId, targetId);
  assert.ok(results[0].score > .8);
});

test("fused evidence promotes OCR and visual agreement to high confidence", () => {
  const catalog = buildScannerCatalog(); const entry = catalog.find(({ cardId }) => cardId === targetId);
  const ocr = { results: [{ cardId: targetId, card: entry.card, setId: entry.setId, setName: entry.setName, score: 105, reasons: ["exact collector number (collector-bottom)", "exact printed set total", "strong name similarity"] }] };
  const visual = { lightweight: { candidates: [{ cardId: targetId, score: .95 }, { cardId: "ex9-5", score: .6 }] }, orb: { candidates: [{ cardId: targetId, score: .55, inliers: 40 }, { cardId: "ex9-5", score: .04, inliers: 1 }] } };
  const fused = fuseCardMatches(ocr, visual, catalog);
  assert.equal(fused.confidence, "high"); assert.equal(fused.primaryMatch.cardId, targetId);
});

test("Gardevoir visual evidence prevents an unrelated Groudon OCR fallback", () => {
  const catalog = buildScannerCatalog(); const groudon = catalog.find(({ cardId }) => cardId === "ex9-5");
  const ocr = { results: [{ cardId: groudon.cardId, card: groudon.card, setId: groudon.setId, setName: groudon.setName, score: 80, reasons: ["strong name similarity"] }] };
  const visual = { lightweight: { candidates: [{ cardId: "ex1-7", score: .95 }, { cardId: groudon.cardId, score: .55 }] }, orb: { candidates: [{ cardId: "ex1-7", score: .55, inliers: 38 }, { cardId: groudon.cardId, score: .03, inliers: 0 }] } };
  const fused = fuseCardMatches(ocr, visual, catalog);
  assert.equal(fused.results[0].cardId, "ex1-7");
  assert.notEqual(fused.confidence, "high");
});

test("close weak visual scores expose no arbitrary first-place card", () => {
  const visual = { lightweight: { candidates: [{ cardId: "ex1-7", score: .6 }, { cardId: "ex9-5", score: .59 }] }, orb: { candidates: [] } };
  const fused = fuseCardMatches({ results: [] }, visual, buildScannerCatalog());
  assert.equal(fused.confidence, "low"); assert.deepEqual(fused.results, []);
});

test("distinctive visual-only evidence stays selectable but does not auto-confirm", () => {
  const visual = { lightweight: { candidates: [{ cardId: targetId, score: .84 }, { cardId: "ex9-5", score: .73 }] }, orb: { candidates: [{ cardId: targetId, score: .72, inliers: 42 }, { cardId: "ex9-5", score: .08, inliers: 1 }] } };
  const fused = fuseCardMatches({ results: [] }, visual, buildScannerCatalog());
  assert.equal(fused.confidence, "medium"); assert.equal(fused.results[0].cardId, targetId); assert.equal(fused.primaryMatch, null);
});

test("ORB can recover an OCR-compatible card from outside the lightweight top forty", () => {
  const catalog = buildScannerCatalog(); const expected = catalog.find(({ cardId }) => cardId === "xy12-55-diglett");
  const ocr = { narrowedCardIds: [expected.cardId], results: [{ cardId: "base1-47", card: catalog.find(({ cardId }) => cardId === "base1-47").card, score: 30, reasons: ["exact normalized name"] }] };
  const visual = {
    lightweight: { candidates: [{ cardId: "unrelated", score: .68 }] },
    orb: { candidates: [{ cardId: expected.cardId, score: .97, inliers: 84 }, { cardId: "unrelated", score: .2, inliers: 4 }] },
  };
  const fused = fuseCardMatches(ocr, visual, catalog);
  assert.equal(fused.results[0]?.cardId, expected.cardId);
  assert.equal(fused.confidence, "medium");
  assert.equal(fused.results.some(({ cardId }) => cardId === "unrelated"), false);
});
