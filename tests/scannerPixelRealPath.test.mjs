import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

const fixtureRoot = new URL("./fixtures/scanner/pixel-real/", import.meta.url);

test("all four real Pixel fixtures are intact portrait JPEG files", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixtureRoot), "utf8"));
  assert.equal(manifest.length, 4);
  for (const fixture of manifest) {
    assert.equal(fixture.expectedTopResult.cardId, fixture.cardId);
    assert.match(fixture.expectedTopResult.confidence, /^(medium|high)$/);
    assert.ok(fixture.expectedTopResult.score > 0);
    assert.ok(fixture.expectedTopResult.selectedProposalId);
    const bytes = await readFile(new URL(fixture.fixture, fixtureRoot));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual([metadata.width, metadata.height], [3024, 4032]);
  }
});

test("Pixel fixture runner uses the ordinary File and temporary-object-URL path", async () => {
  const page = await readFile(new URL("../mobile-app/src/CardScannerDevPage.jsx", import.meta.url), "utf8");
  const runner = page.slice(page.indexOf("async function runPixelFixtureTest"), page.indexOf("function finishReading"));
  assert.match(runner, /new File\(\[blob\], `pixel-fixture-\$\{index \+ 1\}\.jpg`/);
  assert.match(runner, /createTemporaryImage\(file\)/);
  assert.match(runner, /recognizeCardText\(fixtureImage/);
  assert.doesNotMatch(runner, /xy12-|xy11-|phantasmal-flames|cardId|expected/);
});

test("native proposal processing starts from the full capture and stages OCR per proposal", async () => {
  const adapter = await readFile(new URL("../mobile-app/src/lib/nativeScannerAdapters.js", import.meta.url), "utf8");
  const staged = adapter.slice(adapter.indexOf("export const nativeOcrAdapter"));
  assert.match(staged, /beginProposalScan\(fullCanvas/);
  assert.match(adapter, /mappedCrop\.x \* fullCanvas\.width \/ originalWidth/);
  assert.match(staged, /analyzeNextProposalBatch\(sessionId, \{ batchSize: 1, limit: 40 \}\)/);
  assert.match(staged, /recognizeProposalPasses\(proposal\.canvas, \["full-card"\]\)/);
  assert.match(adapter, /candidateLimit: 40, orbCandidateLimit: 20/);
  assert.match(staged, /releaseProposalSession\(sessionId\)/);
});
