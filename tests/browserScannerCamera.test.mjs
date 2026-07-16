import assert from "node:assert/strict";
import test from "node:test";
import { BrowserCaptureError, captureBrowserFrame, chooseBrowserFile, getBrowserCameraCapability, recognizeBrowserImage, startBrowserCamera, stopBrowserCamera } from "../mobile-app/src/lib/browserScannerCamera.js";

const secureEnvironment = (mediaDevices) => ({ isSecureContext: true, navigator: { mediaDevices } });

function createPickerHarness() {
  const listeners = new Map(); const windowListeners = new Map(); let input;
  const add = (target, type, callback) => { if (!target.has(type)) target.set(type, new Set()); target.get(type).add(callback); };
  const remove = (target, type, callback) => target.get(type)?.delete(callback);
  const emit = (target, type) => [...(target.get(type) || [])].forEach((callback) => callback());
  const documentRef = { body: { appended: [], append(node) { this.appended.push(node); } }, createElement() {
    input = { files: [], style: {}, removed: false, attributes: {}, addEventListener: (type, callback) => add(listeners, type, callback), removeEventListener: (type, callback) => remove(listeners, type, callback), setAttribute(name, value) { this.attributes[name] = value; }, remove() { this.removed = true; }, click() { this.clicked = true; } };
    return input;
  } };
  const windowRef = { addEventListener: (type, callback) => add(windowListeners, type, callback), removeEventListener: (type, callback) => remove(windowListeners, type, callback) };
  return { documentRef, windowRef, get input() { return input; }, emitInput: (type) => emit(listeners, type), emitWindow: (type) => emit(windowListeners, type), listenerCount: () => [...listeners.values(), ...windowListeners.values()].reduce((count, set) => count + set.size, 0) };
}

test("browser picker resolves selected files once and removes its temporary input", async () => {
  const harness = createPickerHarness(); const file = { type: "image/jpeg", size: 12 };
  const pending = chooseBrowserFile({ accept: "image/*" }, { ...harness, setTimeoutRef: (callback) => callback(), clearTimeoutRef() {} });
  assert.equal(harness.documentRef.body.appended[0], harness.input); assert.equal(harness.input.clicked, true);
  harness.input.files = [file]; harness.emitInput("change"); harness.emitInput("cancel");
  assert.equal(await pending, file); assert.equal(harness.input.removed, true); assert.equal(harness.listenerCount(), 0);
});

test("browser picker treats Safari focus return without a file as cancellation", async () => {
  const harness = createPickerHarness(); let pendingTimer;
  const pending = chooseBrowserFile({ accept: "image/*" }, { ...harness, setTimeoutRef: (callback) => { pendingTimer = callback; return 1; }, clearTimeoutRef() {} });
  harness.emitWindow("blur"); harness.emitWindow("focus"); pendingTimer();
  assert.equal(await pending, null); assert.equal(harness.input.removed, true); assert.equal(harness.listenerCount(), 0);
});

test("browser picker resolves explicit cancellation and can be opened again", async () => {
  const first = createPickerHarness(); const firstPending = chooseBrowserFile({ accept: "image/*" }, { ...first, setTimeoutRef: () => 1, clearTimeoutRef() {} });
  first.emitInput("cancel"); assert.equal(await firstPending, null);
  const second = createPickerHarness(); const secondPending = chooseBrowserFile({ accept: "image/*" }, { ...second, setTimeoutRef: () => 1, clearTimeoutRef() {} });
  const file = { type: "image/png", size: 20 }; second.input.files = [file]; second.emitInput("change");
  assert.equal(await secondPending, file);
});

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
    prepareImage: async () => ({ canvas, boundaryDiagnostics: { found: true } }),
    visualMatcher: async (_canvas, ocr, options) => { calls.push({ ocr, options }); return { lightweight: { candidates: [{ cardId: targetId, score: .95 }, { cardId: "ex9-5", score: .6 }] }, orb: { candidates: [{ cardId: targetId, score: .6, inliers: 30 }, { cardId: "ex9-5", score: .04, inliers: 1 }] } }; },
    frozenRecognizer: async () => ({ candidates: [{ cardId: targetId, score: .95 }, { cardId: "ex9-5", score: .72 }], fusedMatch: { confidence: "low", results: [{ cardId: targetId, card: { id: targetId, name: "Mega Charizard X ex" }, visualEvidence: { frozenA: .95 } }, { cardId: "ex9-5", card: { id: "ex9-5", name: "Charizard" }, visualEvidence: { frozenA: .72 } }] } }),
  });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].options, { candidateLimit: 40, orbCandidateLimit: 20 });
  assert.equal(result.fusedMatch.results[0].cardId, targetId);
});
