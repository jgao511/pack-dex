import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CANONICAL_PHONE_REVEAL_QUERY,
  createCanonicalRevealSession,
  isCanonicalPhoneRevealViewport,
} from "../src/lib/canonicalRevealSession.js";
import {
  REVEAL_STYLE_KEY,
  claimTapRevealInput,
  getSwipeReleaseAction,
  revealCardAtIndex,
} from "../src/lib/revealStyle.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("canonical phone reveal uses the same stable preference and gesture primitives as mobile PackDex", async () => {
  const mobileBridge = await read("../mobile-app/src/lib/revealStyle.js");
  assert.equal(REVEAL_STYLE_KEY, "packdex_reveal_style_v1");
  assert.match(mobileBridge, /export \* from "\.\.\/\.\.\/\.\.\/src\/lib\/revealStyle\.js"/);
  assert.equal(claimTapRevealInput(100, 101).accepted, false);
  assert.equal(revealCardAtIndex(new Set(), 0, 1).isComplete, true);
  assert.equal(getSwipeReleaseAction({ deltaX: 100, elapsedMs: 200 }).action, "dismiss");
});

test("phone and desktop sessions lock their surface and mode for one pack lifetime", () => {
  assert.equal(CANONICAL_PHONE_REVEAL_QUERY, "(max-width: 720px)");
  assert.equal(isCanonicalPhoneRevealViewport({ matchMedia: () => ({ matches: true }), innerWidth: 1440 }), true);
  assert.equal(isCanonicalPhoneRevealViewport({ matchMedia: () => ({ matches: false }), innerWidth: 390 }), false);
  assert.equal(isCanonicalPhoneRevealViewport({ innerWidth: 390 }), true);

  const phoneSession = createCanonicalRevealSession({ phoneViewport: true, preferredStyle: "swipe", sequence: 4 });
  const desktopSession = createCanonicalRevealSession({ phoneViewport: false, preferredStyle: "swipe", sequence: 5 });
  assert.deepEqual(phoneSession, { sequence: 4, interactionSurface: "phone", revealStyle: "swipe" });
  assert.deepEqual(desktopSession, { sequence: 5, interactionSurface: "desktop", revealStyle: "automatic" });
  assert.equal(Object.isFrozen(phoneSession), true);
});

test("shared swipe surface owns pointer cleanup, keyboard access, and reduced-motion timing", async () => {
  const [surface, styles] = await Promise.all([
    read("../src/components/reveal/SwipeRevealSurface.jsx"),
    read("../src/components/reveal/SwipeRevealSurface.css"),
  ]);
  assert.match(surface, /getSwipeReleaseAction/);
  assert.match(surface, /onPointerDown=\{handlePointerDown\}/);
  assert.match(surface, /onPointerCancel=/);
  assert.match(surface, /onLostPointerCapture=/);
  assert.match(surface, /window\.clearTimeout\(exitTimerRef\.current\)/);
  assert.match(surface, /reducedMotion \? 20 : 260/);
  assert.match(surface, /onKeyDown=/);
  assert.match(styles, /\.packdex-swipe-reveal/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("canonical reveal completion is claimed once and interactive ads remain governed by reveal screen state", async () => {
  const [cardReveal, app, packOpening, canonicalStyles] = await Promise.all([
    read("../src/components/CardReveal.jsx"),
    read("../src/App.jsx"),
    read("../src/components/PackOpening.jsx"),
    read("../src/components/reveal/CanonicalPhoneReveal.css"),
  ]);
  assert.match(cardReveal, /completionScheduledRef\.current \|\| completionClaimedRef\.current/);
  assert.match(cardReveal, /completionClaimedRef\.current = true;\s*onCardsRevealed\(cards\);\s*onComplete\(\)/);
  assert.match(cardReveal, /useEffect\(\(\) => \(\) => clearTimers\(\), \[\]\)/);
  assert.match(cardReveal, /revealCardAtIndex/);
  assert.match(cardReveal, /<SwipeRevealSurface/);
  assert.match(packOpening, /<option value="automatic">Automatic<\/option>[\s\S]*?<option value="tap">Tap<\/option>[\s\S]*?<option value="swipe">Swipe<\/option>/);
  assert.match(app, /createCanonicalRevealSession, isCanonicalPhoneRevealViewport/);
  assert.match(app, /const \[preferredRevealStyle, setPreferredRevealStyle\] = useState\(\(\) => loadRevealStyle\(\)\)/);
  assert.match(app, /function lockRevealSessionForNextPack\(\)[\s\S]*?isPublicSetRoute && isCanonicalPhoneRevealViewport\(window\)[\s\S]*?setActiveRevealSession\(nextSession\)/);
  assert.equal((app.match(/lockRevealSessionForNextPack\(\);/g) || []).length, 3);
  assert.match(app, /showRevealStyle=\{isPublicSetRoute\}/);
  assert.match(app, /revealStyle=\{activeRevealSession\.revealStyle\}[\s\S]*?interactionSurface=\{activeRevealSession\.interactionSurface\}/);
  assert.doesNotMatch(app, /<MobileApp|from ["']\.\/mobile-app/);
  assert.match(app, /isPackReveal: screen === "reveal"/);
  assert.match(app, /isFullscreenInteraction: \["reveal", "summary"\]\.includes\(screen\)/);
  assert.match(canonicalStyles, /\.canonical-phone-reveal-style\s*\{[\s\S]*?display:\s*none/);
  assert.match(canonicalStyles, /@media \(max-width:\s*720px\)[\s\S]*?\.canonical-phone-reveal-style\s*\{[\s\S]*?display:\s*flex/);
  assert.match(canonicalStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
