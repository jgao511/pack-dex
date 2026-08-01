import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_REVEAL_STYLE,
  REVEAL_STYLE_KEY,
  TAP_DUPLICATE_GUARD_MS,
  claimTapRevealInput,
  getSwipeReleaseAction,
  getSwipeTransform,
  loadRevealStyle,
  revealCardAtIndex,
  saveRevealStyle,
} from "../mobile-app/src/lib/revealStyle.js";

const appUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);
const cssUrl = new URL("../mobile-app/src/App.css", import.meta.url);

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key),
  };
}

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}

test("reveal style defaults to tap and stored allowed styles load correctly", () => {
  assert.equal(DEFAULT_REVEAL_STYLE, "tap");
  assert.equal(loadRevealStyle(createStorage()), "tap");
  for (const style of ["automatic", "tap", "swipe"]) {
    assert.equal(loadRevealStyle(createStorage({ [REVEAL_STYLE_KEY]: style })), style);
  }
  assert.equal(loadRevealStyle(createStorage({ [REVEAL_STYLE_KEY]: "invalid" })), "tap");
});

test("saving uses the stable key and normalizes invalid values", () => {
  const storage = createStorage();
  assert.equal(saveRevealStyle("swipe", storage), "swipe");
  assert.equal(storage.value("packdex_reveal_style_v1"), "swipe");
  assert.equal(saveRevealStyle("unknown", storage), "tap");
  assert.equal(storage.value(REVEAL_STYLE_KEY), "tap");
});

test("tap reveal changes only the selected card and cannot reveal it twice", () => {
  const first = revealCardAtIndex(new Set(), 3, 10);
  assert.equal(first.changed, true);
  assert.deepEqual([...first.revealedIndexes], [3]);

  const repeated = revealCardAtIndex(first.revealedIndexes, 3, 10);
  assert.equal(repeated.changed, false);
  assert.strictEqual(repeated.revealedIndexes, first.revealedIndexes);
});

test("revealing every card unlocks completion only on the final distinct card", () => {
  let revealed = new Set();
  for (let index = 0; index < 4; index += 1) {
    const result = revealCardAtIndex(revealed, index, 4);
    revealed = result.revealedIndexes;
    assert.equal(result.isComplete, index === 3);
  }
});

test("tap input guard rejects duplicate events without slowing distinct rapid taps", () => {
  const first = claimTapRevealInput(Number.NEGATIVE_INFINITY, 100);
  assert.equal(first.accepted, true);
  assert.equal(claimTapRevealInput(first.timestamp, 101).accepted, false);
  const nextDistinctTap = claimTapRevealInput(first.timestamp, 100 + TAP_DUPLICATE_GUARD_MS);
  assert.equal(nextDistinctTap.accepted, true);
});

test("incomplete and held swipes reset while every supported direction dismisses once", () => {
  assert.deepEqual(getSwipeReleaseAction({ deltaX: 0, deltaY: 0, elapsedMs: 900 }), { action: "reset" });
  assert.deepEqual(getSwipeReleaseAction({ deltaX: 24, deltaY: 3, elapsedMs: 180 }), { action: "reset" });
  assert.deepEqual(getSwipeReleaseAction({ deltaX: -112, deltaY: -8, elapsedMs: 190 }), { action: "dismiss", direction: "left" });
  assert.deepEqual(getSwipeReleaseAction({ deltaX: 118, deltaY: 2, elapsedMs: 210 }), { action: "dismiss", direction: "right" });
  assert.deepEqual(getSwipeReleaseAction({ deltaX: 8, deltaY: -116, elapsedMs: 220 }), { action: "dismiss", direction: "up" });
});

test("reduced motion removes 3D rotation from drag transforms", () => {
  const fullMotion = getSwipeTransform({ deltaX: 80, deltaY: -40, reducedMotion: false });
  const reducedMotion = getSwipeTransform({ deltaX: 80, deltaY: -40, reducedMotion: true });
  assert.match(fullMotion, /rotateX|rotateY/);
  assert.doesNotMatch(reducedMotion, /rotate|scale/);
  assert.match(reducedMotion, /^translate3d/);
});

test("automatic mode retains the existing timing effect without accepting skip input", async () => {
  const source = await readFile(appUrl, "utf8");
  const revealEffect = source.slice(
    source.indexOf('if (packStage !== "revealing"'),
    source.indexOf("function persistSessionCollection")
  );
  assert.match(revealEffect, /activeRevealStyle === "automatic"/);
  assert.match(revealEffect, /getMobileRevealDelay\(index, pack\.length\)/);
  assert.match(revealEffect, /runCardRevealHaptic\(card, index, cycle\)/);
  assert.doesNotMatch(source, /Tap anywhere to skip|skipPackReveal|isPackSkipReady/);
});

test("reveal style changes remain preference-only and cannot regenerate the active pack", async () => {
  const source = await readFile(appUrl, "utf8");
  const changeStyle = functionSource(source, "changeRevealStyle", "resetRevealInteractionState");
  assert.match(changeStyle, /saveRevealStyle\(normalized\)/);
  assert.match(changeStyle, /packStage !== "revealing" \|\| normalized === activeRevealStyle/);
  assert.doesNotMatch(changeStyle, /generatePack|setPack\(|startRevealCycle|resetRevealInteractionState/);
});

test("interactive modes persist only after completion and complete the final card once", async () => {
  const source = await readFile(appUrl, "utf8");
  const beginReveal = functionSource(source, "beginReveal", "returnToSets");
  const tapReveal = functionSource(source, "revealTappedCard", "dismissSwipeCard");
  const swipeDismiss = functionSource(source, "dismissSwipeCard", "scheduleRevealTimer");
  assert.doesNotMatch(beginReveal, /startPackPersistence/);
  assert.match(source, /function showCompletedPackSummary\(\)[\s\S]*completionClaimed[\s\S]*startPackPersistence\(pack, selectedSet\)/);
  assert.doesNotMatch(`${tapReveal}\n${swipeDismiss}`, /saveRevealedPack|generatePack|markCardsCollected/);
  assert.match(tapReveal, /result\.isComplete/);
  assert.match(swipeDismiss, /markCardRevealed\(nextIndex, pack\.length\)/);
  assert.match(swipeDismiss, /index === pack\.length - 1/);
  assert.match(swipeDismiss, /showCompletedPackSummary\(\)/);
});

test("swipe mode is a face-up stacked deck with no reveal or next-card buttons", async () => {
  const [source, css] = await Promise.all([readFile(appUrl, "utf8"), readFile(cssUrl, "utf8")]);
  const swipeDeck = functionSource(source, "SwipeRevealDeck", "PackScreen");
  assert.match(source, /onPointerDown=\{handlePointerDown\}/);
  assert.match(source, /onPointerMove=\{handlePointerMove\}/);
  assert.match(source, /onPointerCancel=/);
  assert.match(source, /onKeyDown=/);
  assert.match(swipeDeck, /const nextCard = pack\[activeIndex \+ 1\]/);
  assert.match(swipeDeck, /Swipe the card to reveal the next card/);
  assert.match(swipeDeck, /is-repositioning/);
  assert.doesNotMatch(swipeDeck, /CardBackImage|Reveal Card|Next Card|Tap the card/);
  assert.doesNotMatch(swipeDeck, /is-reveal-celebration|celebrateReveal=\{true\}/);
  assert.match(css, /\.swipe-reveal-mode[\s\S]*?overscroll-behavior:\s*none;[\s\S]*?touch-action:\s*none;/);
  assert.match(css, /\.swipe-primary-card[\s\S]*?will-change:\s*transform;/);
  assert.match(css, /\.swipe-primary-card\.is-repositioning\s*\{[\s\S]*?transition:\s*none;/);
  assert.doesNotMatch(css.match(/\.swipe-primary-card\s*\{[\s\S]*?\}/)?.[0] || "", /\b(top|left):/);
});

test("second-to-last exposes the final card and the final card renders no under-card", async () => {
  const source = await readFile(appUrl, "utf8");
  const swipeDeck = functionSource(source, "SwipeRevealDeck", "PackScreen");
  assert.match(swipeDeck, /const nextCard = pack\[activeIndex \+ 1\]/);
  assert.match(swipeDeck, /\{nextCard && \(/);
  assert.match(swipeDeck, /activeIndex \+ 1 === pack\.length - 1/);
  assert.match(swipeDeck, /Swipe the final card to finish/);
});

test("style selector is limited to Settings and the Pack Ready card-back screen", async () => {
  const source = await readFile(appUrl, "utf8");
  const packScreen = functionSource(source, "PackScreen", "AccountNotice");
  const settings = functionSource(source, "SettingsModal", "ProfileScreen");
  assert.match(packScreen, /isReady[\s\S]*?pack-ready-reveal-select/);
  assert.match(packScreen, /<select[\s\S]*?className="pack-ready-reveal-select"[\s\S]*?aria-label="Reveal Style"/);
  assert.match(packScreen, /<option value="automatic">Automatic<\/option>[\s\S]*?<option value="tap">Tap<\/option>[\s\S]*?<option value="swipe">Swipe<\/option>/);
  assert.match(packScreen, /disabled=\{isPreloading\}/);
  assert.doesNotMatch(packScreen, /pack-reveal-style-control|Choose reveal style.*popover/);
  assert.match(settings, /Reveal Style/);
  assert.match(settings, /RevealStyleOptions/);
});

test("Pack Ready selector stays inside narrow phone and safe-area bounds", async () => {
  const css = await readFile(cssUrl, "utf8");
  const selectorRule = css.match(/\.pack-ready-reveal-select\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(selectorRule, /box-sizing:\s*border-box/);
  assert.match(selectorRule, /max-width:\s*calc\(100% - 16px\)/);
  assert.match(selectorRule, /safe-area-inset-right/);
  assert.match(css, /@media \(max-width:\s*340px\)[\s\S]*?\.pack-ready-reveal-select/);
});
