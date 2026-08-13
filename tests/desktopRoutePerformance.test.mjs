import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const mainSource = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const setSelectSource = fs.readFileSync(new URL("../src/components/SetSelect.jsx", import.meta.url), "utf8");
const staticAssetsSource = fs.readFileSync(new URL("../src/utils/staticOpenPackAssets.js", import.meta.url), "utf8");
const assetUrlsSource = fs.readFileSync(new URL("../src/utils/assetUrls.js", import.meta.url), "utf8");
const setsSource = fs.readFileSync(new URL("../src/data/sets.js", import.meta.url), "utf8");

test("ordinary set links keep their href while navigating in the mounted desktop app", () => {
  assert.match(setSelectSource, /href=\{setHref\}/);
  assert.match(setSelectSource, /onClick=\{\(event\) => handleSetLinkClick\(event, set, setHref\)\}/);
  assert.match(setSelectSource, /event\.metaKey[\s\S]*event\.ctrlKey[\s\S]*event\.shiftKey[\s\S]*event\.altKey/);
  assert.match(appSource, /function navigateToPublicSet\(set, requestedPath = ""\)/);
  assert.match(appSource, /setRoute\(resolveFullRuntimeRoute\(parseRuntimeSiteRoute\(canonicalPath\)\)\)/);
  assert.match(appSource, /setScreen\("opening"\)/);
});

test("Pack Ready and Back to Sets transitions do not unload the document", () => {
  const navigateToSets = appSource.slice(appSource.indexOf("function navigateToSets()"), appSource.indexOf("const publicSetAdContext", appSource.indexOf("function navigateToSets()")));
  assert.match(navigateToSets, /pushAppHistory\([^]*?"\/sets"\)/);
  assert.match(navigateToSets, /setRoute\(parseRuntimeSiteRoute\("\/sets"\)\)/);
  assert.match(navigateToSets, /setScreen\("home"\)/);
  assert.doesNotMatch(navigateToSets, /location\.(?:assign|replace)|location\.href/);
  assert.match(appSource, /const nextRoute = resolveFullRuntimeRoute\(parseRuntimeSiteRoute\(window\.location\.pathname\)\)/);
});

test("the selector no longer validates all 129 pack pools during render", () => {
  assert.doesNotMatch(setSelectSource, /canGeneratePack|SET_READINESS_CACHE|getSetReadiness/);
  assert.match(appSource, /sets=\{activeSets\}/);
});

test("startup resolves routes from lightweight metadata and preserves or paints real destination content", () => {
  assert.match(mainSource, /from "\.\/lib\/runtimeRoutes\.js"/);
  assert.match(mainSource, /from "\.\/lib\/setRouteCatalog\.js"/);
  assert.doesNotMatch(mainSource, /import\("\.\/lib\/publicRoutes\.js"\)/);
  assert.match(mainSource, /const route = parseRuntimeSiteRoute\(normalizedPath\)/);
  assert.match(mainSource, /renderInitialProductContent\(route, handleFacadeSetNavigation, handleFacadeSetOpen\)/);
  assert.match(mainSource, /flushSync\(\(\) =>/);
  assert.match(mainSource, /if \(hasSnapshot && !replace\) return/);
  assert.match(mainSource, /data-packdex-real-content="sets"/);
  assert.match(mainSource, /data-packdex-real-content="pack-ready"/);
  assert.doesNotMatch(mainSource, /Loading Pok/);
});

test("an early facade set click keeps the in-flight App import and paints Pack Ready in-place", () => {
  assert.match(mainSource, /function isPlainPrimaryClick\(event\)/);
  assert.match(mainSource, /!event\.metaKey[\s\S]*!event\.ctrlKey[\s\S]*!event\.shiftKey[\s\S]*!event\.altKey/);
  assert.match(mainSource, /event\.preventDefault\(\);\s*onNavigateSet\(set\)/);
  assert.match(mainSource, /const handleFacadeSetNavigation = \(set\) => \{[\s\S]*history\.pushState[\s\S]*renderInitialProductContent\(activeRoute, handleFacadeSetNavigation, handleFacadeSetOpen, \{ replace: true \}\)[\s\S]*mountDesktopApp\(\)/);
  assert.match(mainSource, /a\.public-snapshot__set-link\[href\^='\/set\/'\]/);
  assert.match(mainSource, /rootElement\.addEventListener\("click", handleBootstrapSetLinkClick\)/);
  assert.match(mainSource, /window\.requestAnimationFrame\(detachBootstrapNavigation\)/);
  assert.equal((mainSource.match(/loadDesktopPage\(\)/g) || []).length, 2, "dev and product branches each start one desktop import");
});

test("Back and Forward remain synchronized before the full desktop app mounts", () => {
  assert.match(mainSource, /const handleBootstrapPopState = \(\) => \{[\s\S]*parseRuntimeSiteRoute\(normalizeEntryPath\(window\.location\.pathname\)\)[\s\S]*renderInitialProductContent\(activeRoute/);
  assert.match(mainSource, /window\.addEventListener\("popstate", handleBootstrapPopState\)/);
  assert.match(mainSource, /window\.removeEventListener\("popstate", handleBootstrapPopState\)/);
});

test("an Open click on bootstrap Pack Ready is queued once instead of reloading the set URL", () => {
  assert.match(mainSource, /<button type="button" onClick=\{\(\) => onOpen\(set\)\}>Click to Open<\/button>/);
  assert.match(mainSource, /a\.public-snapshot__cta\[href\^='\/set\/'\]/);
  assert.match(mainSource, /activeRoute = \{ \.\.\.activeRoute, openOnReady: true \}/);
  assert.match(appSource, /pendingInitialOpenIntentRef = useRef\(Boolean\(isPublicSetRoute && initialRoute\?\.openOnReady\)\)/);
  assert.match(appSource, /pendingInitialOpenIntentRef\.current = false;\s*revealPack\(\)/);
});

test("root HTML records the shell and module-request milestones before JavaScript evaluation", () => {
  const shellMark = indexSource.indexOf('state.htmlShellReady = atMs');
  const requestMark = indexSource.indexOf('state.mainRequestStart = atMs');
  const moduleRequest = indexSource.indexOf('<script type="module" src="/src/main.jsx"></script>');
  assert.ok(shellMark > 0 && shellMark < requestMark);
  assert.ok(requestMark < moduleRequest);
  assert.match(indexSource, /window\.__packdexPerformance\.navigationStart = performance\.timeOrigin/);
  assert.match(mainSource, /recordStartup\("mainEvalStart"\)/);
});

test("landing-only CSS is not requested by desktop product routes", () => {
  const landingSource = fs.readFileSync(new URL("../src/LandingPage.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(mainSource, /import "\.\/landing\.css"/);
  assert.match(landingSource, /import "\.\/landing\.css"/);
});

test("service worker update work waits until after the real React screen commits", () => {
  assert.doesNotMatch(mainSource, /^registerPackDexServiceWorker\(\)/m);
  assert.match(mainSource, /React\.useLayoutEffect[\s\S]*recordStartup\("reactCommit"[\s\S]*schedulePackDexServiceWorker\(\)/);
  assert.match(mainSource, /requestIdleCallback\(register/);
});

test("the selector does not proactively fetch unrelated set logos", () => {
  assert.doesNotMatch(setSelectSource, /preloadStaticOpenPackAssets|immediateLogoLimit|idleLogoLimit/);
  assert.match(setSelectSource, /loading="lazy"/);
});

test("below-fold public set content waits until after Pack Ready can paint", () => {
  assert.match(appSource, /const PublicSetPage = lazy\(loadPublicSetPage\)/);
  assert.match(appSource, /window\.requestAnimationFrame\(\(\) =>[\s\S]*window\.requestAnimationFrame\(startWatching\)/);
  assert.match(appSource, /<DeferredPublicSetPage/);
  assert.ok(appSource.indexOf("<PackOpening") < appSource.indexOf("<DeferredPublicSetPage"));
});

test("intent prefetch is limited to one set's Pack Ready assets", () => {
  assert.match(setSelectSource, /onPointerEnter=\{\(\) => prefetchSet\(set\)\}/);
  assert.match(setSelectSource, /onPointerDown=\{\(\) => prefetchSet\(set\)\}/);
  assert.match(setSelectSource, /onFocus=\{\(\) => prefetchSet\(set\)\}/);
  assert.match(staticAssetsSource, /export function preloadPackReadyAssets\(set\)/);
  assert.match(staticAssetsSource, /getSetLogoUrl\(set\)/);
  assert.match(staticAssetsSource, /getSetPackArtUrl\(set\)/);
  assert.doesNotMatch(staticAssetsSource.slice(staticAssetsSource.indexOf("export function preloadPackReadyAssets")), /set\.cards|cardImage/);
});

test("missing optional pack art falls straight back instead of probing a synthetic remote URL", () => {
  const packArtHelper = assetUrlsSource.slice(assetUrlsSource.indexOf("export function getSetPackArtUrl"), assetUrlsSource.indexOf("export function getSoundUrl"));
  assert.match(packArtHelper, /return ""/);
  assert.doesNotMatch(packArtHelper, /pack\.png/);
  assert.match(setsSource, /packArtPath: metadata\.packArtPath \|\| ""/);
});

test("the shared document does not download the large card back on unrelated routes", () => {
  assert.doesNotMatch(indexSource, /rel="preload"[^>]+card-back\./);
  assert.doesNotMatch(staticAssetsSource.slice(staticAssetsSource.indexOf("export function preloadStaticOpenPackAssets"), staticAssetsSource.indexOf("export function preloadPackReadyAssets")), /CARD_BACK_URL/);
  assert.match(appSource, /if \(!selectedSet \|\| screen !== "opening"\) return;[\s\S]*preloadImage\(CARD_BACK_URL/);
});

test("Pack Ready does not bulk-warm card images before the user opens a pack", () => {
  const openingBranch = appSource.slice(appSource.indexOf('if (screen === "opening")'), appSource.indexOf("clearImageWarmupQueue()", appSource.indexOf('if (screen === "opening")')));
  assert.doesNotMatch(openingBranch, /scheduleSelectedSetImageWarmup/);
  assert.doesNotMatch(appSource, /scheduleSelectedSetImageWarmup/);
});

test("guest-capable selector and Pack Ready rendering do not wait for auth resolution", () => {
  const selectorRender = appSource.slice(
    appSource.indexOf('{!isPublicSetRoute && <div className="desktop-screen-cache"'),
    appSource.indexOf('{activeTab === "open" && screen !== "home"')
  );
  const packReadyRender = appSource.slice(
    appSource.indexOf('{activeTab === "open" && screen !== "home"'),
    appSource.indexOf('{screen === "reveal" && selectedSet')
  );
  assert.match(selectorRender, /<SetSelect/);
  assert.match(packReadyRender, /<PackOpening/);
  assert.doesNotMatch(selectorRender, /isAuthLoading/);
  assert.doesNotMatch(packReadyRender, /isAuthLoading/);
  assert.match(appSource, /useEffect\(\(\) => \{[\s\S]*refreshValidatedAuth\(\)/);
});
