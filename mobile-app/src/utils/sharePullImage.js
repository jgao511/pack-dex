import { toBlob } from "html-to-image";

const SHARE_SIZE = 1080;

function waitForImage(image) {
  if (image.complete && image.naturalWidth > 0) return image.decode?.().catch(() => undefined) || Promise.resolve();

  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("A card image could not be loaded for sharing.")), { once: true });
  }).then(() => image.decode?.().catch(() => undefined));
}

async function waitForCaptureAssets(element) {
  await Promise.all(Array.from(element.querySelectorAll("img")).map(waitForImage));
  await document.fonts?.ready;
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

  const blob = await toBlob(element, {
    width: SHARE_SIZE,
    height: SHARE_SIZE,
    canvasWidth: SHARE_SIZE,
    canvasHeight: SHARE_SIZE,
    cacheBust: true,
    pixelRatio: 1,
  });

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
