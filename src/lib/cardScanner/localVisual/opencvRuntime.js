import bundledOpenCv from "@techstark/opencv-js";

const REQUIRED_FUNCTIONS = [
  "Mat",
  "MatVector",
  "findContours",
  "approxPolyDP",
  "getPerspectiveTransform",
  "warpPerspective",
  "ORB",
  "BFMatcher",
  "findHomography",
];
const REQUIRED_CONSTANTS = ["RANSAC", "NORM_HAMMING"];

let openCvPromise;

export function inspectOpenCvCapabilities(cv) {
  const missing = [
    ...REQUIRED_FUNCTIONS.filter((name) => typeof cv?.[name] !== "function"),
    ...REQUIRED_CONSTANTS.filter((name) => typeof cv?.[name] !== "number"),
  ];
  return {
    compatible: missing.length === 0,
    missing,
    capabilities: {
      contours: typeof cv?.findContours === "function" && typeof cv?.approxPolyDP === "function",
      perspective: typeof cv?.getPerspectiveTransform === "function" && typeof cv?.warpPerspective === "function",
      orb: typeof cv?.ORB === "function" && typeof cv?.BFMatcher === "function",
      homography: typeof cv?.findHomography === "function" && typeof cv?.RANSAC === "number",
    },
  };
}

async function resolveModule(module) {
  const candidate = module?.default ?? module;
  const cv = candidate instanceof Promise ? await candidate : candidate;
  if (cv?.Mat) return cv;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OpenCV initialization timed out.")), 20_000);
    cv.onRuntimeInitialized = () => { clearTimeout(timeout); resolve(); };
  });
  return cv;
}

/** Scanner-only lazy load. Call from scanner code, never from the normal app bootstrap. */
export function loadOpenCv({ importer = () => Promise.resolve({ default: bundledOpenCv }) } = {}) {
  if (!openCvPromise) {
    openCvPromise = importer()
      .then(resolveModule)
      .then((cv) => {
        const inspection = inspectOpenCvCapabilities(cv);
        if (!inspection.compatible) throw new Error(`OpenCV scanner runtime is missing: ${inspection.missing.join(", ")}`);
        return cv;
      })
      .catch((error) => {
        openCvPromise = undefined;
        throw error;
      });
  }
  return openCvPromise;
}

export function resetOpenCvForTests() {
  openCvPromise = undefined;
}
