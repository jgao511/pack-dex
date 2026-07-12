import test from "node:test";
import assert from "node:assert/strict";
import { rankCardMatches } from "../src/lib/cardScanner/rankCardMatches.js";
import { extractCollectorNumbers } from "../src/lib/cardScanner/extractCollectorNumbers.js";

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
