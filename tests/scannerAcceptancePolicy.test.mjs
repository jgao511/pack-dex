import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  decideScannerAcceptance,
  normalizeScannerEvidence,
  SCANNER_ACCEPTANCE_MODES,
} from "../src/lib/cardScanner/scannerAcceptancePolicy.js";

function candidate(cardId, name, { number = "1", total = 100, score = 80 } = {}) {
  return {
    cardId,
    card: { id: cardId, name, number },
    setId: "test-set",
    setName: "Test Set",
    printedSetTotal: total,
    score,
    confidence: "low",
  };
}

function completeProposal(textLayoutScore = 1, source = "contour") {
  return {
    preparedWidth: 500,
    preparedHeight: 700,
    boundary: { selectedProposalId: "proposal-1", selectedSource: source },
    proposals: [{
      id: "proposal-1", selected: true, source, width: 500, height: 700,
      geometryScore: .8, quality: { areaFraction: .35 }, isFallback: false,
      evidence: { textClusterScore: textLayoutScore }, fusedCandidates: [],
    }],
  };
}

function reading(candidates, {
  names = [], numbers = [], ocrResults = [], orb = [], visual = [], trusted = [], legacy = [],
  textLayoutScore = null, imageDiagnostics,
} = {}) {
  const diagnostics = imageDiagnostics ?? (textLayoutScore === null ? null : completeProposal(textLayoutScore));
  if (diagnostics?.proposals?.[0] && legacy.length) diagnostics.proposals[0].fusedCandidates = legacy;
  const match = { confidence: "low", primaryMatch: null, results: candidates };
  return {
    recognized: {
      frozenA: { candidates: candidates.map(({ cardId, score }) => ({ cardId, score: score / 100 })) },
      fusedMatch: match,
      ocrMatch: {
        nameCandidates: names.map((raw) => ({ raw, normalized: raw.toLowerCase(), sourcePass: "name-top" })),
        collectorNumbers: numbers,
        results: ocrResults,
      },
      visualMatch: { lightweight: { candidates: visual }, orb: { candidates: orb }, trustedCandidates: trusted },
      imageDiagnostics: diagnostics,
    },
    match,
  };
}

function decide(input) { return decideScannerAcceptance(input.recognized, input.match); }

test("Frozen-A-only room, desk, bottle, and card-back proposals return no-match", async (context) => {
  for (const label of ["room", "desk", "bottle", "card-back"]) {
    await context.test(label, () => {
      const primary = candidate(`${label}-nearest`, "Unrelated Catalog Card");
      const decision = decide(reading([primary], { textLayoutScore: 0 }));
      assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.NO_MATCH);
      assert.deepEqual(decision.match.results, []);
    });
  }
});

test("a severe partial crop is rejected even when its title is readable", () => {
  const primary = candidate("team-rocket", "Here Comes Team Rocket");
  const decision = decide(reading([primary], { names: ["Here Comes Team Rocket"], textLayoutScore: .24 }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.NO_MATCH);
});

test("exact collector/set and name evidence accepts one printing", () => {
  const primary = candidate("electrode-40", "Electrode", { number: "40", total: 108 });
  const decision = decide(reading([primary], {
    names: ["Electrode"],
    numbers: [{ raw: "40/108", normalized: "40", normalizedTotal: "108", sourcePass: "collector-bottom" }],
  }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
  assert.equal(decision.match.results[0].cardId, primary.cardId);
  assert.ok(decision.match.results[0].acceptanceReasons.includes("exact-collector"));
});

test("strong name plus complete-card text layout accepts a valid front", () => {
  const primary = candidate("charizard", "Mega Charizard X ex");
  const decision = decide(reading([primary], { names: ["Mega Gharstard X ex"], textLayoutScore: 1 }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
  assert.ok(decision.match.results[0].acceptanceReasons.includes("strong-name"));
  assert.ok(decision.match.results[0].acceptanceReasons.includes("complete-card-layout"));
});

test("a complete front can use a family name only with a distinct existing proposal", () => {
  const primary = candidate("mega-charizard", "Mega Charizard X ex", { score: 91 });
  const runnerUp = candidate("runner-up", "Other Card", { score: 74 });
  const decision = decide(reading([primary, runnerUp], { names: ["Charizard"], textLayoutScore: 1 }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
  assert.deepEqual(decision.match.results.map(({ cardId }) => cardId), [primary.cardId]);
  assert.ok(decision.match.results[0].acceptanceReasons.includes("family-name-distinct-proposal"));
});

test("family-name support cannot accept a crop or an indistinct proposal", () => {
  const primary = candidate("mega-charizard", "Mega Charizard X ex", { score: 91 });
  const close = candidate("runner-up", "Other Card", { score: 86 });
  assert.equal(decide(reading([primary, close], { names: ["Charizard"], textLayoutScore: .25 })).mode, SCANNER_ACCEPTANCE_MODES.NO_MATCH);
  assert.equal(decide(reading([primary, close], { names: ["Charizard"], textLayoutScore: 1 })).mode, SCANNER_ACCEPTANCE_MODES.NO_MATCH);
});

test("strong same-primary ORB accepts a valid card without OCR", () => {
  const primary = candidate("riolu", "Riolu");
  const decision = decide(reading([primary], { orb: [{ cardId: primary.cardId, score: .9, goodMatches: 40, inliers: 28 }] }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
  assert.ok(decision.match.results[0].acceptanceReasons.includes("strong-orb"));
});

test("a strong trusted ORB result rescues a valid front when Frozen-A proposals are unsupported", () => {
  const wrong = candidate("wrong-frozen", "Wrong Frozen Candidate");
  const correct = candidate("correct-orb", "Correct Card");
  const decision = decide(reading([wrong], {
    orb: [{ cardId: correct.cardId, score: .9, goodMatches: 64, inliers: 58 }],
    trusted: [correct],
  }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
  assert.deepEqual(decision.match.results.map(({ cardId }) => cardId), [correct.cardId]);
  assert.ok(decision.match.results[0].acceptanceReasons.includes("strong-orb"));
});

test("a lower Frozen-A score is not a rejection rule", () => {
  const primary = candidate("gardevoir", "Gardevoir-EX", { score: 50 });
  const decision = decide(reading([primary], { names: ["Gardevoir EX"], textLayoutScore: 1 }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
});

test("weak incidental OCR does not corroborate a random object", () => {
  const primary = candidate("mysterious-treasure", "Mysterious Treasure");
  const decision = decide(reading([primary], { names: ["NOT FOR SALE IN BOTTLE DEPOSIT STATES"], textLayoutScore: .18 }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.NO_MATCH);
});

test("four ORB inliers are noise while the measured strong-ORB rule qualifies", () => {
  const primary = candidate("primary", "Primary");
  assert.equal(decide(reading([primary], { orb: [{ cardId: primary.cardId, score: .7, goodMatches: 4, inliers: 4 }] })).mode, SCANNER_ACCEPTANCE_MODES.NO_MATCH);
  assert.equal(decide(reading([primary], { orb: [{ cardId: primary.cardId, score: .55, goodMatches: 15, inliers: 12 }] })).mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
});

test("top-1 identity is preserved and unsupported filler candidates are removed", () => {
  const primary = candidate("diglett", "Diglett");
  const filler = candidate("random-filler", "Random Filler");
  const decision = decide(reading([primary, filler], { names: ["Diglett"], textLayoutScore: 1 }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
  assert.deepEqual(decision.match.results.map(({ cardId }) => cardId), [primary.cardId]);
});

test("ambiguous supported printings retain only credible candidates in original order", () => {
  const first = candidate("rocket-secret", "Here Comes Team Rocket");
  const second = candidate("rocket-holo", "Here Comes Team Rocket");
  const filler = candidate("unrelated", "Unrelated");
  const decision = decide(reading([first, second, filler], { names: ["Here Comes Team Rocket"], textLayoutScore: 1 }));
  assert.equal(decision.mode, SCANNER_ACCEPTANCE_MODES.CANDIDATES);
  assert.deepEqual(decision.match.results.map(({ cardId }) => cardId), [first.cardId, second.cardId]);
  assert.equal(decision.match.primaryMatch, null);
});

test("high, medium, and low policy modes render one, credible-many, and zero results", () => {
  const one = candidate("one", "One Card");
  const two = candidate("two", "One Card");
  assert.equal(decide(reading([one], { names: ["One Card"], textLayoutScore: 1 })).mode, SCANNER_ACCEPTANCE_MODES.SINGLE);
  assert.equal(decide(reading([one, two], { names: ["One Card"], textLayoutScore: 1 })).mode, SCANNER_ACCEPTANCE_MODES.CANDIDATES);
  assert.equal(decide(reading([one])).mode, SCANNER_ACCEPTANCE_MODES.NO_MATCH);
});

test("browser and Android normalize the same evidence schema", () => {
  const primary = candidate("shared", "Shared Card");
  const android = reading([primary], { names: ["Shared Card"], textLayoutScore: 1 }).recognized;
  const browser = reading([primary], {
    names: ["Shared Card"],
    imageDiagnostics: { preparedWidth: 500, preparedHeight: 700, boundary: { found: false, fallback: "centered-card-aspect" } },
  }).recognized;
  browser.blocks = [{ text: "Shared Card", boundingBox: { left: 20, top: 20, right: 480, bottom: 660 } }];
  const androidEvidence = normalizeScannerEvidence(android, android.fusedMatch);
  const browserEvidence = normalizeScannerEvidence(browser, browser.fusedMatch);
  assert.deepEqual(Object.keys(browserEvidence), Object.keys(androidEvidence));
  assert.equal(androidEvidence.crop.completeCard, true);
  assert.equal(browserEvidence.crop.completeCard, true);
});

test("missing optional platform evidence cannot bypass rejection", () => {
  const primary = candidate("unsupported", "Unsupported");
  const match = { confidence: "low", results: [primary] };
  assert.equal(decideScannerAcceptance({ frozenA: { candidates: [{ cardId: primary.cardId, score: .99 }] }, fusedMatch: match }, match).mode, SCANNER_ACCEPTANCE_MODES.NO_MATCH);
});

test("the acceptance policy is synchronous and cannot invoke expensive scanner work", async () => {
  const source = await readFile(new URL("../src/lib/cardScanner/scannerAcceptancePolicy.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:await|fetch|recognizeCardText|recognizeFrozenA|runVisualMatching|rankCardMatches)\b/);
});

test("the acceptance-policy-only overhead remains below a few milliseconds", (context) => {
  const primary = candidate("riolu", "Riolu");
  const input = reading([primary], { orb: [{ cardId: primary.cardId, score: .98, goodMatches: 110, inliers: 103 }] });
  const iterations = 10_000;
  for (let index = 0; index < 100; index += 1) decide(input);
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) decide(input);
  const averageMs = (performance.now() - started) / iterations;
  context.diagnostic(`policy average: ${averageMs.toFixed(4)} ms over ${iterations} decisions`);
  assert.ok(averageMs < 3, `expected policy-only average below 3 ms, received ${averageMs} ms`);
});
