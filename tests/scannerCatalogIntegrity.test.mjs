import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import legacyCardQuarantine from "../src/data/legacyCardQuarantine.json" with { type: "json" };
import { buildScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";

const catalog = buildScannerCatalog();
const byId = new Map(catalog.map((entry) => [entry.cardId, entry]));

test("scanner catalog count and identities match generated release metadata", async () => {
  const metadata = JSON.parse(
    await readFile(new URL("../public/scanner-ai/catalog-embeddings.meta.json", import.meta.url), "utf8")
  );
  assert.equal(catalog.length, metadata.count);
  assert.equal(byId.size, metadata.count);
  assert.equal(metadata.cardIds.every((cardId) => byId.has(cardId)), true);

  for (const card of legacyCardQuarantine) {
    assert.equal(byId.has(card.id), false, `${card.id} leaked into the trusted scanner catalog`);
  }
});

test("scanner OCR denominators use explicit prefixed-subset totals", () => {
  for (const [cardId, printedSetTotal] of [
    ["ecard2-H1", "32"],
    ["ecard3-H1", "32"],
    ["bw11-RC1", "25"],
    ["g1-rc1-chikorita", "32"],
    ["hidden-fates-SV1-scyther", "94"],
    ["shining-fates-SV001-rowlet", "122"],
    ["brilliant-stars-TG01-flareon", "30"],
    ["crown-zenith-GG01-hisuian-voltorb", "70"],
  ]) {
    assert.equal(byId.get(cardId)?.printedSetTotal, printedSetTotal, cardId);
  }
});

test("scanner leaves prefixes without a printed denominator blank", () => {
  for (const cardId of [
    "pl2-RT1",
    "pl3-SH7",
    "pl4-AR1",
    "pl4-SH10",
    "col1-SL1",
    "pl1-SH4",
  ]) {
    assert.equal(byId.get(cardId)?.printedSetTotal, "", cardId);
  }
});
