import assert from "node:assert/strict";
import test from "node:test";
import { getBrowserCameraCapability, startBrowserCamera, stopBrowserCamera } from "../mobile-app/src/lib/browserScannerCamera.js";

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