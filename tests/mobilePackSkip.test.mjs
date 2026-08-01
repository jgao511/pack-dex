import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { claimPackPersistence } from "../mobile-app/src/lib/packRevealLifecycle.js";

const appUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);
const cssUrl = new URL("../mobile-app/src/App.css", import.meta.url);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}

test("normal pack reveal has no screen-wide skip affordance or skip transition", async () => {
  const [source, css] = await Promise.all([readFile(appUrl, "utf8"), readFile(cssUrl, "utf8")]);

  assert.doesNotMatch(source, /Tap anywhere to skip|Tap to Skip|skipPackReveal|isPackSkipReady|runPackSkipTransition/);
  assert.doesNotMatch(css, /pack-skip-hint/);
  assert.doesNotMatch(source, /screen-content[^>]*onClick=\{handlePackScreenClick\}/);
});

test("automatic reveal ignores card input and completes only from its scheduled timer", async () => {
  const source = await readFile(appUrl, "utf8");
  const automaticEffect = source.slice(
    source.indexOf('if (packStage !== "revealing"'),
    source.indexOf("function persistSessionCollection")
  );

  assert.match(automaticEffect, /activeRevealStyle === "automatic"/);
  assert.match(automaticEffect, /pack\.forEach\(\(card, index\) =>/);
  assert.match(automaticEffect, /showCompletedPackSummary\(\)/);
  assert.match(source, /if \(isRevealing\) \{\s*if \(isTapReveal\)/);
});

test("interactive modes accept one distinct input at a time without a long tap cooldown", async () => {
  const source = await readFile(appUrl, "utf8");
  const tapReveal = functionSource(source, "revealTappedCard", "dismissSwipeCard");
  const swipeDismiss = functionSource(source, "dismissSwipeCard", "scheduleRevealTimer");

  assert.match(tapReveal, /claimTapRevealInput/);
  assert.match(tapReveal, /if \(!result\.isComplete\) return true/);
  assert.match(tapReveal, /markCardRevealed\(index, pack\.length\)/);
  assert.match(swipeDismiss, /revealAnimationLockRef\.current/);
  assert.match(swipeDismiss, /index !== swipeDismissedCountRef\.current/);
  assert.match(swipeDismiss, /markCardRevealed\(nextIndex, pack\.length\)/);
});

test("pack persistence and Open Another are claimed exactly once", async () => {
  const first = claimPackPersistence("", "set-a:card-1|card-2");
  const retry = claimPackPersistence(first.saveKey, "set-a:card-1|card-2");
  assert.equal(first.shouldPersist, true);
  assert.equal(retry.shouldPersist, false);

  const source = await readFile(appUrl, "utf8");
  const beginReveal = functionSource(source, "beginReveal", "returnToSets");
  const completeReveal = functionSource(source, "showCompletedPackSummary", "markCardRevealed");
  const persistence = functionSource(source, "saveRevealedPack", "startPackPersistence");
  const openAnother = functionSource(source, "openAnotherPack", "inspectCard");

  assert.doesNotMatch(beginReveal, /startPackPersistence/);
  assert.match(completeReveal, /completionClaimed/);
  assert.match(completeReveal, /startPackPersistence\(pack, selectedSet\)/);
  assert.match(persistence, /claimPackPersistence\(savedPackKeyRef\.current, saveKey\)/);
  assert.match(openAnother, /openAnotherLockRef\.current \|\| packOpeningOperationRef\.current \|\| packSavePendingRef\.current/);
  assert.match(openAnother, /openAnotherLockRef\.current = true/);
});

test("existing deal, flip, and summary timing values are unchanged", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /const CARD_DEAL_STAGGER_MS = 180;/);
  assert.match(source, /const CARD_DEAL_ANIMATION_MS = 280;/);
  assert.match(source, /const WAIT_AFTER_DEAL_MS = 500;/);
  assert.match(source, /const CARD_FLIP_STAGGER_MS = 330;/);
  assert.match(source, /const LAST_CARD_EXTRA_DELAY_MS = 850;/);
  assert.match(source, /const CARD_FLIP_ANIMATION_MS = 620;/);
  assert.match(source, /const SUMMARY_AFTER_LAST_CARD_MS = 250;/);
});
