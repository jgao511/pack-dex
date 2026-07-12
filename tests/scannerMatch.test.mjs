import test from "node:test";
import assert from "node:assert/strict";
import { rankCardMatches } from "../src/lib/cardScanner/rankCardMatches.js";
import { extractCollectorNumbers } from "../src/lib/cardScanner/extractCollectorNumbers.js";
import { rerankMatchesByImage } from "../src/lib/cardScanner/rerankMatchesByImage.js";

function expectTop(rawText, setId, number, confidence = "high") {
  const output = rankCardMatches({ rawText });
  assert.equal(output.results[0]?.setId, setId);
  assert.equal(String(output.results[0]?.card.number), number);
  assert.equal(output.confidence, confidence);
}

test("matches modern name, number, and printed total", () => expectTop("Charizard ex\n199/165", "151", "199"));
test("corrects a conservative OCR name mistake", () => expectTop("UMBRE0N EX\n161 / 131\n2025 Pokémon", "prismatic-evolutions", "161"));
test("matches Trainer Gallery prefixes", () => expectTop("Pikachu\nTG05/TG30", "lost-origin", "TG05"));
test("matches Galarian Gallery prefixes", () => expectTop("Mewtwo VSTAR\nGG44/GG70", "crown-zenith", "GG44"));
test("matches a vintage duplicate name using its total", () => expectTop("Pikachu\n58/102", "base-set", "58"));
test("name-only duplicates do not auto-select", () => { const out = rankCardMatches({ rawText: "Pikachu" }); assert.notEqual(out.confidence, "high"); assert.equal(out.primaryMatch, null); assert.ok(out.results.length > 1); });
test("copyright noise has no reliable match", () => { const out = rankCardMatches({ rawText: "copyright 2025 pokemon creatures inc" }); assert.equal(out.confidence, "low"); assert.equal(out.results.length, 0); });
test("set totals support number-only matches", () => expectTop("203/198", "scarlet-violet", "203"));
test("handles secret-card numbering above the printed total", () => expectTop("205/198", "scarlet-violet", "205"));
test("parses full-width slash, prefixes, promos, and leading zeros", () => {
  assert.deepEqual(extractCollectorNumbers("203／198 TG23/TG30 SWSH262 025/165 2025").map((x) => [x.normalized, x.normalizedTotal]), [["203", "198"], ["TG23", "TG30"], ["25", "165"], ["SWSH262", null]]);
});

test("prioritizes corrected collector numbers from bottom passes and rejects HP/year noise", () => {
  const parsed = extractCollectorNumbers("", [
    { text: "120 HP 2025", sourcePass: "full-card" },
    { text: "I99 / I65", sourcePass: "collector-bottom-right" },
  ]);
  assert.equal(parsed.some((item) => item.normalized === "120"), false);
  assert.equal(parsed.some((item) => item.normalized === "2025"), false);
  const collector = parsed.find((item) => item.normalized === "199");
  assert.equal(collector.normalizedTotal, "165");
  assert.equal(collector.sourcePass, "collector-bottom-right");
});

test("weak unrelated OCR does not return random candidates", () => {
  const output = rankCardMatches({ rawText: "retreat energy weakness resistance 120 damage" });
  assert.equal(output.results.length, 0);
  assert.equal(output.primaryMatch, null);
});

test("optional image reranking can only reorder the OCR shortlist", async () => {
  const candidates = [
    { card: { id: "sv1-1" }, score: 80 },
    { card: { id: "sv1-2" }, score: 70 },
  ];

  const reordered = await rerankMatchesByImage(
    { uri: "local-photo" },
    candidates,
    async (_photo, shortlist) => [...shortlist].reverse(),
  );
  assert.deepEqual(reordered.map(({ card }) => card.id), ["sv1-2", "sv1-1"]);

  const injected = await rerankMatchesByImage(
    { uri: "local-photo" },
    candidates,
    async () => [{ card: { id: "unrelated" } }, candidates[0]],
  );
  assert.equal(injected, candidates);
});

test("matches the Pixel Mega Charizard OCR fixture without unrelated fallbacks", () => {
  const output = rankCardMatches({ rawText: "Mega Charizard XeA360\nO1B/094" });
  assert.equal(output.results[0]?.cardId, "phantasmal-flames-13-mega-charizard-x-ex");
  assert.equal(output.results.some((result) => result.card.number === "18"), false);
  assert.equal(output.primaryMatch?.cardId, "phantasmal-flames-13-mega-charizard-x-ex");
  assert.deepEqual(output.collectorNumbers.map((item) => `${item.cardNumber}/${item.printedSetTotal}`), ["013/094", "018/094"]);
});

test("matches the exact reference-image ML Kit output and rejects attack numbers", () => {
  const output = rankCardMatches({ rawText: "Mega ChartzardX\ne360\nweakness 4 x2\n90x\nOPFLEN O13/094", textBlocks: [
    { text: "Mega ChartzardX\ne360", sourcePass: "name-top" },
    { text: "weakness 4 x2\n90x", sourcePass: "full-card" },
    { text: "OPFLEN O13/094", sourcePass: "collector-bottom" },
  ] });
  assert.equal(output.confidence, "high");
  assert.deepEqual(output.results.map((result) => result.cardId), ["phantasmal-flames-13-mega-charizard-x-ex"]);
  assert.equal(output.collectorNumbers.some((number) => number.normalized === "4" || number.normalized === "90"), false);
});
