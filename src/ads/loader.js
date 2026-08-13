import {
  adsenseConfig,
  getAdSlotId,
  isPlacementViewportEligible,
  isValidAdSenseClient,
  normalizeAdSlotId,
} from "./config.js";
import { isAdEligibleContext } from "./policy.js";

const SCRIPT_SELECTOR = "script[data-packdex-adsense-script]";
const ADSENSE_SCRIPT_FRAGMENT = "pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
const scriptPromises = new WeakMap();

export function buildAdSenseScriptUrl(client) {
  if (!isValidAdSenseClient(client)) return "";
  return `https://${ADSENSE_SCRIPT_FRAGMENT}?client=${encodeURIComponent(client)}`;
}

function findExistingAdSenseScript(documentRef) {
  return (
    documentRef.querySelector?.(SCRIPT_SELECTOR) ||
    documentRef.querySelector?.(`script[src*="${ADSENSE_SCRIPT_FRAGMENT}"]`) ||
    null
  );
}

function settleExistingScript(script, windowRef, resolve) {
  if (
    script?.dataset?.packdexAdsenseLoaded === "true" ||
    script?.readyState === "complete" ||
    Array.isArray(windowRef?.adsbygoogle)
  ) {
    resolve(true);
    return true;
  }
  return false;
}

export function ensureAdSenseScript({
  client = adsenseConfig.client,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  timeoutMs = 12_000,
} = {}) {
  const scriptUrl = buildAdSenseScriptUrl(client);
  if (!scriptUrl || !documentRef?.createElement || !documentRef?.head?.appendChild) {
    return Promise.resolve(false);
  }

  const knownPromise = scriptPromises.get(documentRef);
  if (knownPromise) return knownPromise;

  const promise = new Promise((resolve) => {
    let settled = false;
    let timeoutId;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
      resolve(loaded);
    };
    let script = findExistingAdSenseScript(documentRef);
    const isPackDexScript = Boolean(script?.dataset?.packdexAdsenseScript);

    if (settleExistingScript(script, windowRef, finish)) return;

    if (!script) {
      script = documentRef.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = scriptUrl;
      script.dataset.packdexAdsenseScript = "true";
    }

    const handleLoad = () => {
      if (script.dataset) script.dataset.packdexAdsenseLoaded = "true";
      finish(true);
    };
    const handleError = () => {
      if (script.dataset) script.dataset.packdexAdsenseFailed = "true";
      finish(false);
    };

    script.addEventListener?.("load", handleLoad, { once: true });
    script.addEventListener?.("error", handleError, { once: true });

    timeoutId = globalThis.setTimeout(() => {
      if (script.dataset) script.dataset.packdexAdsenseFailed = "true";
      finish(false);
    }, Math.max(1, Number(timeoutMs) || 12_000));

    if (!isPackDexScript && script.parentNode) return;
    if (!script.parentNode) documentRef.head.appendChild(script);
  });

  scriptPromises.set(documentRef, promise);
  return promise;
}

export function canRequestAdSense({ context = {}, config = adsenseConfig, placement, slotId } = {}) {
  if (!isAdEligibleContext({ ...context, placement })) return false;
  if (!isPlacementViewportEligible(placement, Number(context.viewportWidth))) return false;
  if (!config?.enabled || !isValidAdSenseClient(config.client)) return false;
  if (config.isDevelopment && !config.allowRequestsInDevelopment) return false;
  return Boolean(normalizeAdSlotId(slotId) || getAdSlotId(config, placement));
}

export function loadAdSenseForContext({
  context = {},
  config = adsenseConfig,
  placement,
  slotId,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  if (!canRequestAdSense({ context, config, placement, slotId })) return Promise.resolve(false);
  return ensureAdSenseScript({ client: config.client, documentRef, windowRef });
}

export function requestAdSenseSlot(element, windowRef = globalThis.window) {
  if (!element || element.dataset?.packdexAdInitialized === "true") return false;

  if (element.dataset) element.dataset.packdexAdInitialized = "true";

  try {
    const queue = windowRef.adsbygoogle || [];
    windowRef.adsbygoogle = queue;
    queue.push({});
    return true;
  } catch {
    if (element.dataset) element.dataset.packdexAdFailed = "true";
    return false;
  }
}
