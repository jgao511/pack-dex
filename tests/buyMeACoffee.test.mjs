import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BUY_ME_A_COFFEE_URL } from "../src/config/support.js";
import {
  BUY_ME_A_COFFEE_GUEST_PACKS_KEY,
  BUY_ME_A_COFFEE_PROMPT_COOLDOWN_MS,
  claimBuyMeACoffeePrompt,
  dismissBuyMeACoffeePrompt,
  loadGuestLifetimePacks,
  readBuyMeACoffeePromptState,
  recordGuestCompletedPack,
} from "../src/lib/buyMeACoffeePrompt.js";
import {
  GUEST_LIFETIME_PACKS_KEY,
  loadGuestLifetimePacks as loadMobileGuestLifetimePacks,
  recordGuestCompletedPack as recordMobileGuestCompletedPack,
} from "../mobile-app/src/lib/guestPackStats.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("Buy Me a Coffee URL is centralized and exact", async () => {
  assert.equal(BUY_ME_A_COFFEE_URL, "https://buymeacoffee.com/packdex");

  const files = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/LandingPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/BuyMeACoffeeCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/BuyMeACoffeePrompt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
  ]);
  assert.equal(files.some((source) => source.includes("https://buymeacoffee.com/packdex")), false);
});

test("milestone is claimed only after 50 completed packs and not twice on rerender", () => {
  const storage = createStorage();
  assert.equal(claimBuyMeACoffeePrompt({ packsOpened: 49, storage, now: 1_000 }).shouldShow, false);
  assert.equal(claimBuyMeACoffeePrompt({ packsOpened: 50, storage, now: 2_000 }).shouldShow, true);
  assert.equal(claimBuyMeACoffeePrompt({ packsOpened: 50, storage, now: 2_001 }).shouldShow, false);
  assert.equal(readBuyMeACoffeePromptState({ storage }).shownCount, 1);
});

test("a user already above 50 becomes eligible after the next successful saved pack", () => {
  const storage = createStorage();
  assert.equal(claimBuyMeACoffeePrompt({ packsOpened: 87, storage, now: 3_000 }).shouldShow, true);
  assert.equal(claimBuyMeACoffeePrompt({ packsOpened: 88, storage, now: 3_001 }).shouldShow, false);
});

test("dismissal enforces a 30-day cooldown and the prompt appears at most twice", () => {
  const storage = createStorage();
  const firstShownAt = 10_000;
  claimBuyMeACoffeePrompt({ packsOpened: 50, storage, now: firstShownAt });
  dismissBuyMeACoffeePrompt({ storage, now: firstShownAt + 100 });

  assert.equal(
    claimBuyMeACoffeePrompt({ packsOpened: 51, storage, now: firstShownAt + 100 + BUY_ME_A_COFFEE_PROMPT_COOLDOWN_MS - 1 }).shouldShow,
    false
  );
  assert.equal(
    claimBuyMeACoffeePrompt({ packsOpened: 52, storage, now: firstShownAt + 100 + BUY_ME_A_COFFEE_PROMPT_COOLDOWN_MS }).shouldShow,
    true
  );
  dismissBuyMeACoffeePrompt({ storage, now: firstShownAt + 200 + BUY_ME_A_COFFEE_PROMPT_COOLDOWN_MS });
  assert.equal(
    claimBuyMeACoffeePrompt({ packsOpened: 80, storage, now: firstShownAt + 300 + BUY_ME_A_COFFEE_PROMPT_COOLDOWN_MS * 2 }).shouldShow,
    false
  );
});

test("guest lifetime count is durable and malformed or unavailable storage fails safely", () => {
  const storage = createStorage({ [BUY_ME_A_COFFEE_GUEST_PACKS_KEY]: "49" });
  assert.equal(loadGuestLifetimePacks(storage), 49);
  assert.equal(recordGuestCompletedPack(storage), 50);
  assert.equal(loadGuestLifetimePacks(storage), 50);

  const malformed = createStorage({ [BUY_ME_A_COFFEE_GUEST_PACKS_KEY]: "not-a-number" });
  assert.equal(loadGuestLifetimePacks(malformed), 0);
  assert.doesNotThrow(() => claimBuyMeACoffeePrompt({ packsOpened: 50, storage: {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  } }));
});

test("website keeps optional contributions while the App Store code omits them", async () => {
  const [desktop, landing, mobile, mobileCss, card, prompt, mobileMain] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/LandingPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/BuyMeACoffeeCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/BuyMeACoffeePrompt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/main.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(desktop, /Buy Me a Coffee/);
  assert.match(desktop, /Contact Support/);
  assert.match(desktop, /mailto:\$\{SUPPORT_EMAIL\}/);
  assert.match(landing, /Buy Me a Coffee/);
  assert.match(landing, /PackDex Support/);
  assert.match(mobile, /Contact Support/);
  assert.doesNotMatch(mobile, /BuyMeACoffee|buyMeACoffee|BUY_ME_A_COFFEE|buymeacoffee|Buy Me a Coffee/);
  assert.doesNotMatch(mobileCss, /buy-me-a-coffee|Buy Me a Coffee|buymeacoffee/);
  assert.match(card, /target="_blank"/);
  assert.match(card, /rel="noopener noreferrer"/);
  assert.match(prompt, /target="_blank"/);
  assert.match(prompt, /rel="noopener noreferrer"/);
  assert.match(mobileMain, /installNativeExternalLinkRouting\(\)/);
  assert.doesNotMatch(desktop, />Support</);
  assert.doesNotMatch(mobile, />Support</);
});

test("website milestone candidates remain intact while mobile tracks guest packs without contribution prompts", async () => {
  const [desktop, mobile] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(desktop, /result\?\.saved > 0 && result\?\.stats[\s\S]*pendingBuyMeACoffeePackCountRef/);
  assert.match(desktop, /saveCollection\(nextCollection\);[\s\S]*recordGuestCompletedPack\(\)/);
  assert.match(mobile, /persistSessionCollection\(nextCollection\);[\s\S]*recordGuestCompletedPack\(\)/);
  assert.match(desktop, /screen !== "summary"/);
  assert.doesNotMatch(mobile, /pendingBuyMeACoffeePackCountRef|claimBuyMeACoffeePrompt|dismissBuyMeACoffeePrompt/);

  const desktopEligibilityEffect = desktop.slice(
    desktop.indexOf("const packsOpened = pendingBuyMeACoffeePackCountRef.current"),
    desktop.indexOf("function commitAuthSession")
  );
  assert.doesNotMatch(desktopEligibilityEffect, /loadCloud(?:Collection|ProfileStats)|supabase\.|await /);
});

test("mobile guest pack counts use an App Store-neutral storage key", () => {
  const storage = createStorage({ [GUEST_LIFETIME_PACKS_KEY]: "49" });
  assert.equal(loadMobileGuestLifetimePacks(storage), 49);
  assert.equal(recordMobileGuestCompletedPack(storage), 50);
  assert.equal(loadMobileGuestLifetimePacks(storage), 50);
  assert.doesNotMatch(GUEST_LIFETIME_PACKS_KEY, /coffee|donat|support/i);
});
