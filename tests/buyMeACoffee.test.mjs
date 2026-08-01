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

test("desktop and mobile surfaces keep financial and customer support actions distinct", async () => {
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
  assert.match(landing, /Contact Support/);
  const mobileCards = [...mobile.matchAll(/<BuyMeACoffeeCard\b[^>]*\/>/g)];
  assert.equal(mobileCards.length, 1);
  assert.match(mobileCards[0][0], /className="mobile-profile-support-card" source="profile"/);
  assert.doesNotMatch(mobile, /<BuyMeACoffeeCard[^>]*source="settings"/);
  assert.match(mobile, /Contact Support/);
  const mobileProfileStart = mobile.indexOf("function ProfileScreen");
  const mobileSupportCard = mobile.indexOf('<BuyMeACoffeeCard className="mobile-profile-support-card"', mobileProfileStart);
  const mobileDisclaimer = mobile.indexOf('<section className="content-section">', mobileSupportCard);
  assert.ok(mobileProfileStart >= 0 && mobileSupportCard > mobileProfileStart);
  assert.ok(mobileDisclaimer > mobileSupportCard);
  assert.match(mobileCss, /\.mobile-profile-support-card[\s\S]*border-radius: 20px/);
  assert.match(mobileCss, /\.mobile-profile-support-card \.buy-me-a-coffee-card__action[\s\S]*width: 100%/);
  assert.doesNotMatch(mobileCss, /\.mobile-profile-support-card\s*\{[^}]*position:\s*(?:fixed|sticky)/);
  assert.match(card, /target="_blank"/);
  assert.match(card, /rel="noopener noreferrer"/);
  assert.match(prompt, /target="_blank"/);
  assert.match(prompt, /rel="noopener noreferrer"/);
  assert.match(mobileMain, /installNativeExternalLinkRouting\(\)/);
  assert.doesNotMatch(desktop, />Support</);
  assert.doesNotMatch(mobile, />Support</);
});

test("milestone candidates are assigned only from successful completed-pack persistence", async () => {
  const [desktop, mobile] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(desktop, /result\?\.saved > 0 && result\?\.stats[\s\S]*pendingBuyMeACoffeePackCountRef/);
  assert.match(desktop, /saveCollection\(nextCollection\);[\s\S]*recordGuestCompletedPack\(\)/);
  assert.match(mobile, /persistSessionCollection\(nextCollection\);[\s\S]*recordGuestCompletedPack\(\)/);
  assert.match(mobile, /syncResult\.saved > 0[\s\S]*pendingBuyMeACoffeePackCountRef/);
  assert.match(desktop, /screen !== "summary"/);
  assert.match(mobile, /packStage !== "summary"/);
  assert.match(mobile, /onboardingStep/);

  const desktopEligibilityEffect = desktop.slice(
    desktop.indexOf("const packsOpened = pendingBuyMeACoffeePackCountRef.current"),
    desktop.indexOf("function commitAuthSession")
  );
  const mobileEligibilityEffect = mobile.slice(
    mobile.indexOf("const packsOpened = pendingBuyMeACoffeePackCountRef.current"),
    mobile.indexOf("const setsCompleted")
  );
  assert.doesNotMatch(desktopEligibilityEffect, /loadCloud(?:Collection|ProfileStats)|supabase\.|await /);
  assert.doesNotMatch(mobileEligibilityEffect, /loadCloud(?:Collection|ProfileStats)|supabase\.|await /);
});
