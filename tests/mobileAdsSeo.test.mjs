import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isNativeRuntime, shouldSuppressBrowserAds } from "../mobile-app/src/lib/platform.js";
import {
  isMobilePackReadyAdContextAllowed,
  isMobileSetAdContextAllowed,
} from "../mobile-app/src/lib/mobileAdEligibility.js";
import {
  applyMobileRouteSeo,
  getMobileRouteSeo,
  MOBILE_ROBOTS_DIRECTIVE,
} from "../mobile-app/src/lib/mobileRouteSeo.js";
import { canonicalSetCatalog } from "../src/lib/publicSetRoutes.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function createFakeDocument() {
  const nodes = [];
  const head = {
    querySelector(selector) {
      if (selector === 'meta[name="robots"]') {
        return nodes.find((node) => node.tagName === "meta" && node.attributes.name === "robots") || null;
      }
      if (selector === 'link[rel="canonical"]') {
        return nodes.find((node) => node.tagName === "link" && node.attributes.rel === "canonical") || null;
      }
      return null;
    },
    appendChild(node) {
      node.parentNode = head;
      nodes.push(node);
      return node;
    },
  };

  return {
    head,
    nodes,
    createElement(tagName) {
      return {
        tagName,
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        remove() {
          const index = nodes.indexOf(this);
          if (index >= 0) nodes.splice(index, 1);
        },
      };
    },
  };
}

test("every mobile-app route is noindex and duplicate set routes use the canonical public set URL", () => {
  const setRoute = getMobileRouteSeo("/mobile-app/explore/sets/151");
  assert.equal(setRoute.robots, MOBILE_ROBOTS_DIRECTIVE);
  assert.equal(setRoute.canonicalPath, "/set/pokemon-151");
  assert.equal(setRoute.canonicalUrl, "https://www.pack-dex.com/set/pokemon-151");
  assert.equal(setRoute.isDuplicateSetRoute, true);

  for (const entry of canonicalSetCatalog) {
    const descriptor = getMobileRouteSeo(
      `/mobile-app/explore/sets/${encodeURIComponent(entry.setId)}`
    );
    assert.equal(descriptor.robots, MOBILE_ROBOTS_DIRECTIVE);
    assert.equal(descriptor.canonicalPath, entry.path, entry.setId);
    assert.equal(descriptor.isDuplicateSetRoute, true, entry.setId);
  }

  for (const pathname of [
    "/mobile-app/",
    "/mobile-app/profile",
    "/mobile-app/auth/callback",
    "/mobile-app/explore/search?q=151",
    "/mobile-app/explore/sets/not-a-set",
  ]) {
    const descriptor = getMobileRouteSeo(pathname);
    assert.equal(descriptor.robots, MOBILE_ROBOTS_DIRECTIVE);
    assert.equal(descriptor.canonicalUrl, null);
  }
});

test("mobile route metadata adds and removes only the duplicate set canonical", () => {
  const documentRef = createFakeDocument();

  applyMobileRouteSeo("/mobile-app/explore/sets/151", documentRef);
  assert.equal(
    documentRef.head.querySelector('meta[name="robots"]').attributes.content,
    "noindex, follow"
  );
  assert.equal(
    documentRef.head.querySelector('link[rel="canonical"]').attributes.href,
    "https://www.pack-dex.com/set/pokemon-151"
  );

  applyMobileRouteSeo("/mobile-app/profile", documentRef);
  assert.equal(documentRef.head.querySelector('meta[name="robots"]').attributes.content, "noindex, follow");
  assert.equal(documentRef.head.querySelector('link[rel="canonical"]'), null);
});

test("Capacitor native detection is injectable and bridge failures suppress browser ads", () => {
  assert.equal(isNativeRuntime({ isNativePlatform: () => true }), true);
  assert.equal(isNativeRuntime({ isNativePlatform: () => false }), false);
  assert.equal(isNativeRuntime({ isNativePlatform: () => { throw new Error("bridge unavailable"); } }), false);
  assert.equal(isNativeRuntime({}), false);
  assert.equal(shouldSuppressBrowserAds({ isNativePlatform: () => true }), true);
  assert.equal(shouldSuppressBrowserAds({ isNativePlatform: () => false }), false);
  assert.equal(shouldSuppressBrowserAds({ isNativePlatform: () => { throw new Error("bridge unavailable"); } }), true);
  assert.equal(shouldSuppressBrowserAds({}), true);
});

test("mobile advertising is limited to the idle substantive Explore context", () => {
  const eligible = {
    activeTab: "explore",
    startupPhase: "complete",
    packStage: "sets",
    authValidationState: "guest",
  };
  assert.equal(isMobileSetAdContextAllowed(eligible), true);

  for (const packStage of ["ready", "preloading", "revealing", "summary"]) {
    assert.equal(isMobileSetAdContextAllowed({ ...eligible, packStage }), false);
  }

  for (const [key, value] of Object.entries({
    onboardingStep: "welcome",
    loadingMessage: "Loading",
    isPackSavePending: true,
    revealAnimationRunning: true,
    isAuthSubmitting: true,
    isAuthPanelOpen: true,
    isDeleteAccountOpen: true,
    isSignupVerificationOpen: true,
    isWelcomeDisclaimerOpen: true,
    isWelcomeRewardModalOpen: true,
    isClaimingWelcomeReward: true,
    isBuyMeACoffeePromptOpen: true,
    inspectedCard: { id: "card" },
    cardDestinationOverlay: true,
  })) {
    assert.equal(isMobileSetAdContextAllowed({ ...eligible, [key]: value }), false, key);
  }

  assert.equal(isMobileSetAdContextAllowed({ ...eligible, activeTab: "profile" }), false);
  assert.equal(isMobileSetAdContextAllowed({ ...eligible, startupPhase: "loading" }), false);
  assert.equal(isMobileSetAdContextAllowed({ ...eligible, authValidationState: "validating" }), false);
});

test("mobile Pack Ready advertising uses safe tall-browser space only", () => {
  const eligible = {
    activeTab: "open",
    startupPhase: "complete",
    packStage: "ready",
    authValidationState: "guest",
    viewportHeight: 844,
    isNative: false,
  };

  assert.equal(isMobilePackReadyAdContextAllowed(eligible), true);
  assert.equal(isMobilePackReadyAdContextAllowed({ ...eligible, viewportHeight: 719 }), false);
  assert.equal(isMobilePackReadyAdContextAllowed({ ...eligible, isNative: true }), false);
  assert.equal(isMobilePackReadyAdContextAllowed({ ...eligible, activeTab: "explore" }), false);

  for (const packStage of ["sets", "preloading", "revealing", "summary"]) {
    assert.equal(isMobilePackReadyAdContextAllowed({ ...eligible, packStage }), false, packStage);
  }

  for (const [key, value] of Object.entries({
    onboardingStep: "welcome",
    loadingMessage: "Loading",
    isPackSavePending: true,
    revealAnimationRunning: true,
    isAuthSubmitting: true,
    isAuthPanelOpen: true,
    isDeleteAccountOpen: true,
    isSignupVerificationOpen: true,
    isWelcomeDisclaimerOpen: true,
    isWelcomeRewardModalOpen: true,
    isClaimingWelcomeReward: true,
    isBuyMeACoffeePromptOpen: true,
    inspectedCard: { id: "card" },
    cardDestinationOverlay: true,
  })) {
    assert.equal(isMobilePackReadyAdContextAllowed({ ...eligible, [key]: value }), false, key);
  }
});

test("the mobile set ad is isolated after overview content and before interactive catalog content", async () => {
  const [explore, app, index] = await Promise.all([
    read("../mobile-app/src/explore/ExploreScreen.jsx"),
    read("../mobile-app/src/App.jsx"),
    read("../mobile-app/index.html"),
  ]);
  const setDetailStart = explore.indexOf("function SetDetail");
  const adIndex = explore.indexOf("<AdSlot", setDetailStart);
  const overviewIndex = explore.indexOf("guide.mechanics", setDetailStart);
  const catalogIndex = explore.indexOf("{species.length", setDetailStart);

  assert.ok(setDetailStart >= 0);
  assert.ok(overviewIndex > setDetailStart);
  assert.ok(adIndex > overviewIndex);
  assert.ok(catalogIndex > adIndex);
  assert.match(explore, /placement=\{AD_PLACEMENTS\.MOBILE_INLINE\}/);
  assert.match(explore, /canonicalPath,/);
  assert.match(explore, /contentReady: Boolean\(allowWebAds/);
  assert.match(explore, /isNative=\{isNative\}/);
  assert.match(explore, /manageMobileSeo/);

  assert.match(app, /isMobileSetAdContextAllowed/);
  assert.match(app, /isMobilePackReadyAdContextAllowed/);
  assert.match(app, /allowPackReadyWebAd={allowPackReadyWebAd}/);
  assert.match(app, /screen: "mobile-pack-ready"/);
  assert.match(app, /developmentLabel="Mobile ad placement"/);
  assert.equal((app.match(/allowWebAds=\{allowExploreWebAds\}/g) || []).length, 1);
  assert.match(index, /<meta name="robots" content="noindex, follow" \/>/);
});
