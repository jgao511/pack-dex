import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADSENSE_PUBLISHER_CLIENT,
  AD_PLACEMENTS,
  createAdSenseConfig,
  getAdSlotId,
  isPlacementViewportEligible,
  isValidAdSlotId,
} from "../src/ads/config.js";
import {
  classifyAdRoute,
  getAdEligibility,
  isAdEligibleContext,
  normalizeAdPathname,
} from "../src/ads/policy.js";
import {
  buildAdSenseScriptUrl,
  canRequestAdSense,
  ensureAdSenseScript,
  loadAdSenseForContext,
  requestAdSenseSlot,
} from "../src/ads/loader.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function createFakeDocument() {
  const scripts = [];

  const documentRef = {
    scripts,
    createElement(tagName) {
      assert.equal(tagName, "script");
      const listeners = new Map();
      return {
        dataset: {},
        addEventListener(name, callback) {
          const callbacks = listeners.get(name) || [];
          callbacks.push(callback);
          listeners.set(name, callbacks);
        },
        dispatch(name) {
          for (const callback of listeners.get(name) || []) callback();
        },
      };
    },
    querySelector(selector) {
      if (selector === "script[data-packdex-adsense-script]") {
        return scripts.find((script) => script.dataset.packdexAdsenseScript === "true") || null;
      }
      if (selector.includes("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js")) {
        return scripts.find((script) => String(script.src).includes("adsbygoogle.js")) || null;
      }
      return null;
    },
  };

  documentRef.head = {
    appendChild(script) {
      script.parentNode = documentRef.head;
      scripts.push(script);
      return script;
    },
  };

  return documentRef;
}

const productionConfig = createAdSenseConfig({
  MODE: "production",
  DEV: false,
  VITE_ADSENSE_CLIENT: ADSENSE_PUBLISHER_CLIENT,
  VITE_ADSENSE_CONTENT_SLOT: "1234567890",
  VITE_ADSENSE_SET_RAIL_SLOT: "9876543210",
});

test("AdSense configuration accepts only real-looking client and numeric slot values", () => {
  const config = createAdSenseConfig({
    MODE: "production",
    DEV: false,
    VITE_ADSENSE_CLIENT: ADSENSE_PUBLISHER_CLIENT,
    VITE_ADSENSE_SET_RAIL_SLOT: "1234567890",
    VITE_ADSENSE_SET_INLINE_SLOT: "replace-me",
    VITE_ADSENSE_CONTENT_SLOT: "",
  });

  assert.equal(config.client, ADSENSE_PUBLISHER_CLIENT);
  assert.equal(config.isDevelopment, false);
  assert.equal(config.hasConfiguredSlot, true);
  assert.equal(getAdSlotId(config, AD_PLACEMENTS.SET_RAIL), "1234567890");
  assert.equal(getAdSlotId(config, AD_PLACEMENTS.SET_INLINE), "");
  assert.equal(isValidAdSlotId("replace-me"), false);
  assert.equal(isValidAdSlotId("1234567890"), true);
});

test("development requests are disabled by default and placements enforce viewport boundaries", () => {
  const config = createAdSenseConfig({
    MODE: "development",
    DEV: true,
    VITE_ADSENSE_CONTENT_SLOT: "1234567890",
  });

  assert.equal(config.allowRequestsInDevelopment, false);
  assert.equal(
    canRequestAdSense({
      config,
      placement: AD_PLACEMENTS.CONTENT,
      context: { pathname: "/faq", contentReady: true },
    }),
    false
  );
  assert.equal(isPlacementViewportEligible(AD_PLACEMENTS.SET_RAIL, 1279), false);
  assert.equal(isPlacementViewportEligible(AD_PLACEMENTS.SET_RAIL, 1280), true);
  assert.equal(isPlacementViewportEligible(AD_PLACEMENTS.MOBILE_INLINE, 430), true);
  assert.equal(isPlacementViewportEligible(AD_PLACEMENTS.MOBILE_INLINE, 768), false);
  assert.equal(
    canRequestAdSense({
      config: productionConfig,
      placement: AD_PLACEMENTS.SET_RAIL,
      context: { pathname: "/set/pokemon-151", contentReady: true, viewportWidth: 430 },
    }),
    false
  );
});

test("the pure route policy permits only canonical publisher-content routes", () => {
  assert.equal(normalizeAdPathname("https://www.pack-dex.com/faq/?source=test"), "/faq");
  assert.deepEqual(classifyAdRoute("/set/pokemon-151"), {
    eligible: true,
    kind: "set",
    pathname: "/set/pokemon-151",
    slug: "pokemon-151",
  });
  assert.equal(classifyAdRoute("/set/Pokemon-151").eligible, false);
  assert.equal(classifyAdRoute("/collection").eligible, false);
  assert.equal(classifyAdRoute("/mobile-app/").eligible, false);
  assert.equal(classifyAdRoute("/login").eligible, false);
});

test("loading, errors, account screens, mobile reveals, and native Capacitor contexts are blocked", () => {
  const base = { pathname: "/set/pokemon-151", contentReady: true };

  assert.equal(isAdEligibleContext(base), true);
  assert.equal(isAdEligibleContext({ ...base, contentReady: false }), false);
  assert.equal(isAdEligibleContext({ ...base, isLoading: true }), false);
  assert.equal(isAdEligibleContext({ ...base, hasError: true }), false);
  assert.equal(isAdEligibleContext({ ...base, screen: "login" }), false);
  assert.equal(isAdEligibleContext({ ...base, screen: "authCallback" }), false);
  assert.equal(isAdEligibleContext({ ...base, isNative: true }), false);
  assert.equal(isAdEligibleContext({ ...base, runtime: "ios-native" }), false);
  assert.equal(
    getAdEligibility({ ...base, screen: "packReveal", isMobile: true }).reason,
    "unsafe-interaction"
  );
  assert.equal(
    isAdEligibleContext({
      ...base,
      placement: AD_PLACEMENTS.SET_RAIL,
      isPackReveal: true,
      viewportWidth: 1440,
      allowDesktopRailDuringInteraction: true,
    }),
    true
  );
});

test("missing slot configuration is a graceful no-op", async () => {
  const documentRef = createFakeDocument();
  const config = createAdSenseConfig({ MODE: "production", DEV: false });
  const loaded = await loadAdSenseForContext({
    config,
    placement: AD_PLACEMENTS.CONTENT,
    context: { pathname: "/faq", contentReady: true },
    documentRef,
    windowRef: {},
  });

  assert.equal(loaded, false);
  assert.equal(documentRef.scripts.length, 0);
});

test("the route-gated loader does not inject a script on private or transient screens", async () => {
  const documentRef = createFakeDocument();

  for (const context of [
    { pathname: "/login", contentReady: true },
    { pathname: "/settings", contentReady: true },
    { pathname: "/faq", contentReady: false, isLoading: true },
    { pathname: "/set/pokemon-151", contentReady: true, isNative: true },
  ]) {
    assert.equal(
      await loadAdSenseForContext({
        config: productionConfig,
        placement: AD_PLACEMENTS.CONTENT,
        context,
        documentRef,
        windowRef: {},
      }),
      false
    );
  }

  assert.equal(documentRef.scripts.length, 0);
});

test("an eligible substantive page with a configured slot can initialize AdSense", async () => {
  const documentRef = createFakeDocument();
  const windowRef = {};
  const options = {
    config: productionConfig,
    placement: AD_PLACEMENTS.CONTENT,
    context: { pathname: "/faq", contentReady: true },
    documentRef,
    windowRef,
  };
  const firstLoad = loadAdSenseForContext(options);

  assert.equal(documentRef.scripts.length, 1);
  documentRef.scripts[0].dispatch("load");
  assert.equal(await firstLoad, true);
  assert.equal(await loadAdSenseForContext(options), true);
  assert.equal(documentRef.scripts.length, 1);
});

test("script injection is idempotent across StrictMode-style repeated initialization", async () => {
  const documentRef = createFakeDocument();
  const windowRef = {};
  const first = ensureAdSenseScript({ client: ADSENSE_PUBLISHER_CLIENT, documentRef, windowRef });
  const second = ensureAdSenseScript({ client: ADSENSE_PUBLISHER_CLIENT, documentRef, windowRef });

  assert.strictEqual(first, second);
  assert.equal(documentRef.scripts.length, 1);
  assert.equal(documentRef.scripts[0].async, true);
  assert.equal(documentRef.scripts[0].crossOrigin, "anonymous");
  assert.equal(
    documentRef.scripts[0].src,
    buildAdSenseScriptUrl(ADSENSE_PUBLISHER_CLIENT)
  );

  documentRef.scripts[0].dispatch("load");
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(documentRef.scripts.length, 1);
});

test("script or queue failures never crash PackDex and a slot initializes at most once", async () => {
  const blockedDocument = createFakeDocument();
  const blockedLoad = ensureAdSenseScript({
    client: ADSENSE_PUBLISHER_CLIENT,
    documentRef: blockedDocument,
    windowRef: {},
  });
  blockedDocument.scripts[0].dispatch("error");
  assert.equal(await blockedLoad, false);

  const element = { dataset: {} };
  const windowRef = { adsbygoogle: [] };
  assert.equal(requestAdSenseSlot(element, windowRef), true);
  assert.equal(requestAdSenseSlot(element, windowRef), false);
  assert.equal(windowRef.adsbygoogle.length, 1);

  const throwingElement = { dataset: {} };
  const throwingWindow = { adsbygoogle: { push: () => { throw new Error("blocked"); } } };
  assert.doesNotThrow(() => requestAdSenseSlot(throwingElement, throwingWindow));
  assert.equal(requestAdSenseSlot(throwingElement, throwingWindow), false);
});

test("a stalled or stripped script collapses through the loader timeout", async () => {
  const documentRef = createFakeDocument();
  const loaded = await ensureAdSenseScript({
    client: ADSENSE_PUBLISHER_CLIENT,
    documentRef,
    windowRef: {},
    timeoutMs: 1,
  });

  assert.equal(loaded, false);
  assert.equal(documentRef.scripts[0].dataset.packdexAdsenseFailed, "true");
});

test("the reusable component and document entry retain controlled advertising boundaries", async () => {
  const [component, index, rootEnv, mobileEnv] = await Promise.all([
    read("../src/ads/AdSlot.jsx"),
    read("../index.html"),
    read("../.env.example"),
    read("../mobile-app/.env.example"),
  ]);

  assert.match(component, /isNative/);
  assert.match(component, /contentReady/);
  assert.match(component, /showDevelopmentPlaceholder/);
  assert.match(component, /data-ad-slot=\{resolvedSlotId\}/);
  assert.match(index, /name="google-adsense-account" content="ca-pub-4828542760410446"/);
  assert.doesNotMatch(index, /pagead2\.googlesyndication\.com/);

  for (const env of [rootEnv, mobileEnv]) {
    assert.match(env, /VITE_ADSENSE_SET_RAIL_SLOT=/);
    assert.match(env, /VITE_ADSENSE_SET_INLINE_SLOT=/);
    assert.match(env, /VITE_ADSENSE_CONTENT_SLOT=/);
    assert.match(env, /VITE_ADSENSE_MOBILE_INLINE_SLOT=/);
  }
});
