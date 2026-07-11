import { toBlob } from "html-to-image";

const SHARE_SIZE = 1080;
const ASSET_TIMEOUT_MS = 15000;
const CAPTURE_TIMEOUT_MS = 20000;

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function waitForImage(image) {
  if (image.complete && image.naturalWidth > 0) return image.decode?.().catch(() => undefined) || Promise.resolve();
  if (image.complete) return Promise.reject(new Error("A card image could not be loaded for sharing."));

  const loading = new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("A card image could not be loaded for sharing.")), { once: true });
  }).then(() => image.decode?.().catch(() => undefined));

  return withTimeout(loading, ASSET_TIMEOUT_MS, "A card image took too long to load.");
}

async function waitForCaptureAssets(element) {
  await Promise.all(Array.from(element.querySelectorAll("img")).map(waitForImage));
  if (document.fonts?.ready) {
    await withTimeout(document.fonts.ready, ASSET_TIMEOUT_MS, "The share card font took too long to load.");
  }
}

function makeFilename(setName) {
  const slug = String(setName || "pack").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pack";
  return `packdex-${slug}-pull.png`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function createPullShareImage(element) {
  if (!element) throw new Error("The pull recap is not ready yet.");
  await waitForCaptureAssets(element);

  const blob = await withTimeout(
    toBlob(element, {
      width: SHARE_SIZE,
      height: SHARE_SIZE,
      canvasWidth: SHARE_SIZE,
      canvasHeight: SHARE_SIZE,
      cacheBust: true,
      pixelRatio: 1,
    }),
    CAPTURE_TIMEOUT_MS,
    "The pull image took too long to create."
  );

  if (!blob) throw new Error("The pull image could not be created.");
  return blob;
}

export async function sharePullImage(blob, setName) {
  const filename = makeFilename(setName);
  const file = new File([blob], filename, { type: "image/png" });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: "Look what I pulled on PackDex!" });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  downloadBlob(blob, filename);
}
