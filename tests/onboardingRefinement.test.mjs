import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ONBOARDING_CONVEYOR_CARD_REFS,
  TUTORIAL_HIT_POOLS,
  createTutorialPack,
  getOnboardingConveyorCards,
  getTutorialSets,
} from "../mobile-app/src/lib/mobileOnboarding.js";

const appUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);
const onboardingUrl = new URL("../mobile-app/src/components/MobileOnboarding.jsx", import.meta.url);
const onboardingCssUrl = new URL("../mobile-app/src/components/MobileOnboarding.css", import.meta.url);
const appCssUrl = new URL("../mobile-app/src/App.css", import.meta.url);
const exploreUrl = new URL("../mobile-app/src/explore/ExploreScreen.jsx", import.meta.url);
const exploreCssUrl = new URL("../mobile-app/src/explore/ExploreScreen.css", import.meta.url);
const priceRefreshUrl = new URL("../mobile-app/src/explore/pokemonPriceRefresh.js", import.meta.url);

test("tutorial pools are varied and never use the excluded signature chases", () => {
  for (const set of getTutorialSets(new Date("2026-07-26T12:00:00Z"))) {
    const pool = TUTORIAL_HIT_POOLS[set.id];
    assert.ok(pool.length >= 3, `${set.id} provides a varied tutorial pool`);
    assert.equal(new Set(pool).size, pool.length);
    assert.ok(pool.every((id) => !/umbreon|charizard|zeraora/i.test(id)), `${set.id} avoids its signature chase`);
  }

  const set = getTutorialSets(new Date("2026-07-26T12:00:00Z"))[0];
  const pulls = new Set(["device-a", "device-b", "device-c", "device-d"].map((id) => createTutorialPack(set, id)[8].id));
  assert.ok(pulls.size >= 2, "the deterministic device seed rotates the curated hit");
});

test("the final conveyor resolves exactly the documented, non-duplicated catalog cards", () => {
  const cards = getOnboardingConveyorCards();
  assert.equal(cards.length, 16);
  assert.equal(ONBOARDING_CONVEYOR_CARD_REFS.length, 16);
  assert.equal(new Set(cards.map(({ set, card }) => `${set.id}:${card.id}`)).size, cards.length);
  assert.ok(new Set(cards.map(({ set }) => set.era)).size >= 3);
  assert.ok(cards.some(({ card }) => /pikachu/i.test(card.name)));
  assert.ok(cards.some(({ card }) => /rayquaza/i.test(card.name)));
  assert.ok(cards.some(({ card }) => /lugia|mew|gengar|giratina|dragonite/i.test(card.name)));
  assert.ok(cards.filter(({ card }) => /charizard/i.test(card.name)).length <= 2);
  assert.ok(cards.filter(({ card }) => /umbreon|espeon|vaporeon|jolteon|flareon|sylveon|glaceon|leafeon/i.test(card.name)).length <= 2);
});

test("normal pack reveal has no skip affordance while onboarding keeps its separate setup Skip", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.doesNotMatch(source, /Tap anywhere to skip|skipPackReveal|isPackSkipReady/);
  assert.match(source, /runMobileOnboardingSkip/);
  assert.match(source, /onSkip=\{skipOnboarding\}/);
});

test("Open This Pack does not forward the React click event as a set id", async () => {
  const source = await readFile(onboardingUrl, "utf8");
  assert.match(source, /onClick=\{\(\) => onOpen\(\)\}>Open This Pack/);
  assert.doesNotMatch(source, /onClick=\{onOpen\}>Open This Pack/);
});

test("onboarding uses the shared Explore search, a three-step real-page tour, and shared public counters", async () => {
  const [onboarding, app, explore, priceRefresh] = await Promise.all([
    readFile(onboardingUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(exploreUrl, "utf8"),
    readFile(priceRefreshUrl, "utf8"),
  ]);
  assert.match(onboarding, /import\("\.\.\/explore\/exploreData\.js"\)/);
  assert.match(onboarding, /groupedExploreSearch/);
  assert.match(onboarding, /const WALKTHROUGH = \[/);
  assert.match(onboarding, /Meet \$\{pokemon/);
  assert.match(onboarding, /getTourTargetTop/);
  assert.match(onboarding, /onboarding-tutorial-conveyor/);
  assert.match(onboarding, /onboarding-pokemon-enter/);
  assert.match(onboarding, /useAnimatedCount/);
  assert.match(app, /getPublicPackDexStats/);
  assert.match(app, /params\.get\("statsPreview"\) === "1"/);
  assert.doesNotMatch(app, /onboardingDevScenario\.stats === "preview"/);
  assert.match(app, /resetOnboardingScroll/);
  assert.match(app, /onInspectCard=\{\(card, set\) => inspectCard\(card, set, \{ origin: "onboarding-summary" \}\)\}/);
  assert.match(explore, /data-onboarding-anchor="summary"/);
  assert.match(explore, /pokemon-info-overview/);
  assert.doesNotMatch(explore, /data-onboarding-anchor="price"/);
  assert.match(explore, /priced\[0\] && <PriceHighlight/);
  assert.match(explore, /onboardingPriceScenario === "slow"/);
  assert.match(priceRefresh, /loadCardPricesForCollection/);
});

test("tutorial collections use the shared detail flow and an accessible auto conveyor", async () => {
  const [onboarding, onboardingCss, appCss] = await Promise.all([
    readFile(onboardingUrl, "utf8"),
    readFile(onboardingCssUrl, "utf8"),
    readFile(appCssUrl, "utf8"),
  ]);

  assert.match(onboarding, /onInspectCard\?\.\(card, set, \{ origin: "onboarding-collection" \}\)/);
  assert.match(onboarding, /isCardDetailOpen/);
  assert.doesNotMatch(onboarding, /onboarding-pull-row/);
  assert.match(onboardingCss, /onboarding-tutorial-conveyor-move/);
  assert.match(onboardingCss, /onboarding-tutorial-conveyor\.is-static/);
  assert.match(onboardingCss, /onboarding-tutorial-conveyor:hover/);
  assert.match(onboardingCss, /scrollbar-width:none/);
  assert.match(appCss, /\.inspect-backdrop[\s\S]*z-index: 90/);
  assert.match(appCss, /\.inspect-modal\.is-minimal-preview/);
  assert.match(appCss, /\.card-inspect-open \.screen-content/);
  assert.match(onboarding, /visible && !isCardDetailOpen/);
});

test("the final community screen has no implicit preview fallback and always resets onboarding scroll", async () => {
  const [app, onboarding, onboardingCss] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(onboardingUrl, "utf8"),
    readFile(onboardingCssUrl, "utf8"),
  ]);

  assert.match(app, /const useDevPreview = import\.meta\.env\.DEV && !forceFailedStats && !forceLoadingStats && params\.get\("statsPreview"\) === "1"/);
  assert.match(app, /setOnboardingStats\(null\);\s*if \(useDevPreview\)/);
  assert.doesNotMatch(app, /onboardingStatsDevPreview|setOnboardingStatsDevPreview/);
  assert.match(app, /document\.body\.style\.overflow = ""/);
  assert.match(app, /document\.documentElement\.style\.overflow = ""/);
  assert.match(onboarding, /onboarding-stat-skeleton/);
  assert.doesNotMatch(onboarding, /Not available yet/);
  assert.doesNotMatch(onboarding, /Collectors are opening packs every day/);
  assert.doesNotMatch(onboarding, /Development preview/);
  assert.match(onboarding, /onboarding-stat is-empty/);
  assert.match(onboarding, /STAT_SLIDE_INDEX/);
  assert.match(onboarding, /Number\.isInteger\(fixedStatIndex\)/);
  assert.match(onboardingCss, /width:min\(84vw,346px\)/);
  assert.match(onboardingCss, /flex:0 0 clamp\(282px,36\.5dvh,340px\)/);
  assert.match(onboardingCss, /overflow:hidden!important/);
  assert.doesNotMatch(onboarding, /onboarding-community-benefits/);
  assert.match(onboardingCss, /onboarding-community-account\{[\s\S]*background:none/);
  assert.match(onboarding, /index === WALKTHROUGH\.length - 1 \? "Continue" : "Next"/);
  assert.doesNotMatch(onboarding, /Current market information/);
});

test("welcome keeps one accessible Skip and centers pagination without active-width bias", async () => {
  const [onboarding, onboardingCss] = await Promise.all([
    readFile(onboardingUrl, "utf8"),
    readFile(onboardingCssUrl, "utf8"),
  ]);
  const welcome = onboarding.slice(onboarding.indexOf("function WelcomeStep"), onboarding.indexOf("function SetCardShowcase"));
  assert.doesNotMatch(welcome, /<OnboardingHeader allowSkip/);
  assert.equal((welcome.match(/<OnboardingSkipButton/g) || []).length, 1);
  assert.match(onboardingCss, /\.onboarding-dots\{display:grid;grid-auto-flow:column;grid-auto-columns:18px/);
  assert.match(onboardingCss, /justify-content:center/);
});

test("Appears In uses free native horizontal scrolling without conveyor motion or mandatory snapping", async () => {
  const [explore, exploreCss] = await Promise.all([
    readFile(exploreUrl, "utf8"),
    readFile(exploreCssUrl, "utf8"),
  ]);
  assert.match(explore, /function AppearsInConveyor/);
  assert.doesNotMatch(explore, /pauseAutoDrift|requestAnimationFrame\(drift\)|autoDrift/);
  assert.doesNotMatch(explore, /onPointerDown|onPointerMove|setPointerCapture/);
  assert.match(explore, /ArrowLeft/);
  assert.match(exploreCss, /\.appears-in-conveyor::?-webkit-scrollbar/);
  assert.match(exploreCss, /-webkit-overflow-scrolling: touch/);
  assert.doesNotMatch(exploreCss, /scroll-snap-type: x mandatory|scroll-snap-stop: always/);
  assert.match(exploreCss, /flex: 0 0 clamp\(224px, 66vw, 252px\)/);
  assert.match(explore, /onOpen=\{\(item\) => navigate/);
});

test("tour step three positions the complete target immediately above the visible callout", async () => {
  const [onboarding, onboardingCss] = await Promise.all([
    readFile(onboardingUrl, "utf8"),
    readFile(onboardingCssUrl, "utf8"),
  ]);
  assert.match(onboarding, /if \(stepIndex === 2\)/);
  assert.match(onboarding, /root\.clientHeight - calloutHeight - targetRect\.height - 30/);
  assert.match(onboarding, /active\.querySelector\("\.appears-in-conveyor"\)\?\.scrollTo\(\{ left: 0, behavior: "auto" \}\)/);
  assert.match(onboarding, /data-tour-step=\{index \+ 1\}/);
  assert.match(onboardingCss, /padding-bottom:calc\(190px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(onboardingCss, /padding-bottom:calc\(100dvh \+ 32px\)/);
});

test("Pokémon selection starts entering on mount and slow images never gate its text", async () => {
  const [onboarding, onboardingCss, app] = await Promise.all([
    readFile(onboardingUrl, "utf8"),
    readFile(onboardingCssUrl, "utf8"),
    readFile(appUrl, "utf8"),
  ]);
  assert.match(onboarding, /onboarding-pokemon is-entered/);
  assert.doesNotMatch(onboarding, /requestAnimationFrame\(\(\) => setEntered/);
  assert.match(onboarding, /FEATURED_POKEMON_IDS\.map/);
  assert.match(onboarding, /DeferredOnboardingImage/);
  assert.match(onboarding, /devScenario\?\.slowImages/);
  assert.match(onboardingCss, /\.onboarding-pokemon\.is-entered \.onboarding-header\{animation-delay:0s\}/);
  assert.match(onboardingCss, /onboarding-pokemon-immediate-enter/);
  assert.match(onboardingCss, /enter-pokemon-search\{animation-delay:\.41s\}/);
  assert.match(onboardingCss, /is-reduced-motion[\s\S]*opacity:1;transform:none;animation:none/);
  assert.match(app, /loadingMessage && !onboardingStep && <PokeballLoadingOverlay/);
});

test("the final conveyor reserves full card footprints while delayed images load", async () => {
  const [onboarding, onboardingCss] = await Promise.all([
    readFile(onboardingUrl, "utf8"),
    readFile(onboardingCssUrl, "utf8"),
  ]);
  assert.match(onboarding, /slowImages \? 1400/);
  assert.match(onboardingCss, /width:clamp\(108px,28\.5vw,118px\)/);
  assert.match(onboardingCss, /aspect-ratio:734\/1024/);
  assert.match(onboardingCss, /object-fit:contain/);
  assert.match(onboardingCss, /img\.is-image-pending/);
  assert.match(onboardingCss, /img\.is-image-ready/);
});
