import assert from "node:assert/strict";
import test from "node:test";
import { detectCardBoundary, rectifyCardPerspective } from "../src/lib/cardScanner/localVisual/cardBoundary.js";
import { inspectOpenCvCapabilities, loadOpenCv, resetOpenCvForTests } from "../src/lib/cardScanner/localVisual/opencvRuntime.js";
import { expandQuad, getQuadMetrics, orderQuadCorners, orientQuadForPortrait, scoreCardQuad } from "../src/lib/cardScanner/localVisual/quadGeometry.js";

test("orders shuffled perspective corners clockwise from top-left", () => {
  const shuffled = [{ x: 92, y: 210 }, { x: 20, y: 10 }, { x: 110, y: 20 }, { x: 5, y: 190 }];
  assert.deepEqual(orderQuadCorners(shuffled), [
    { x: 20, y: 10 }, { x: 110, y: 20 }, { x: 92, y: 210 }, { x: 5, y: 190 },
  ]);
  assert.throws(() => orderQuadCorners([shuffled[0], shuffled[0], shuffled[2], shuffled[3]]), /distinct/i);
});

test("scores a centered card while rejecting tiny and implausible rectangles", () => {
  const card = [{ x: 150, y: 120 }, { x: 650, y: 130 }, { x: 640, y: 830 }, { x: 145, y: 820 }];
  const result = scoreCardQuad(card, { width: 800, height: 1000 });
  assert.equal(result.accepted, true);
  assert.ok(result.score > 0.7);
  assert.ok(Math.abs(result.metrics.portraitAspectRatio - 5 / 7) < 0.02);
  assert.equal(scoreCardQuad([{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 15 }, { x: 1, y: 15 }], { width: 800, height: 1000 }).reason, "card-too-small");
  assert.equal(scoreCardQuad([{ x: 10, y: 10 }, { x: 700, y: 10 }, { x: 700, y: 110 }, { x: 10, y: 110 }], { width: 800, height: 1000 }).reason, "card-too-small");
});

test("expands the detected border within image bounds and normalizes landscape geometry", () => {
  const card = [{ x: 0, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 140 }, { x: 0, y: 140 }];
  const expanded = expandQuad(card, { width: 100, height: 150 }, 0.02);
  assert.equal(expanded[0].x, 0);
  assert.ok(expanded[0].y < 10);
  assert.ok(expanded[2].x > 90);
  assert.equal(getQuadMetrics(expanded, { width: 100, height: 150 }).ordered.length, 4);

  const landscape = [{ x: 10, y: 10 }, { x: 150, y: 10 }, { x: 150, y: 110 }, { x: 10, y: 110 }];
  const portraitOrder = orientQuadForPortrait(landscape);
  assert.deepEqual(portraitOrder[0], { x: 150, y: 10 });
});

test("bundled OpenCV exposes scanner contour, perspective, ORB, and homography APIs", async () => {
  resetOpenCvForTests();
  const cv = await loadOpenCv();
  assert.deepEqual(inspectOpenCvCapabilities(cv), {
    compatible: true,
    missing: [],
    capabilities: { contours: true, perspective: true, orb: true, homography: true },
  });
});

test("bundled ORB, Hamming matcher, and RANSAC homography execute successfully", async () => {
  const cv = await loadOpenCv();
  const image = new cv.Mat(240, 180, cv.CV_8UC1, new cv.Scalar(0));
  const mask = new cv.Mat();
  const firstKeypoints = new cv.KeyPointVector();
  const secondKeypoints = new cv.KeyPointVector();
  const firstDescriptors = new cv.Mat();
  const secondDescriptors = new cv.Mat();
  const matches = new cv.DMatchVector();
  const orb = new cv.ORB(300);
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  let sourcePoints;
  let destinationPoints;
  let inlierMask;
  let homography;
  try {
    cv.rectangle(image, new cv.Point(20, 20), new cv.Point(160, 220), new cv.Scalar(255), 3);
    for (let y = 40; y < 200; y += 30) cv.line(image, new cv.Point(30, y), new cv.Point(150, 220 - y), new cv.Scalar(255), 2);
    orb.detectAndCompute(image, mask, firstKeypoints, firstDescriptors);
    orb.detectAndCompute(image, mask, secondKeypoints, secondDescriptors);
    matcher.match(firstDescriptors, secondDescriptors, matches);
    assert.ok(firstKeypoints.size() > 20);
    assert.equal(matches.size(), firstDescriptors.rows);
    assert.equal(matches.get(0).distance, 0);

    sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 100, 0, 100, 100, 0, 100]);
    destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [3, 2, 103, 2, 103, 102, 3, 102]);
    inlierMask = new cv.Mat();
    homography = cv.findHomography(sourcePoints, destinationPoints, cv.RANSAC, 3, inlierMask);
    assert.deepEqual([homography.rows, homography.cols], [3, 3]);
    assert.deepEqual([inlierMask.rows, inlierMask.cols], [4, 1]);
  } finally {
    homography?.delete();
    inlierMask?.delete();
    destinationPoints?.delete();
    sourcePoints?.delete();
    matcher.delete();
    orb.delete();
    matches.delete();
    secondDescriptors.delete();
    firstDescriptors.delete();
    secondKeypoints.delete();
    firstKeypoints.delete();
    mask.delete();
    image.delete();
  }
});

test("detects and rectifies a synthetic card without leaking returned ownership", async () => {
  const cv = await loadOpenCv();
  const source = new cv.Mat(1000, 800, cv.CV_8UC4, new cv.Scalar(15, 15, 15, 255));
  cv.rectangle(source, new cv.Point(150, 150), new cv.Point(650, 850), new cv.Scalar(245, 245, 245, 255), -1);
  let rectified;
  try {
    const detection = detectCardBoundary(cv, source);
    assert.equal(detection.found, true);
    assert.ok(detection.score > 0.7);
    assert.equal(detection.expandedCorners.length, 4);
    rectified = rectifyCardPerspective(cv, source, detection.expandedCorners, { width: 250, height: 350 });
    assert.equal(rectified.cols, 250);
    assert.equal(rectified.rows, 350);
  } finally {
    rectified?.delete();
    source.delete();
  }
});
