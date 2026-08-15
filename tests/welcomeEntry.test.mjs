import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_MOBILE_NOTICE_DISMISSED_KEY,
  dismissDesktopMobileNotice,
  getWelcomeEntryDecision,
  isLikelyCrawlerVisitor,
  isLikelyMobileVisitor,
  readStorageFlag,
  WELCOME_SEEN_KEY,
  writeStorageFlag,
} from "../src/welcomeEntry.js";

function storageHost(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
}

test("root keeps the public desktop landing while handing mobile visitors to the mobile app", () => {
  const firstVisit = storageHost();
  assert.equal(getWelcomeEntryDecision({ pathname: "/", storageHost: firstVisit }), "welcome");
  assert.equal(getWelcomeEntryDecision({ pathname: "/", isMobile: true, storageHost: firstVisit }), "mobile-app");

  const returning = storageHost({ [WELCOME_SEEN_KEY]: "1" });
  assert.equal(getWelcomeEntryDecision({ pathname: "/", storageHost: returning }), "welcome");
  assert.equal(getWelcomeEntryDecision({ pathname: "/", isMobile: true, storageHost: returning }), "mobile-app");
});

test("welcome is always available and non-root desktop routes are never intercepted", () => {
  const returning = storageHost({ [WELCOME_SEEN_KEY]: "1" });
  assert.equal(getWelcomeEntryDecision({ pathname: "/welcome/", isMobile: true, storageHost: returning }), "welcome");
  assert.equal(getWelcomeEntryDecision({ pathname: "/terms", isMobile: true, storageHost: returning }), "desktop-app");
  assert.equal(getWelcomeEntryDecision({ pathname: "/auth/callback", storageHost: returning }), "desktop-app");
  assert.equal(getWelcomeEntryDecision({ pathname: "/", search: "?desktop=1", storageHost: storageHost() }), "desktop-app");
  assert.equal(getWelcomeEntryDecision({ pathname: "/", search: "?desktop=1", isMobile: true, storageHost: storageHost() }), "desktop-app");
});

test("storage failures fail safely without blocking an explicit desktop entry", () => {
  const throwingHost = {
    get localStorage() {
      throw new Error("storage unavailable");
    },
  };

  assert.equal(readStorageFlag(WELCOME_SEEN_KEY, throwingHost), false);
  assert.equal(writeStorageFlag(DESKTOP_MOBILE_NOTICE_DISMISSED_KEY, throwingHost), false);
  assert.equal(getWelcomeEntryDecision({ pathname: "/", storageHost: throwingHost }), "welcome");
  assert.equal(getWelcomeEntryDecision({ pathname: "/", search: "?desktop=1", storageHost: throwingHost }), "desktop-app");
});

test("desktop notice dismissal uses only its dedicated local preference", () => {
  const host = storageHost();
  assert.equal(dismissDesktopMobileNotice(host), true);
  assert.equal(readStorageFlag(DESKTOP_MOBILE_NOTICE_DISMISSED_KEY, host), true);
  assert.equal(readStorageFlag(WELCOME_SEEN_KEY, host), false);
});

test("mobile detection uses mobile user agents or a compact coarse-pointer viewport", () => {
  assert.equal(isLikelyMobileVisitor({ userAgent: "Mozilla/5.0 (iPhone)" }), true);
  assert.equal(isLikelyMobileVisitor({ userAgentMobile: true }), true);
  assert.equal(isLikelyMobileVisitor({ coarsePointer: true, viewportWidth: 768 }), true);
  assert.equal(isLikelyMobileVisitor({ coarsePointer: true, viewportWidth: 1200 }), false);
  assert.equal(isLikelyMobileVisitor({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", viewportWidth: 390 }), false);
});

test("crawler detection preserves the public snapshot for mobile-first indexing", () => {
  assert.equal(isLikelyCrawlerVisitor({ userAgent: "Mozilla/5.0 (Linux; Android 6.0.1) Googlebot/2.1" }), true);
  assert.equal(isLikelyCrawlerVisitor({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile" }), false);
});
