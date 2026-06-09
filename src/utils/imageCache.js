const loadedImages = new Set();
const pendingImages = new Map();

export function isImageLoaded(url) {
  return Boolean(url && loadedImages.has(url));
}

export function markImageLoaded(url) {
  if (url) loadedImages.add(url);
}

export function preloadImage(url, { timeoutMs = 1200 } = {}) {
  if (!url) return Promise.resolve(false);
  if (loadedImages.has(url)) return Promise.resolve(true);
  if (pendingImages.has(url)) return pendingImages.get(url);

  const promise = new Promise((resolve) => {
    const img = new Image();
    let timeoutId = 0;
    let settled = false;

    function finish(result) {
      if (settled) return;

      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      pendingImages.delete(url);
      if (result) loadedImages.add(url);
      resolve(result);
    }

    img.onload = async () => {
      try {
        await img.decode?.();
      } catch {
        // Decoding can reject for already-usable images; keep the loaded image.
      }

      finish(true);
    };
    img.onerror = () => finish(false);

    if (timeoutMs > 0) {
      timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    }

    img.src = url;
  });

  pendingImages.set(url, promise);
  return promise;
}

export function preloadImages(urls, options) {
  return Promise.allSettled(Array.from(new Set(urls.filter(Boolean))).map((url) => preloadImage(url, options)));
}
