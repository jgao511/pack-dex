import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LEGAL_DOCUMENTS,
  LEGAL_LAST_UPDATED,
  LEGAL_ROUTES,
  PACKDEX_SUPPORT_EMAIL,
} from "../src/content/legalDocuments.js";
import { openPrivacyChoices, PRIVACY_CHOICES_OPEN_EVENT } from "../src/lib/privacyChoices.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("canonical legal documents use the required routes, date, and pre-advertising language", () => {
  assert.deepEqual(LEGAL_ROUTES, { privacy: "/privacy", terms: "/terms" });
  assert.equal(LEGAL_LAST_UPDATED, "July 21, 2026");
  assert.equal(PACKDEX_SUPPORT_EMAIL, "packdexsupport@gmail.com");

  const legalText = JSON.stringify(LEGAL_DOCUMENTS);
  assert.match(legalText, /PackDex does not currently display advertising/);
  assert.match(legalText, /Supabase/);
  assert.match(legalText, /Cloudflare/);
  assert.match(legalText, /Turnstile/);
  assert.match(legalText, /Pokémon TCG API/);
  assert.match(legalText, /TCGplayer/);
  assert.match(legalText, /configured to expire after one year/);
  assert.doesNotMatch(legalText, /scanner|camera|photo library|OCR|image recognition|card-photo/i);
  assert.doesNotMatch(legalText, /Resend/);
});

test("website and mobile surfaces use canonical legal links and Privacy Choices", async () => {
  const [app, landingPage, authPanel, mobileApp, main, pageLoaders, index] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/LandingPage.jsx"),
    read("../src/components/AuthPanel.jsx"),
    read("../mobile-app/src/App.jsx"),
    read("../src/main.jsx"),
    read("../src/pageLoaders.js"),
    read("../index.html"),
  ]);

  assert.match(app, /href=\{LEGAL_ROUTES\.privacy\}/);
  assert.match(app, /href=\{LEGAL_ROUTES\.terms\}/);
  assert.match(app, /openPrivacyChoices\(event\.currentTarget\)/);
  assert.match(landingPage, /href=\{LEGAL_ROUTES\.privacy\}/);
  assert.match(landingPage, /href=\{LEGAL_ROUTES\.terms\}/);
  assert.match(landingPage, /openPrivacyChoices\(event\.currentTarget\)/);
  assert.match(authPanel, /href=\{LEGAL_ROUTES\.privacy\}/);
  assert.match(authPanel, /href=\{LEGAL_ROUTES\.terms\}/);
  assert.match(mobileApp, /terms: `\$\{getSiteOrigin\(\)\}\$\{LEGAL_ROUTES\.terms\}`/);
  assert.match(mobileApp, /privacy: `\$\{getSiteOrigin\(\)\}\$\{LEGAL_ROUTES\.privacy\}`/);
  assert.match(mobileApp, />\s*Privacy Choices\s*<\/button>/);
  assert.match(app, /pagePath\.replace\(\/\\\/\+\$\/, ""\)/);
  assert.match(main, /entryDecision === "mobile-app"/);
  assert.match(main, /entryDecision === "welcome"/);
  assert.match(pageLoaders, /import\("\.\/LandingPage\.jsx"\)/);
  assert.match(pageLoaders, /import\("\.\/App\.jsx"\)/);
  assert.doesNotMatch(index, /window\.location\.replace/);
});

test("Privacy Choices stays informational and includes modal keyboard and focus handling", async () => {
  const dialog = await read("../src/components/PrivacyChoicesDialog.jsx");

  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /triggerRef\.current\.focus\(\)/);
  assert.match(dialog, /Advertising preferences — not currently active/);
  assert.doesNotMatch(dialog, /Accept All|Reject All|IAB|consent string|Google Privacy & Messaging|UMP/);
});

test("openPrivacyChoices dispatches one centralized event with its trigger", () => {
  const originalDispatchEvent = globalThis.dispatchEvent;
  const originalCustomEvent = globalThis.CustomEvent;
  const trigger = { id: "privacy-trigger" };
  let received = null;

  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  globalThis.dispatchEvent = (event) => {
    received = event;
    return true;
  };

  try {
    assert.equal(openPrivacyChoices(trigger), true);
    assert.equal(received.type, PRIVACY_CHOICES_OPEN_EVENT);
    assert.equal(received.detail.trigger, trigger);
  } finally {
    if (originalDispatchEvent === undefined) delete globalThis.dispatchEvent;
    else globalThis.dispatchEvent = originalDispatchEvent;
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = originalCustomEvent;
  }
});
