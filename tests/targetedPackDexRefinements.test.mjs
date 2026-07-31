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

test("Explore uses optical logo centering and delays its lazy fallback", async () => {
  const [app, explore, exploreCss] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/explore/ExploreScreen.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/explore/ExploreScreen.css", import.meta.url), "utf8"),
  ]);

  assert.match(explore, /function OpticallyCenteredSetLogo/);
  assert.match(explore, /measureVisibleImageCenter/);
  assert.match(explore, /className="set-logo-frame"/);
  assert.match(exploreCss, /\.set-logo-frame\s*\{[\s\S]*grid-column: 1 \/ -1/);
  assert.match(app, /DelayedExploreFallback\(\{ message = "Loading Explore…", delay = 240 \}\)/);
  assert.match(app, /window\.clearTimeout\(timer\)/);
  assert.match(app, /loadExploreScreenModule\(\)\.catch/);
});

test("mobile auth refresh preserves the mounted route after initial hydration", async () => {
  const app = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");

  assert.match(app, /refreshAuthSession\(\{ initial: true, showLoading: false \}\)/);
  assert.match(app, /if \(event === "INITIAL_SESSION"\) return/);
  assert.match(app, /visibleUserId === nextUserId && event !== "PASSWORD_RECOVERY"/);
  assert.match(app, /refreshAuthSession\(\{ showLoading: false, autoOpenWelcomeReward: false \}\)/);
  assert.match(app, /finishInitialHydration\(\)/);
  assert.match(app, /<PackDexStartupAnimation phase=\{startupPhase\}/);
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

test("account creation remains progressive and submit requests are deduplicated", async () => {
  const app = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");

  assert.match(app, /\["email", "password", "confirm", "verification"\]/);
  assert.match(app, /authStep === "verification"[\s\S]*<Turnstile/);
  assert.match(app, /authRequestInFlightRef\.current/);
  assert.match(app, /if \(authRequestInFlightRef\.current\) return/);
});
