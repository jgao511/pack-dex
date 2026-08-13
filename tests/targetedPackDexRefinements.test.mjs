import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addCardsToBinder,
  createBinder,
  normalizeBinder,
  removeCardFromBinder,
  replaceBinderCards,
} from "../src/utils/binderStorage.js";
import { getInspectionGlowStrength } from "../src/utils/inspectionGlow.js";

const card = (id) => ({ id, number: id, name: `Card ${id}` });

test("custom binder insertion order survives normalization, reorder, removal, and re-add", () => {
  const binder = createBinder({ id: "ordered-binder", name: "Ordered" }, 100);
  const inserted = addCardsToBinder(
    [binder],
    binder.id,
    [
      { card: card("003"), setId: "set-a" },
      { card: card("001"), setId: "set-a" },
      { card: card("002"), setId: "set-a" },
    ],
    200,
  )[0];

  assert.deepEqual(inserted.cards.map((item) => item.cardId), ["003", "001", "002"]);
  assert.deepEqual(inserted.cards.map((item) => item.order), [0, 1, 2]);

  const reloaded = normalizeBinder(JSON.parse(JSON.stringify(inserted)));
  assert.deepEqual(reloaded.cards.map((item) => item.cardId), ["003", "001", "002"]);

  const reordered = replaceBinderCards(
    [reloaded],
    reloaded.id,
    [reloaded.cards[2], reloaded.cards[0], reloaded.cards[1]],
    300,
  )[0];
  assert.deepEqual(reordered.cards.map((item) => item.cardId), ["002", "003", "001"]);

  const removed = removeCardFromBinder([reordered], reordered.id, card("003"), "set-a")[0];
  const readded = addCardsToBinder(
    [removed],
    removed.id,
    [{ card: card("003"), setId: "set-a" }],
    400,
  )[0];
  assert.deepEqual(readded.cards.map((item) => item.cardId), ["002", "001", "003"]);
  assert.deepEqual(readded.cards.map((item) => item.order), [0, 1, 2]);
});

test("inspection glow eligibility is centralized and excludes ordinary cards", () => {
  assert.equal(getInspectionGlowStrength({ rarityCategory: "common" }), "none");
  assert.equal(getInspectionGlowStrength({ rarityCategory: "doubleRare" }), "standard");
  assert.equal(getInspectionGlowStrength({ rarityCategory: "illustrationRare" }), "high");
  assert.equal(getInspectionGlowStrength({ rarityCategory: "specialIllustrationRare" }), "chase");
});

test("Explore uses optical logo centering and the shared branded fallback", async () => {
  const [app, explore, exploreCss] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/explore/ExploreScreen.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/explore/ExploreScreen.css", import.meta.url), "utf8"),
  ]);

  assert.match(explore, /function OpticallyCenteredSetLogo/);
  assert.match(explore, /measureVisibleImageCenter/);
  assert.match(explore, /className="set-logo-frame"/);
  assert.match(exploreCss, /\.set-logo-frame\s*\{[\s\S]*grid-column: 1 \/ -1/);
  assert.match(app, /function DelayedExploreFallback\(\)/);
  assert.match(app, /return <PackDexStartupAnimation delayed \/>/);
  assert.doesNotMatch(app, /if \(!isVisible\) return <section className="explore-loading-placeholder"/);
  assert.match(app, /loadExploreScreenModule\(\)\.catch/);
});

test("mobile auth refresh preserves the mounted route after initial hydration", async () => {
  const app = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");

  assert.match(app, /refreshAuthSession\(\{ initial: true, showLoading: false \}\)/);
  assert.match(app, /if \(event === "INITIAL_SESSION"\) return/);
  assert.match(app, /visibleUserId === nextUserId && event !== "PASSWORD_RECOVERY"/);
  assert.match(app, /refreshAuthSession\(\{ showLoading: false, autoOpenWelcomeReward: false \}\)/);
  assert.match(app, /finishInitialHydration\(\)/);
  assert.match(app, /<MobileBrandHeader \/>/);
  assert.doesNotMatch(app, /startupPhase !== "complete" \? <PackDexStartupAnimation/);
});

test("mobile startup HTML provides the original branded loader before the application bundle parses", async () => {
  const [app, index] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(index, /data-packdex-boot-shell/);
  assert.match(index, /data-packdex-branded-loader/);
  assert.match(index, /class="packdex-startup__cards"/);
  assert.match(index, /class="packdex-startup__wordmark"/);
  assert.match(index, /prefers-reduced-motion: reduce/);
  assert.match(index, /Preparing your collection/);
  assert.doesNotMatch(index, /packdex-boot-geometry|packdex-boot-nav/);
  assert.match(app, /setStartupPhase\("complete"\)/);
  assert.doesNotMatch(app, /setTimeout\([\s\S]{0,160}setStartupPhase\("complete"\)/);
});

test("mobile inspected cards use stable pointer geometry and browser-action guards", async () => {
  const [app, css, sharedGlow, sharedTilt] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/InspectionBorderGlow.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/useCardTilt.js", import.meta.url), "utf8"),
  ]);

  assert.match(app, /inspectRectRef\.current = event\.currentTarget\.getBoundingClientRect\(\)/);
  assert.match(app, /onLostPointerCapture=\{handleLostInspectPointerCapture\}/);
  assert.match(app, /<InspectionBorderGlow strength=\{minimalPreview \? "none" : getInspectionGlowStrength\(card, set\)\}/);
  assert.match(css, /\.inspect-tilt-frame[\s\S]*touch-action: none/);
  assert.match(css, /-webkit-touch-callout: none/);
  assert.match(sharedGlow, /never installs a competing gesture handler/);
  assert.match(sharedTilt, /if \(isMoving && ref\.current\)/);
  assert.match(sharedTilt, /else \{\s*frameRef\.current = 0;/);
});

test("account access remains a single-page form and submit requests are deduplicated", async () => {
  const app = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");

  assert.match(app, /<form className="auth-form" onSubmit=\{onAuthSubmit\}>/);
  assert.match(app, /Email[\s\S]*Password[\s\S]*Confirm password[\s\S]*<Turnstile/);
  assert.doesNotMatch(app, /authStep|progressive-auth-form|auth-step-progress/);
  assert.match(app, /authRequestInFlightRef\.current/);
  assert.match(app, /if \(authRequestInFlightRef\.current\) return/);
});

test("mobile account forms keep login and signup submits in the bounded modal scroller", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8"),
  ]);
  const authModal = app.slice(app.indexOf("function MobileAuthModal"), app.indexOf("function TabIcon"));
  const overlayRule = css.match(/\.mobile-auth-overlay\s*\{([^}]*)\}/)?.[1] || "";
  const modalRule = css.match(/\.mobile-auth-modal\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(authModal, /<section className="mobile-auth-modal"[\s\S]*?<form className="auth-form"[\s\S]*?<button className="primary-action compact-auth-submit mobile-auth-submit" type="submit"/);
  assert.match(authModal, /authMode === "login" \? "Log In" : "Create Account"/);
  assert.match(overlayRule, /inset:\s*0/);
  assert.match(overlayRule, /min-height:\s*0/);
  assert.match(overlayRule, /overflow:\s*hidden/);
  assert.match(overlayRule, /env\(safe-area-inset-bottom\)/);
  assert.match(modalRule, /max-height:\s*100%/);
  assert.match(modalRule, /min-height:\s*0/);
  assert.match(modalRule, /overflow-y:\s*auto/);
  assert.match(modalRule, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(modalRule, /scroll-padding-bottom:\s*calc\(20px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(modalRule, /100dvh/);
});
