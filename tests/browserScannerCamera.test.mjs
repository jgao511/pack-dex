import assert from "node:assert/strict";
import test from "node:test";
import { BrowserCaptureError, captureBrowserFrame, getBrowserCameraCapability, recognizeBrowserImage, startBrowserCamera, stopBrowserCamera } from "../mobile-app/src/lib/browserScannerCamera.js";

const secureEnvironment = (mediaDevices) => ({ isSecureContext: true, navigator: { mediaDevices } });

test("reports browser camera capability and unavailable states", () => {
  assert.equal(getBrowserCameraCapability(secureEnvironment({ getUserMedia() {} })).available, true);
  assert.match(getBrowserCameraCapability({ isSecureContext: false, navigator: {} }).reason, /secure connection/i);
  assert.match(getBrowserCameraCapability({ isSecureContext: true, navigator: {} }).reason, /not available/i);
});

test("starts a rear-preferred browser stream after permission and cleans it up", async () => {
  const calls = []; const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const mediaDevices = { getUserMedia: async (constraints) => { calls.push(constraints); return stream; } };
  const video = { play: async () => {}, srcObject: null, muted: false, playsInline: false };
  await startBrowserCamera(video, mediaDevices, secureEnvironment(mediaDevices));
  assert.deepEqual(calls, [{ audio: false, video: { facingMode: { ideal: "environment" } } }]);
  assert.equal(video.srcObject, stream); assert.equal(video.muted, true); assert.equal(video.playsInline, true);
  stopBrowserCamera(video, stream); assert.equal(track.stopped, true); assert.equal(video.srcObject, null);
});

test("surfaces a denied browser camera request without creating a stream", async () => {
  const mediaDevices = { getUserMedia: async () => { throw new DOMException("Denied", "NotAllowedError"); } };
  const video = { play: async () => {}, srcObject: null };
  await assert.rejects(() => startBrowserCamera(video, mediaDevices, secureEnvironment(mediaDevices)), /Denied/);
  assert.equal(video.srcObject, null);
});

test("captures the actual video frame only after Blob creation", async () => {
  const drawn = []; const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (...args) => drawn.push(args), getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 60, 60, 60, 255]) }) }),
    toBlob: (callback) => callback(new Blob([new Uint8Array(2048)], { type: "image/jpeg" })),
  };
  const documentRef = { createElement: () => canvas };
  const FileCtor = class { constructor(parts, _name, options) { return new Blob(parts, options); } };
  const image = await captureBrowserFrame({ videoWidth: 1920, videoHeight: 1080 }, { documentRef, FileCtor });
  assert.deepEqual([canvas.width, canvas.height], [1920, 1080]);
  assert.deepEqual(drawn[0].slice(1), [0, 0, 1920, 1080]);
  assert.equal(image.file.size, 2048);
  image.release();
});

test("rejects a null, empty, or blank browser frame instead of treating it as no match", async () => {
  const blankCanvas = {
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([12, 12, 12, 255, 12, 12, 12, 255]) }) }),
    toBlob: (callback) => callback(new Blob([new Uint8Array(2048)], { type: "image/jpeg" })),
  };
  await assert.rejects(() => captureBrowserFrame({ videoWidth: 1, videoHeight: 1 }, { documentRef: { createElement: () => blankCanvas } }), (error) => error instanceof BrowserCaptureError && error.code === "blank-capture");
  const nullCanvas = { getContext: () => ({ drawImage() {} }), toBlob: (callback) => callback(null) };
  await assert.rejects(() => captureBrowserFrame({ videoWidth: 1, videoHeight: 1 }, { documentRef: { createElement: () => nullCanvas } }), (error) => error instanceof BrowserCaptureError && error.code === "invalid-capture");
});

test("a valid browser image awaits the production visual adapter and returns real candidates", async () => {
  const targetId = "phantasmal-flames-13-mega-charizard-x-ex"; const calls = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  const result = await recognizeBrowserImage({ file: new Blob([new Uint8Array(2048)], { type: "image/jpeg" }) }, {
    decodeImage: async () => ({ source: {}, width: 720, height: 1000, close() {} }), documentRef: { createElement: () => canvas },
    visualMatcher: async (_canvas, ocr, options) => { calls.push({ ocr, options }); return { lightweight: { candidates: [{ cardId: targetId, score: .95 }, { cardId: "ex9-5", score: .6 }] }, orb: { candidates: [{ cardId: targetId, score: .6, inliers: 30 }, { cardId: "ex9-5", score: .04, inliers: 1 }] } }; },
  });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].options, { candidateLimit: 40, orbCandidateLimit: 20 });
  assert.equal(result.fusedMatch.results[0].cardId, targetId);
});
