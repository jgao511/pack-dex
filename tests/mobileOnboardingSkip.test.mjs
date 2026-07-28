import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runMobileOnboardingSkip } from "../mobile-app/src/lib/mobileOnboardingSkip.js";

const appUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);
const onboardingUrl = new URL("../mobile-app/src/components/MobileOnboarding.jsx", import.meta.url);

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createHarness({ step = "welcome", userId = "" } = {}) {
  const inProgressRef = { current: false };
  const calls = [];
  const finalizer = deferred();
  const run = () => runMobileOnboardingSkip({
    inProgressRef,
    step,
    userId,
    onBegin: () => calls.push("begin"),
    saveAuthenticatedSkip: () => calls.push("save-authenticated-skip"),
    finishAuthenticatedSkip: async () => {
      calls.push("finish-authenticated");
      await finalizer.promise;
      calls.push("profile");
    },
    finishGuestSkip: () => {
      calls.push("write-completion");
      calls.push("open-app");
    },
    onSettled: () => calls.push("settled"),
  });
  return { calls, finalizer, inProgressRef, run };
}

test("Skip during or after entrance animation is owned by the first event", async () => {
  for (const phase of ["entrance-running", "entrance-complete"]) {
    const harness = createHarness();
    assert.equal(await harness.run(), true, phase);
    assert.deepEqual(harness.calls, ["begin", "write-completion", "open-app", "settled"]);
    assert.equal(harness.inProgressRef.current, true);
  }
});

test("rapid pointer-down plus click remains idempotent for authenticated onboarding", async () => {
  const harness = createHarness({ step: "choose-set", userId: "account-1" });
  const pointerDown = harness.run();
  const click = harness.run();

  assert.equal(await click, false);
  assert.deepEqual(harness.calls, ["begin", "save-authenticated-skip", "finish-authenticated"]);
  harness.finalizer.resolve();
  assert.equal(await pointerDown, true);
  assert.deepEqual(harness.calls, [
    "begin",
    "save-authenticated-skip",
    "finish-authenticated",
    "profile",
    "settled",
  ]);
});

test("guest completion and destination happen once without replaying the current step", async () => {
  const harness = createHarness();
  assert.deepEqual(await Promise.all([harness.run(), harness.run(), harness.run()]), [true, false, false]);
  assert.equal(harness.calls.filter((call) => call === "write-completion").length, 1);
  assert.equal(harness.calls.filter((call) => call === "open-app").length, 1);
  assert.equal(harness.calls.includes("reset-welcome"), false);
});

test("tutorial pack Skip stays unavailable and existing onboarding actions remain wired", async () => {
  const harness = createHarness({ step: "pack" });
  assert.equal(await harness.run(), false);
  assert.deepEqual(harness.calls, []);

  const onboarding = await readFile(onboardingUrl, "utf8");
  assert.match(onboarding, /onStart/);
  assert.match(onboarding, /onOpen/);
  assert.match(onboarding, /onContinue/);
  assert.match(onboarding, /onSelectPokemon/);
  assert.match(onboarding, /onExploreContinue/);
});

test("Skip claims pointer-down, keeps keyboard click fallback, and cannot bubble underneath", async () => {
  const onboarding = await readFile(onboardingUrl, "utf8");
  assert.match(onboarding, /onPointerDown=\{claimPointer\}/);
  assert.match(onboarding, /onClick=\{activate\}/);
  assert.match(onboarding, /event\.preventDefault\(\)/);
  assert.match(onboarding, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(onboarding, /isAnimating|isTransitioning/);
});

test("passive account refresh preserves a mounted onboarding step", async () => {
  const app = await readFile(appUrl, "utf8");
  assert.match(app, /const onboardingStepRef = useRef\(onboardingStep\)/);
  assert.match(app, /onboardingStepRef\.current = onboardingStep/);
  assert.match(app, /if \(!onboardingStepRef\.current\) setAuthValidationState\("validating"\)/);
  assert.match(app, /const skipOnboardingInProgressRef = useRef\(false\)/);
  assert.doesNotMatch(app.match(/async function skipOnboarding\(\)[\s\S]*?\n  \}/)?.[0] || "", /isFinishingOnboarding/);
});
