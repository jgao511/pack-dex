import assert from "node:assert/strict";
import test from "node:test";
import { getScannerCatalog } from "../src/lib/cardScanner/buildScannerCatalog.js";
import {
  buildCatalogCandidates,
  createCatalogCandidateIndex,
  createCollectorSearchVariants,
  normalizeCatalogSearchName,
} from "../src/lib/cardScanner/aiVisual/catalogCandidateIndex.js";

function catalogCard({ id, name, setId, number, total, rarity = "Rare" }) {
  return {
    cardId: id,
    name,
    setId,
    cardNumber: number,
    printedSetTotal: total,
    rarity,
    card: {
      id,
      name,
      setId,
      number,
      rarity,
      image: `/assets/sets/${setId}/cards/${id}.webp`,
    },
  };
}

const fixtureCatalog = [
  catalogCard({ id: "m-charizard-a", name: "M Charizard-EX", setId: "xy2", number: "13", total: "106" }),
  catalogCard({ id: "m-charizard-b", name: "M Charizard-EX", setId: "xy2", number: "108", total: "106" }),
  catalogCard({ id: "mega-charizard-x", name: "Mega Charizard X ex", setId: "pf", number: "013", total: "094" }),
  catalogCard({ id: "mega-charizard-x-alt", name: "Mega Charizard X ex", setId: "pf", number: "125", total: "094" }),
  catalogCard({ id: "charizard-ex-151", name: "Charizard ex", setId: "151", number: "199", total: "165" }),
  catalogCard({ id: "charizard-ex-of", name: "Charizard ex", setId: "of", number: "125", total: "197" }),
  catalogCard({ id: "charizard-base", name: "Charizard", setId: "base", number: "4", total: "102" }),
  catalogCard({ id: "rocket-meowth", name: "Team Rocket's Meowth", setId: "rocket", number: "18", total: "132" }),
  catalogCard({ id: "umbreon-ex", name: "Umbreon ex", setId: "prismatic", number: "161", total: "131" }),
  catalogCard({ id: "pikachu-base", name: "Pikachu", setId: "base", number: "58", total: "102" }),
  catalogCard({ id: "pikachu-jungle", name: "Pikachu", setId: "jungle", number: "60", total: "64" }),
  catalogCard({ id: "raichu-jungle", name: "Raichu", setId: "jungle", number: "14", total: "64" }),
  catalogCard({ id: "pikachu-delta", name: "Pikachu \u03b4", setId: "delta", number: "93", total: "113" }),
  catalogCard({ id: "pikachu-star", name: "Pikachu \u2605", setId: "delta", number: "104", total: "110" }),
  catalogCard({ id: "unown-question", name: "Unown [?]", setId: "unseen", number: "Q", total: "28" }),
  catalogCard({ id: "unown-exclamation", name: "Unown [!]", setId: "unseen", number: "!", total: "28" }),
];

function fixtureIndex() {
  return createCatalogCandidateIndex(fixtureCatalog);
}

test("scanner-AI catalog index keeps trusted metadata compact and card IDs unique", () => {
  const index = fixtureIndex();
  assert.equal(index.stats.cardCount, fixtureCatalog.length);
  assert.equal(index.stats.setCount, new Set(fixtureCatalog.map(({ setId }) => setId)).size);
  assert.equal(typeof index.bySetId.get("xy2")[0], "number");

  const target = index.cards[index.byCardId.get("mega-charizard-x")];
  assert.deepEqual(target.familyTokens, ["charizard"]);
  assert.equal(target.normalizedCollectorNumber, "13");
  assert.equal(target.normalizedPrintedTotal, "94");
  assert.equal(target.imageUrl, "https://assets.pack-dex.com/sets/pf/cards/mega-charizard-x.webp");

  assert.throws(
    () => createCatalogCandidateIndex([fixtureCatalog[0], fixtureCatalog[0]]),
    /Duplicate trusted card ID/,
  );
});

test("name normalization tolerates ordinary OCR punctuation but preserves identity-bearing symbols", () => {
  assert.equal(normalizeCatalogSearchName("Gardevoir-EX"), "gardevoir ex");
  assert.equal(normalizeCatalogSearchName("Team Rocket’s Meowth"), "team rockets meowth");
  assert.equal(normalizeCatalogSearchName("Pikachu \u03b4"), "pikachu delta");
  assert.equal(normalizeCatalogSearchName("Pikachu \u2605"), "pikachu star");
  assert.equal(normalizeCatalogSearchName("Nidoran \u2640"), "nidoran female");
  assert.equal(normalizeCatalogSearchName("Unown [?]"), "unown question");
  assert.equal(normalizeCatalogSearchName("Unown [!]"), "unown exclamation");
});

test("OCR-confused number/total plus OCR-confused name produces a tiny intersection", () => {
  const result = buildCatalogCandidates(fixtureIndex(), {
    names: [{ raw: "Mega Char1zard X e x", sourcePass: "name-top" }],
    collectorNumbers: [{
      raw: "O1B/O94",
      cardNumber: "013",
      printedSetTotal: "094",
      normalized: "13",
      normalizedTotal: "94",
      sourcePass: "collector-bottom",
    }],
  });

  assert.equal(result.mode, "number-name-intersection");
  assert.deepEqual(result.candidateIds, ["mega-charizard-x"]);
  assert.deepEqual(
    result.candidates[0].reasons.map(({ code }) => code),
    ["collector-number-total-ocr-corrected", "name-ocr-skeleton"],
  );
  assert.equal(result.candidates[0].reasons[0].query, "13/94");
  assert.equal(result.candidates[0].reasons[0].sourcePass, "collector-bottom");
  assert.deepEqual(result.candidates[0].reasons[0].corrections, ["O1B->13", "O94->94"]);
  assert.equal(result.stats.candidateCount < 20, true);
});

test("collector variants remain bounded while repairing common OCR characters", () => {
  const variants = createCollectorSearchVariants("O1B", ["SV", "TG", "GG"]);
  assert.equal(variants.length <= 12, true);
  assert.ok(variants.some(({ value, kind }) => value === "13" && kind === "ocr-corrected"));
  assert.ok(variants.some(({ value, kind }) => value === "18" && kind === "ocr-corrected"));
});

test("Mega and M prefix aliases do not collapse other Charizard forms", () => {
  const result = buildCatalogCandidates(fixtureIndex(), { names: ["Mega Charizard EX"] });
  assert.equal(result.mode, "exact-name");
  assert.deepEqual(result.candidateIds, ["m-charizard-a", "m-charizard-b"]);
  assert.ok(result.candidates.every(({ reasons }) => reasons[0].code === "name-mega-prefix-alias"));
  assert.equal(result.candidateIds.includes("mega-charizard-x"), false);
  assert.equal(result.candidateIds.includes("charizard-ex-151"), false);
});

test("apostrophe and spacing errors match owner names", () => {
  const result = buildCatalogCandidates(fixtureIndex(), { names: ["TEAM ROCKET S MEOWTH"] });
  assert.deepEqual(result.candidateIds, ["rocket-meowth"]);
  assert.equal(result.candidates[0].reasons[0].code, "name-spacing-punctuation");
});

test("strong name-only evidence returns every card with that canonical identity", () => {
  const result = buildCatalogCandidates(fixtureIndex(), { names: ["CHARIZARD-EX"] });
  assert.equal(result.mode, "exact-name");
  assert.deepEqual(result.candidateIds, ["charizard-ex-151", "charizard-ex-of"]);
  assert.equal(result.candidateIds.includes("charizard-base"), false);
  assert.equal(result.candidateIds.includes("m-charizard-a"), false);

  const pikachu = buildCatalogCandidates(fixtureIndex(), { names: ["Pikachu"] });
  assert.deepEqual(pikachu.candidateIds, ["pikachu-base", "pikachu-jungle"]);
  assert.equal(pikachu.candidateIds.includes("pikachu-delta"), false);
  assert.equal(pikachu.candidateIds.includes("pikachu-star"), false);
});

test("fuzzy matching unions cards from the top likely canonical names", () => {
  const result = buildCatalogCandidates(fixtureIndex(), { names: ["Pikchu"] }, {
    fuzzyNameLimit: 2,
  });
  assert.equal(result.mode, "fuzzy-name");
  assert.ok(result.candidateIds.includes("pikachu-base"));
  assert.ok(result.candidateIds.includes("pikachu-jungle"));
  assert.ok(result.candidates.every(({ reasons }) => reasons.some(({ code }) => code === "name-fuzzy")));
  assert.equal(result.stats.fuzzyNameGroupCount <= 2, true);
});

test("set evidence narrows a name group only when the evidence intersects", () => {
  const narrowed = buildCatalogCandidates(fixtureIndex(), {
    names: ["Pikachu"],
    setId: "jungle",
  });
  assert.deepEqual(narrowed.candidateIds, ["pikachu-jungle"]);
  assert.equal(narrowed.stats.setNarrowed, true);
  assert.deepEqual(
    narrowed.candidates[0].reasons.map(({ code }) => code),
    ["name-exact", "set-exact"],
  );

  const conflicting = buildCatalogCandidates(fixtureIndex(), {
    names: ["Pikachu"],
    setId: "xy2",
  });
  assert.deepEqual(conflicting.candidateIds, ["pikachu-base", "pikachu-jungle"]);
  assert.equal(conflicting.stats.setNarrowed, false);
});

test("conflicting name and number channels are unioned instead of eliminating the right card", () => {
  const result = buildCatalogCandidates(fixtureIndex(), {
    names: ["Pikachu"],
    collectorNumbers: ["199/165"],
  });
  assert.equal(result.mode, "ocr-evidence-union");
  assert.equal(result.evidenceConflict, true);
  assert.ok(result.candidateIds.includes("charizard-ex-151"));
  assert.ok(result.candidateIds.includes("pikachu-base"));
  assert.ok(result.candidateIds.includes("pikachu-jungle"));
});

test("a collector number without a reliable total keeps one-edit same-name variants searchable", () => {
  const index = createCatalogCandidateIndex([
    catalogCard({ id: "same-name-12", name: "Testmon ex", setId: "alpha", number: "12", total: "100" }),
    catalogCard({ id: "same-name-13", name: "Testmon ex", setId: "alpha", number: "13", total: "100" }),
    catalogCard({ id: "other-13", name: "Othermon ex", setId: "beta", number: "13", total: "100" }),
  ]);
  const result = buildCatalogCandidates(index, {
    names: ["Testmon ex"],
    collectorNumbers: [{ raw: "13", normalized: "13", sourcePass: "collector-bottom" }],
  });
  assert.equal(result.mode, "number-name-intersection");
  assert.deepEqual(new Set(result.candidateIds), new Set(["same-name-12", "same-name-13"]));
  assert.ok(result.candidates.find(({ cardId }) => cardId === "same-name-12").reasons.some(({ code }) => code === "collector-number-near"));
  assert.equal(result.candidateIds.includes("other-13"), false);
});

test("unreliable set support boosts evidence without eliminating name variants", () => {
  const result = buildCatalogCandidates(fixtureIndex(), {
    names: ["Pikachu"],
    setId: { setId: "jungle", reliable: false },
  });
  assert.deepEqual(result.candidateIds, ["pikachu-jungle", "pikachu-base"]);
  assert.equal(result.stats.setNarrowed, false);
  assert.ok(result.candidates[0].reasons.some(({ code }) => code === "set-support"));
});

test("fuzzy OCR work is bounded before edit-distance scoring", () => {
  const index = createCatalogCandidateIndex(getScannerCatalog());
  const noisyNames = [
    "Pikkachuu", "Charzard ex", "Umbreon e x", "Gardevoirr", "Bulbasaurr",
    "Squirt1e", "Team Roket Meowth", "Mewtoo", "Rayquazza", "Gengarr",
    "Dragonitte", "Greninjaa", "Sylveonn", "Lucarrio", "Tyrannitarr",
    "Eeveee", "Blastoisse", "Venusaurr", "Machammp", "Alakazamm",
  ];
  const started = performance.now();
  const result = buildCatalogCandidates(index, { names: noisyNames });
  const elapsed = performance.now() - started;
  assert.equal(result.stats.fuzzyQueriesUsed, 4);
  assert.ok(result.stats.fuzzyScannedGroupCount <= 4 * 128);
  assert.ok(elapsed < 500, `bounded fuzzy lookup took ${elapsed.toFixed(1)}ms`);
});

test("weak OCR keeps the complete catalog searchable and records the fallback reason", () => {
  const index = fixtureIndex();
  const result = buildCatalogCandidates(index, { names: ["weakness resistance retreat energy"] });
  assert.equal(result.mode, "full-catalog-fallback");
  assert.equal(result.usedFullCatalogFallback, true);
  assert.equal(result.candidates.length, index.cards.length);
  assert.ok(result.candidates.every(({ reasons }) => reasons[0].code === "full-catalog-fallback"));
});

test("default scanner-AI index wraps every trusted PackDex card and uses the asset helper", () => {
  const trustedCatalog = getScannerCatalog();
  const index = createCatalogCandidateIndex(trustedCatalog);
  assert.equal(index.cards.length, trustedCatalog.length);
  assert.equal(index.byCardId.size, trustedCatalog.length);
  assert.ok(index.cards.length > 18_000);
  assert.ok(index.cards.every(({ imageUrl }) => imageUrl.startsWith("https://assets.pack-dex.com/sets/")));

  const expectedPikachuIds = trustedCatalog
    .filter(({ name }) => normalizeCatalogSearchName(name) === "pikachu")
    .map(({ cardId }) => cardId)
    .sort();
  const result = buildCatalogCandidates(index, { names: ["Pikachu"] });
  assert.deepEqual(result.candidateIds, expectedPikachuIds);
});
