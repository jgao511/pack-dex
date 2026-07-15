import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { generateCardProposals, releaseCardProposals } from "../src/lib/cardScanner/localVisual/cardProposals.js";
import { loadOpenCv } from "../src/lib/cardScanner/localVisual/opencvRuntime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pixelFixtureDirectory = path.join(here, "fixtures", "scanner", "pixel-real");

async function pixelFixtureMat(cv, fixture) {
  const { data, info } = await sharp(path.join(pixelFixtureDirectory, fixture))
    .rotate()
    .resize({ width: 900, height: 1200, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return cv.matFromArray(info.height, info.width, cv.CV_8UC4, data);
}

test("generates bounded, normalized proposals for all four real Pixel photos", async () => {
  const cv = await loadOpenCv();
  const fixtures = (await readdir(pixelFixtureDirectory)).filter((fixture) => fixture.endsWith(".jpg")).sort();
  assert.equal(fixtures.length, 4);

  for (const fixture of fixtures) {
    const source = await pixelFixtureMat(cv, fixture);
    let proposals;
    try {
      proposals = generateCardProposals(cv, source, { output: { width: 250, height: 350 } });
      assert.ok(proposals.length >= 7, `${fixture} should retain several independent crops`);
      assert.ok(proposals.length <= 16, `${fixture} must keep proposal work bounded`);
      assert.equal(proposals.at(-1).source, "full-fallback", `${fixture} full photo must be last`);
      assert.equal(proposals.at(-1).isFallback, true);
      assert.ok(proposals.slice(0, -1).every(({ isFallback }) => !isFallback));
      assert.ok(proposals.some(({ source: type }) => type === "centered-aspect"));
      for (const proposal of proposals) {
        assert.equal(proposal.width, 250);
        assert.equal(proposal.height, 350);
        assert.equal(proposal.mat.cols, 250);
        assert.equal(proposal.mat.rows, 350);
        assert.ok(proposal.mat.data.length > 0);
        assert.ok(Number.isFinite(proposal.geometryScore));
        assert.ok(Number.isFinite(proposal.quality.areaFraction));
        assert.ok(Array.isArray(proposal.corners) && proposal.corners.length === 4);
      }
    } finally {
      releaseCardProposals(proposals);
      source.delete();
    }
  }
});

test("real Pixel failures receive a geometry recovery proposal before full fallback", async () => {
  const cv = await loadOpenCv();
  const expectations = new Map([
    ["here-comes-team-rocket-113-108.jpg", "contour"],
    ["gardevoir-ex-111-114.jpg", "min-area-rect"],
    ["mega-charizard-x-ex-013-094.jpg", "min-area-rect"],
    // Diglett is the hardest edge case: its border is not recovered at this resolution, so the
    // deliberately small centered-aspect proposal is the recovery path rather than the table.
    ["diglett-55-108.jpg", "centered-aspect"],
  ]);

  for (const [fixture, expectedSource] of expectations) {
    const source = await pixelFixtureMat(cv, fixture);
    let proposals;
    try {
      proposals = generateCardProposals(cv, source, { output: { width: 180, height: 252 } });
      assert.ok(proposals.some(({ source: type }) => type === expectedSource), `${fixture} should include ${expectedSource}`);
      const compact = proposals.filter(({ source: type, quality }) => type !== "full-fallback" && quality.areaFraction <= 0.45);
      assert.ok(compact.length > 0, `${fixture} should have a card-sized proposal with limited table`);
    } finally {
      releaseCardProposals(proposals);
      source.delete();
    }
  }
});

test("expands a supplied camera outline and releases every returned Mat", async () => {
  const cv = await loadOpenCv();
  const source = new cv.Mat(1000, 800, cv.CV_8UC4, new cv.Scalar(35, 35, 35, 255));
  let proposals;
  try {
    proposals = generateCardProposals(cv, source, {
      outline: { x: 190, y: 170, width: 420, height: 600 },
      outlineExpansion: 0.05,
      output: { width: 100, height: 140 },
    });
    const outline = proposals.find(({ source: type }) => type === "outline-expanded");
    assert.ok(outline);
    assert.ok(outline.corners[0].x < 190);
    assert.ok(outline.corners[0].y < 170);
    assert.ok(outline.corners[2].x > 610);
    assert.ok(outline.corners[2].y > 770);
    const ownedMats = proposals.map(({ mat }) => mat);
    releaseCardProposals(proposals);
    proposals = [];
    assert.ok(ownedMats.every((mat) => mat.isDeleted()));
  } finally {
    releaseCardProposals(proposals);
    source.delete();
  }
});

