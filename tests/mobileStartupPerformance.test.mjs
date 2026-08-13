import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  claimMobileBootstrapSetIntent,
  consumePendingMobileBootstrapSetId,
  consumePendingMobileBootstrapTab,
  setPendingMobileBootstrapSetId,
  setPendingMobileBootstrapTab,
} from "../mobile-app/src/lib/mobileBootstrapIntent.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("mobile initial HTML reuses the delayed PackDex startup treatment before JavaScript", async () => {
  const html = await read("../mobile-app/index.html");
  const shellIndex = html.indexOf("data-packdex-boot-shell");
  const scriptIndex = html.indexOf('<script type="module" src="/src/main.jsx"></script>');

  assert.ok(shellIndex >= 0);
  assert.ok(scriptIndex > shellIndex);
  assert.match(html, /data-packdex-branded-loader/);
  assert.match(html, /packdex-startup__wordmark/);
  assert.match(html, /Preparing your collection/);
  assert.match(html, /packdex-startup-delay 0s linear 120ms forwards/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(html, /packdex-boot-block|packdex-boot-nav|packdex-boot-geometry/);
  assert.doesNotMatch(html, /rel="preload"[^>]+card-back\.png/);
  assert.doesNotMatch(html, /0\s*\/\s*\d+ cards/);
  assert.doesNotMatch(html, /Pok[eé]mon 151/);
});

test("React mobile shell is not gated by account hydration", async () => {
  const app = await read("../mobile-app/src/App.jsx");

  assert.match(app, /<MobileBrandHeader \/>/);
  assert.match(app, /\{!onboardingStep && <nav className=\{`bottom-tabs/);
  assert.doesNotMatch(app, /startupPhase === "complete" && <MobileBrandHeader/);
  assert.doesNotMatch(app, /startupPhase === "complete" && !isOnboardingActive && <nav/);
  assert.doesNotMatch(app, /startupPhase !== "complete" \? <PackDexStartupAnimation/);
  assert.match(app, /refreshAuthSession\(\{ initial: true, showLoading: false \}\)/);
  assert.match(app, /\.finally\(\(\) => \{[\s\S]*?finishInitialHydration\(\)/);
  assert.match(app, /\.\.\.candidateSets\.map\(\(set\) => getSetLogoUrl\(set\)\)/);
  assert.doesNotMatch(app, /PRELOAD_CARD_LIMIT_PER_SET/);
  const idleWarmup = app.match(/useEffect\(\(\) => \{[\s\S]*?const candidateSets[\s\S]*?\}, \[activeTab,[\s\S]*?\);/)?.[0] || "";
  assert.doesNotMatch(idleWarmup, /getCardBackUrl\(\)/);
  assert.doesNotMatch(idleWarmup, /getPackCardImageUrl/);
});

test("unresolved mobile data uses neutral geometry while known Pack Ready assets are prioritized", async () => {
  const [app, bootstrap, css] = await Promise.all([
    read("../mobile-app/src/App.jsx"),
    read("../mobile-app/src/MobileBootstrap.jsx"),
    read("../mobile-app/src/App.css"),
  ]);

  assert.match(app, /className="account-notice is-skeleton"/);
  assert.match(app, /return <PackDexStartupAnimation delayed \/>/);
  assert.match(app, /className="pack-logo" loading="eager" fetchPriority="high"/);
  assert.match(bootstrap, /className="mobile-set-count-skeleton" aria-hidden="true"/);
  assert.doesNotMatch(bootstrap, /set\.cardCount\} supported cards/);
  assert.match(css, /\.mobile-skeleton-block/);
  assert.match(css, /\.mobile-set-main \.mobile-set-count-skeleton/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("mobile startup renders a real lightweight destination before requesting the heavy controller", async () => {
  const [main, bootstrap] = await Promise.all([
    read("../mobile-app/src/main.jsx"),
    read("../mobile-app/src/MobileBootstrap.jsx"),
  ]);

  assert.doesNotMatch(main, /^import .*\.\/App\.jsx/m);
  assert.match(main, /flushSync\(\(\) => root\.render\([\s\S]*?<MobileBootstrap/);
  assert.match(main, /import\("\.\/App\.jsx"\)/);
  assert.match(main, /mobileHeavyAppRequestStart/);
  assert.match(main, /mobileHeavyAppLoaded/);
  assert.match(main, /mobileHeavyAppRenderStart/);
  assert.match(main, /mobileReactRootCreated/);
  assert.doesNotMatch(main, /^import .*supabaseClient/m);
  assert.doesNotMatch(main, /^import .*MobileResetPasswordPage/m);
  assert.doesNotMatch(main, /^import .*PublicPullSharePage/m);
  assert.match(main, /packdex:mobile-real-screen[\s\S]*scheduleServiceWorkerRegistration/);
  assert.match(bootstrap, /setCatalogMetadata/);
  assert.match(bootstrap, /data-packdex-real-mobile-selector/);
  assert.match(bootstrap, /Choose a set/);
  assert.match(bootstrap, /onPointerDown/);
  assert.match(bootstrap, /onKeyDown/);
  const packReadyBootstrap = bootstrap.slice(
    bootstrap.indexOf("function MobilePackReadyBootstrap"),
    bootstrap.indexOf("function getTutorialMetadata"),
  );
  assert.match(packReadyBootstrap, /mobileBootstrapPackReadyShell/);
  assert.doesNotMatch(packReadyBootstrap, /\bmode\b/);
  assert.match(bootstrap, /MobileTabBootstrap/);
  assert.match(bootstrap, /data-packdex-mobile-loading-fallback/);
  assert.match(bootstrap, /<PackDexStartupAnimation delayed \/>/);
  assert.match(main, /initialTab === "open"[\s\S]*?"selector"[\s\S]*?: initialTab/);
});

test("a set pointer intent survives a heavy-App handoff between pointerdown and click", () => {
  const events = [];
  class TestCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const fakeWindow = {
    CustomEvent: TestCustomEvent,
    dispatchEvent: (event) => events.push(event),
    performance: { now: () => 42, mark: () => {} },
  };

  assert.equal(claimMobileBootstrapSetIntent("151", fakeWindow), "151");
  assert.equal(fakeWindow.__packdexPerformance.mobileSetTapStart, 42);
  assert.equal(events.length, 1);

  // main.jsx consumes this value and synchronously replaces the bootstrap.
  assert.equal(consumePendingMobileBootstrapSetId(fakeWindow), "151");
  assert.equal(consumePendingMobileBootstrapSetId(fakeWindow), "");

  // Repeated pointer/click delivery is idempotent while the same intent is pending.
  setPendingMobileBootstrapSetId("151", fakeWindow);
  setPendingMobileBootstrapSetId("151", fakeWindow);
  assert.equal(events.length, 2);
});

test("bottom-tab intent is retained if the heavy controller replaces the button before click", () => {
  const fakeWindow = {};
  assert.equal(setPendingMobileBootstrapTab("collection", fakeWindow), "collection");
  assert.equal(consumePendingMobileBootstrapTab(fakeWindow), "collection");
  assert.equal(consumePendingMobileBootstrapTab(fakeWindow), "");
});

test("first-time phone startup preserves the real onboarding entry instead of bypassing it", async () => {
  const [main, bootstrap, app] = await Promise.all([
    read("../mobile-app/src/main.jsx"),
    read("../mobile-app/src/MobileBootstrap.jsx"),
    read("../mobile-app/src/App.jsx"),
  ]);

  assert.match(main, /isMobileOnboardingComplete\(\)/);
  assert.match(main, /const bootstrapMode = !isReturningVisitor/);
  assert.match(main, /<MobileBootstrap mode=\{bootstrapMode\}/);
  assert.match(bootstrap, /data-packdex-onboarding-bootstrap/);
  assert.match(bootstrap, /Open packs\. Build your collection\. Chase every card\./);
  assert.match(bootstrap, /Choose your first pack/);
  assert.match(bootstrap, /setPendingMobileBootstrapOnboardingAction/);
  assert.match(app, /const isOnboardingActive = Boolean\(onboardingStep\);/);
  assert.doesNotMatch(app, /Boolean\(onboardingStep\) && authValidationState !== "validating"/);
});

test("Explore is loaded only from Explore intent and never by an idle startup warmup", async () => {
  const app = await read("../mobile-app/src/App.jsx");
  const exploreIntentHandlers = app.match(/onPointerDown=\{\(\) => \{[\s\S]*?onClick=\{\(\) => switchMobileTab\(tab\.id\)\}/)?.[0] || "";

  assert.match(exploreIntentHandlers, /tab\.id === "explore"/);
  assert.match(exploreIntentHandlers, /loadExploreScreenModule\(\)/);
  assert.doesNotMatch(app, /requestIdleCallback\([^)]*loadExploreScreenModule/);
  assert.doesNotMatch(app, /scheduleIdleTask\([^)]*loadExploreScreenModule/);
});
