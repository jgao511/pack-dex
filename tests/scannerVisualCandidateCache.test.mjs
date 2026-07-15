import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDecodedCandidateCanvasCache,
  getDecodedCandidateCanvasCacheSize,
  runVisualMatching,
} from "../src/lib/cardScanner/localVisual/runVisualMatching.js";
import { disposeVisualWorker } from "../src/lib/cardScanner/localVisual/visualWorkerClient.js";

class FakeCanvas {
  constructor(created) { this.width = 0; this.height = 0; created?.push(this); }
  getContext() {
    return {
      drawImage() {},
      getImageData: () => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(this.width * this.height * 4) }),
    };
  }
}

class FakeWorker {
  postMessage({ id, type, payload }) {
    assert.equal(type, "orb");
    queueMicrotask(() => this.onmessage?.({ data: { id, result: {
      processingMs: 4,
      candidates: payload.candidates.map(({ cardId }, index) => ({ cardId, score: .9 - index * .01, goodMatches: 20, inliers: 18 })),
    } } }));
  }
  terminate() {}
}

function entry(index) {
  return {
    cardId: `card-${index}`,
    normalizedName: `card ${index}`,
    normalizedNumber: String(index),
    printedSetTotal: 100,
    card: { name: `Card ${index}`, imageUrl: `/assets/sets/test/cards/${index}.jpg` },
  };
}

function visual(entries) {
  return { candidates: entries.map((item, index) => ({ cardId: item.cardId, score: .9 - index * .001 })) };
}

async function withFakeBrowser(run) {
  const original = { Worker: globalThis.Worker, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
  const created = []; let bitmapCount = 0;
  globalThis.Worker = FakeWorker;
  globalThis.document = { createElement: () => new FakeCanvas(created) };
  globalThis.createImageBitmap = async () => ({ width: 100, height: 140, close() { bitmapCount += 1; } });
  try { await run({ created, getBitmapCount: () => bitmapCount }); }
  finally {
    clearDecodedCandidateCanvasCache(); disposeVisualWorker();
    globalThis.Worker = original.Worker; globalThis.document = original.document; globalThis.createImageBitmap = original.createImageBitmap;
  }
}

test("decoded candidate canvases are reused without changing candidate or ORB ordering", async () => {
  await withFakeBrowser(async ({ created, getBitmapCount }) => {
    const catalog = [entry(1), entry(2)]; const query = new FakeCanvas(); query.width = 80; query.height = 112;
    let blobLoads = 0;
    const options = {
      catalog, precomputedLightweight: visual(catalog), knownWorkerRuntime: { compatible: true },
      loadImageBlob: async () => { blobLoads += 1; return new Blob(["image"]); },
    };
    const first = await runVisualMatching(query, { results: [] }, options);
    const second = await runVisualMatching(query, { results: [] }, options);

    assert.deepEqual(second.candidateIds, first.candidateIds);
    assert.deepEqual(second.orb.candidates, first.orb.candidates);
    assert.equal(first.timing.candidateCanvasCacheMisses, 2);
    assert.equal(first.timing.candidateCanvasCacheHits, 0);
    assert.equal(second.timing.candidateCanvasCacheHits, 2);
    assert.equal(second.timing.candidateCanvasCacheMisses, 0);
    assert.equal(first.timing.workerProbeSkipped, true);
    assert.equal(blobLoads, 2);
    assert.equal(getBitmapCount(), 2);
    assert.equal(getDecodedCandidateCanvasCacheSize(), 2);
    assert.ok(created.every((canvas) => canvas.width === 100 && canvas.height === 140), "cached canvases remain allocated after ORB");
  });
});

test("decoded candidate canvas cache evicts and releases its oldest entry at 24", async () => {
  await withFakeBrowser(async ({ created }) => {
    const firstCatalog = Array.from({ length: 24 }, (_, index) => entry(index + 1));
    const query = new FakeCanvas(); query.width = 80; query.height = 112;
    const common = { knownWorkerRuntime: { compatible: true }, loadImageBlob: async () => new Blob(["image"]), orbCandidateLimit: 24 };
    await runVisualMatching(query, { results: [] }, { ...common, catalog: firstCatalog, precomputedLightweight: visual(firstCatalog) });
    assert.equal(getDecodedCandidateCanvasCacheSize(), 24);
    assert.equal(created[0].width, 100);

    const replacement = [entry(25)];
    const result = await runVisualMatching(query, { results: [] }, { ...common, catalog: replacement, precomputedLightweight: visual(replacement) });
    assert.equal(result.timing.candidateCanvasCacheMisses, 1);
    assert.equal(getDecodedCandidateCanvasCacheSize(), 24);
    assert.equal(created[0].width, 0);
    assert.equal(created[0].height, 0);
  });
});
