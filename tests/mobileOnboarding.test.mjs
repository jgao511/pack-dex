import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_ONBOARDING_VERSION,
  createTutorialPack,
  getCommunityStatItems,
  getTutorialSets,
  hasCompletedMobileOnboarding,
  isMobileOnboardingEligible,
  markMobileOnboardingComplete,
  readMobileOnboardingState,
  resetMobileOnboarding,
  restoreTutorialPack,
  TUTORIAL_HIT_POOLS,
  writeMobileOnboardingState,
} from "../mobile-app/src/lib/mobileOnboarding.js";
import { isCardAllowedInPackSlot } from "../src/utils/packGenerator.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("tutorial choices derive the newest released set and include 151 and Prismatic Evolutions", () => {
  const choices = getTutorialSets(new Date("2026-07-26T12:00:00Z"));
  assert.deepEqual(choices.map((set) => set.id), ["pitch-black", "151", "prismatic-evolutions"]);
});

test("each tutorial pack keeps its valid normal slots and guarantees a curated mid-tier hit", () => {
  for (const set of getTutorialSets(new Date("2026-07-26T12:00:00Z"))) {
    const pack = createTutorialPack(set, "stable-test-device");
    assert.equal(pack.length, 10);
    pack.forEach((card, index) => assert.equal(isCardAllowedInPackSlot(card, index, set), true, `${set.id} card ${index} is valid`));
    const showcaseHits = pack
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => /Illustration Rare/i.test(String(card.rarity || "")));
    assert.ok(showcaseHits.length >= 1, `${set.id} has a showcase hit`);
    assert.ok(showcaseHits.some(({ index }) => index === 8), `${set.id} places its showcase hit in the eligible hit slot`);
    assert.equal(TUTORIAL_HIT_POOLS[set.id].includes(pack.at(-1)?.id), false, `${set.id} never places a curated guarantee in the final rare slot`);
    assert.equal(pack.isGodPack, false);
    assert.equal(pack.onboardingTutorial, true);
  }
});

test("resumable tutorial cards restore from catalog ids without serializing the full catalog", () => {
  const set = getTutorialSets(new Date("2026-07-26T12:00:00Z"))[0];
  const pack = createTutorialPack(set, "restore-device");
  const restored = restoreTutorialPack({ setId: set.id, cardIds: pack.map((card) => card.id) });
  assert.equal(restored.set.id, set.id);
  assert.deepEqual(restored.cards.map((card) => card.id), pack.map((card) => card.id));
});

test("versioned completion and replay touch only onboarding keys", () => {
  const storage = memoryStorage();
  storage.setItem("unrelated", "keep");
  writeMobileOnboardingState({ step: "choose-set" }, storage);
  assert.equal(readMobileOnboardingState(storage).version, MOBILE_ONBOARDING_VERSION);
  markMobileOnboardingComplete(storage);
  assert.equal(hasCompletedMobileOnboarding(storage), true);
  assert.equal(readMobileOnboardingState(storage), null);
  resetMobileOnboarding(storage);
  assert.equal(hasCompletedMobileOnboarding(storage), false);
  assert.equal(storage.getItem("unrelated"), "keep");
});

test("the onboarding guard accepts phones and rejects desktop or explicit desktop mode", () => {
  assert.equal(isMobileOnboardingEligible({ userAgent: "Mozilla/5.0 (iPhone)", viewportWidth: 393 }), true);
  assert.equal(isMobileOnboardingEligible({ userAgent: "Mozilla/5.0 (Linux; Android 15)", viewportWidth: 412 }), true);
  assert.equal(isMobileOnboardingEligible({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    viewportWidth: 390,
    coarsePointer: false,
  }), false);
  assert.equal(isMobileOnboardingEligible({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    viewportWidth: 1440,
    coarsePointer: false,
  }), false);
  assert.equal(isMobileOnboardingEligible({
    userAgent: "Mozilla/5.0 (iPhone)",
    viewportWidth: 393,
    search: "?desktop=1",
  }), false);
});

test("community statistics preserve order and skip only unavailable fields", () => {
  assert.deepEqual(getCommunityStatItems({
    packsOpened: 1_284_392,
    cardsPulled: 12_843_920,
    popularSetName: "Prismatic Evolutions",
  }), [
    { rawValue: 1_284_392, label: "packs opened" },
    { rawValue: 12_843_920, label: "cards pulled" },
    { value: "Prismatic Evolutions", label: "most popular set this week" },
  ]);
  assert.deepEqual(getCommunityStatItems({
    packsOpened: 1_284_392,
    popularSetName: "Prismatic Evolutions",
  }), [
    { rawValue: 1_284_392, label: "packs opened" },
    { value: "Prismatic Evolutions", label: "most popular set this week" },
  ]);
});
