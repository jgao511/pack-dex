import assert from "node:assert/strict";
import test from "node:test";
import { measureAiScanQuality } from "../mobile-app/src/lib/aiScannerQuality.js";
import { extractStructuredCardText } from "../src/lib/cardScanner/extractStructuredCardText.js";
import { buildCatalogCandidates, createCatalogCandidateIndex } from "../src/lib/cardScanner/aiVisual/catalogCandidateIndex.js";

function image(width, height, fill = 120) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set([fill, fill, fill, 255], index);
  return { data, width, height };
}
function whiteRect(sample, left, top, right, bottom) {
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    const index = (y * sample.width + x) * 4; sample.data.set([255, 255, 255, 255], index);
  }
}

test("glare needs an interior clipped highlight with a sharp top-region boundary", () => {
  const officialWhiteArtwork = image(120, 180); whiteRect(officialWhiteArtwork, 0, 0, 60, 80);
  const clean = measureAiScanQuality(officialWhiteArtwork);
  assert.equal(clean.glareWarning, false, "edge-touching printed white artwork is not glare");

  const glarePhoto = image(120, 180); whiteRect(glarePhoto, 35, 15, 85, 68);
  const glare = measureAiScanQuality(glarePhoto);
  assert.equal(glare.glareWarning, true);
  assert.ok(glare.clippedFraction > 0);
  assert.ok(glare.highlightBoundaryContrast >= 20);

  const brightButUnclipped = image(120, 180, 245);
  assert.equal(measureAiScanQuality(brightButUnclipped).glareWarning, false);
});

test("structured OCR extracts diagnostics while only catalog-backed name and collector fields narrow candidates", () => {
  const structured = extractStructuredCardText("Pikachu ex HP 200\nAbility: Volt Charge\nLightning Burst\n123/165\nRegulation G\n©2024 Pokémon");
  assert.deepEqual(structured.hp, ["200"]);
  assert.deepEqual(structured.regulationMarks, ["G"]);
  assert.deepEqual(structured.copyrightYears, ["2024"]);
  assert.ok(structured.abilityNames.includes("Volt Charge"));
  assert.ok(structured.collectorNumbers.some((value) => value.normalized === "123" && value.normalizedTotal === "165"));

  const index = createCatalogCandidateIndex([
    { cardId: "pikachu", name: "Pikachu ex", cardNumber: "123", printedSetTotal: "165", setId: "set" },
    { cardId: "other", name: "Pikachu ex", cardNumber: "124", printedSetTotal: "165", setId: "set" },
  ]);
  const narrowed = buildCatalogCandidates(index, { nameCandidates: structured.nameCandidates, collectorNumbers: structured.collectorNumbers });
  assert.equal(narrowed.mode, "number-name-intersection");
  assert.equal(narrowed.candidateIds[0], "pikachu", "exact name plus collector/total remains the strongest confirmation candidate");
  assert.equal(narrowed.stats.collectorPairMatchCount, 1);
});
