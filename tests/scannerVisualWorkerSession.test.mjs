import assert from "node:assert/strict";
import test from "node:test";
import { orderCardProposalsForExecution } from "../src/lib/cardScanner/localVisual/cardProposals.js";

test("staged execution prioritizes likely geometry without dropping any proposal", () => {
  const proposals = [
    { id: "full", source: "full-fallback", isFallback: true },
    { id: "offset", source: "centered-aspect", detector: { heightFraction: 0.56, offsetX: 0.04, offsetY: 0 } },
    { id: "center-46", source: "centered-aspect", detector: { heightFraction: 0.46, offsetX: 0, offsetY: 0 } },
    { id: "hough", source: "hough-lines" },
    { id: "outline", source: "outline-expanded" },
    { id: "center-58", source: "centered-aspect", detector: { heightFraction: 0.58, offsetX: 0, offsetY: 0 } },
    { id: "minimum", source: "min-area-rect" },
    { id: "contour", source: "contour" },
    { id: "center-66", source: "centered-aspect", detector: { heightFraction: 0.66, offsetX: 0, offsetY: 0 } },
  ];

  const ordered = orderCardProposalsForExecution(proposals);
  assert.deepEqual(ordered.map(({ id }) => id), [
    "contour", "minimum", "outline", "center-58", "hough", "center-66", "center-46", "offset", "full",
  ]);
  assert.equal(new Set(ordered).size, proposals.length);
  assert.deepEqual(new Set(ordered), new Set(proposals));
  assert.deepEqual(proposals.map(({ id }) => id), ["full", "offset", "center-46", "hough", "outline", "center-58", "minimum", "contour", "center-66"]);
});
test("worker client exposes prewarm and staged proposal session protocol", async () => {
  const calls = [];
  class FakeWorker {
    constructor(url, options) { this.url = url; this.options = options; }
    postMessage(message, transfer) {
      calls.push({ message, transfer });
      const results = {
        prewarm: { compatible: true, loadMs: 12, alreadyWarm: false },
        "begin-proposal-scan": { sessionId: "proposal-scan-1", proposalCount: 4, proposals: [], remaining: 4 },
        "analyze-next-proposal-batch": { sessionId: "proposal-scan-1", proposals: [], nextCursor: 2, remaining: 2, complete: false },
        "release-proposal-session": { sessionId: "proposal-scan-1", released: true },
      };
      queueMicrotask(() => this.onmessage({ data: { id: message.id, result: results[message.type] } }));
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  const client = await import(`../src/lib/cardScanner/localVisual/visualWorkerClient.js?session-test=${Date.now()}`);
  const canvas = {
    width: 2,
    height: 3,
    getContext: () => ({
      getImageData: () => ({ width: 2, height: 3, data: new Uint8ClampedArray(2 * 3 * 4) }),
    }),
  };

  try {
    const prewarm = await client.prewarmVisualWorker();
    assert.equal(prewarm.loadMs, 12);
    const begun = await client.beginProposalScan(canvas, { output: { width: 250, height: 350 } });
    const batch = await client.analyzeNextProposalBatch(begun.sessionId, { batchSize: 2, limit: 40 });
    const released = await client.releaseProposalSession(begun.sessionId);
    assert.equal(batch.nextCursor, 2);
    assert.equal(released.released, true);
    assert.deepEqual(calls.map(({ message }) => message.type), [
      "prewarm", "begin-proposal-scan", "analyze-next-proposal-batch", "release-proposal-session",
    ]);
    assert.equal(calls[1].transfer.length, 1);
    assert.equal(calls[1].message.payload.buffer.byteLength, 24);
    assert.deepEqual(calls[2].message.payload, { sessionId: "proposal-scan-1", batchSize: 2, limit: 40 });
  } finally {
    client.disposeVisualWorker();
    delete globalThis.Worker;
  }
});
