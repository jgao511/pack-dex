import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  claimPackPersistence,
  isPackSkipReady,
  runPackSkipTransition,
} from "../mobile-app/src/lib/packRevealLifecycle.js";

const appUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}

test("fast readiness exposes Skip during dealing and slow readiness keeps it hidden", () => {
  assert.equal(isPackSkipReady({
    stage: "revealing",
    assetsReady: true,
    tutorialMode: false,
    skipStarted: false,
  }), true);
  assert.equal(isPackSkipReady({
    stage: "revealing",
    assetsReady: false,
    tutorialMode: false,
    skipStarted: false,
  }), false);
});

test("opening another pack does not reuse the previous pack's ready state", async () => {
  const source = await readFile(appUrl, "utf8");
  const openAnotherPack = functionSource(source, "openAnotherPack", "inspectCard");

  assert.match(openAnotherPack, /beginReveal\(nextPack,\s*selectedSet,\s*\{\s*assetsReady:\s*false\s*\}\)/);
});

test("the first visible Skip frame is enabled by the same readiness transition", async () => {
  const source = await readFile(appUrl, "utf8");
  const revealEffect = source.slice(
    source.indexOf('if (packStage !== "revealing"'),
    source.indexOf("function persistSessionCollection")
  );

  assert.match(revealEffect, /const nextSkipReady = isPackSkipReady\(/);
  assert.match(revealEffect, /skipRevealEligibleRef\.current = nextSkipReady;\s*setSkipRevealEligible\(nextSkipReady\);/);
  assert.doesNotMatch(revealEffect, /scheduleRevealTimer\([\s\S]*setSkipRevealEligible\(true\)/);
  assert.match(source, /isRevealing && packImagesReady && !tutorialMode && skipRevealEligible/);
  assert.match(source, /const canSkip = skipRevealEligibleRef\.current && isPackSkipReady\(/);
});

test("the opening activation is released and stopped before Skip can receive it", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(
    source,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onStartReveal\?\.\(\);\s*\}\}/
  );
});

test("skipping during dealing cancels timers, reveals every card, and enters summary", () => {
  const calls = [];
  const skipped = runPackSkipTransition({
    canSkip: true,
    clearTimers: () => calls.push("clear"),
    finishCycle: () => calls.push("finish"),
    revealAll: () => calls.push("reveal-all"),
    showSummary: () => calls.push("summary"),
  });

  assert.equal(skipped, true);
  assert.deepEqual(calls, ["clear", "finish", "reveal-all", "summary"]);
  assert.equal(runPackSkipTransition({ canSkip: false, showSummary: () => calls.push("duplicate") }), false);
  assert.equal(calls.includes("duplicate"), false);
});

test("pack persistence and its stable event are claimed exactly once across Skip", async () => {
  const first = claimPackPersistence("", "set-a:card-1|card-2");
  const retry = claimPackPersistence(first.saveKey, "set-a:card-1|card-2");
  assert.equal(first.shouldPersist, true);
  assert.equal(retry.shouldPersist, false);

  const source = await readFile(appUrl, "utf8");
  const beginReveal = functionSource(source, "beginReveal", "skipPackReveal");
  const skipReveal = functionSource(source, "skipPackReveal", "handlePackScreenClick");
  const persistence = functionSource(source, "saveRevealedPack", "startReveal");
  assert.equal((beginReveal.match(/saveRevealedPack\(/g) || []).length, 1);
  assert.doesNotMatch(skipReveal, /saveRevealedPack|recordPackOpenEvent|enqueuePendingCloudPull/);
  assert.match(persistence, /claimPackPersistence\(savedPackKeyRef\.current, saveKey\)/);
  assert.match(persistence, /ensurePackOpenClientEventId\(cards, set\.id\)/);
});

test("onboarding remains unskippable", () => {
  assert.equal(isPackSkipReady({
    stage: "revealing",
    assetsReady: true,
    tutorialMode: true,
    skipStarted: false,
  }), false);
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
