import React from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import "./base.css";
import { loadWelcomePage } from "./pageLoaders.js";
import {
  getWelcomeEntryDecision,
  isLikelyCrawlerVisitor,
  isLikelyMobileVisitor,
  markWelcomeSeen,
  normalizeEntryPath,
} from "./welcomeEntry.js";
import { registerPackDexServiceWorker } from "./lib/clientUpdate.js";
import {
  isEditorialPublicPath,
  parseStaticSiteRoute,
} from "./lib/staticPublicRoutes.js";
import { parseRuntimeSiteRoute } from "./lib/runtimeRoutes.js";
import { setCatalogMetadata } from "./lib/setRouteCatalog.js";
import { getPokeballLoadingUrl } from "./utils/assetUrls.js";

const loadDesktopPage = () => import("./App.jsx");
const startupNow = () => Number(performance.now().toFixed(1));
const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();
const recordStartup = (name, detail = {}) => {
  const timeline = window.__packdexPerformance?.timeline || [];
  const entry = { name, atMs: startupNow(), ...detail };
  window.__packdexPerformance = { ...(window.__packdexPerformance || {}), timeline: [...timeline, entry], [name]: entry.atMs };
  performance.mark?.(`packdex-${name}`);
};

recordStartup("mainEvalStart");

let serviceWorkerScheduled = false;
function schedulePackDexServiceWorker() {
  if (serviceWorkerScheduled) return;
  serviceWorkerScheduled = true;
  const register = () => registerPackDexServiceWorker().catch((error) => {
    if (import.meta.env.DEV) console.warn("Unable to register the PackDex update worker", error);
  });
  const afterPaint = () => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(register, { timeout: 2000 });
    else window.setTimeout(register, 0);
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(afterPaint));
}

const pathname = window.location.pathname || "/";
const normalizedPath = normalizeEntryPath(pathname);
const userAgent = window.navigator.userAgent;
const isMobileVisitor = !isLikelyCrawlerVisitor({ userAgent }) && isLikelyMobileVisitor({
  userAgent,
  userAgentMobile: window.navigator.userAgentData?.mobile,
  coarsePointer: window.matchMedia?.("(pointer: coarse)")?.matches,
  viewportWidth: window.innerWidth,
});
const entryDecision = getWelcomeEntryDecision({
  pathname,
  search: window.location.search,
  isMobile: isMobileVisitor,
});
const isMobileAppEntry = entryDecision === "mobile-app";
const isPublicLanding = entryDecision === "welcome";
const rootElement = document.getElementById("root");
let reactRoot = null;

if (normalizedPath === "/" && new URLSearchParams(window.location.search).get("desktop") === "1") {
  markWelcomeSeen(window);
}

function StartupCommitMarker({ screen }) {
  React.useLayoutEffect(() => {
    recordStartup("reactCommit", { screen });
    schedulePackDexServiceWorker();
  }, [screen]);
  return null;
}

const renderPage = ({ Page, props = {}, screen = "product" }) => {
    reactRoot ||= ReactDOM.createRoot(rootElement);
    recordStartup("reactRenderRequested", { screen });
    reactRoot.render(
      <React.StrictMode>
        <StartupCommitMarker screen={screen} />
        <Page isMobileVisitor={isMobileVisitor} {...props} />
      </React.StrictMode>
    );
};

function isPlainPrimaryClick(event) {
  return !event.defaultPrevented
    && event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey;
}

function ProductCatalogFacade({ onNavigateSet }) {
  const groups = new Map();
  for (const set of setCatalogMetadata) {
    if (!groups.has(set.era)) groups.set(set.era, []);
    groups.get(set.era).push(set);
  }
  const orderedGroups = [...groups.entries()]
    .map(([era, sets]) => [era, [...sets].sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")))])
    .sort(([, a], [, b]) => String(b[0]?.releaseDate || "").localeCompare(String(a[0]?.releaseDate || "")));

  return (
    <main className="product-catalog-facade" data-packdex-real-content="sets">
      <header className="product-boot-header">
        <img src="/packdex-icon-192.png" alt="" />
        <strong><span>Pack</span><b>Dex</b></strong>
      </header>
      <section className="product-catalog-facade__content">
        <span className="product-boot-label">Open a Pack</span>
        <h1>Choose a Pokémon TCG Set</h1>
        {orderedGroups.map(([era, sets]) => (
          <section className="product-catalog-facade__era" key={era}>
            <h2>{era} Era</h2>
            <div className="product-catalog-facade__grid">
              {sets.map((set) => (
                <a
                  href={set.path}
                  key={set.id}
                  aria-label={`Open ${set.name} pack`}
                  onClick={(event) => {
                    if (!isPlainPrimaryClick(event)) return;
                    event.preventDefault();
                    onNavigateSet(set);
                  }}
                >
                  <img src={`/set-logos/${set.setFolder}.png`} alt={`${set.name} logo`} loading="lazy" decoding="async" />
                  <strong>{set.name}</strong>
                  <span className="product-catalog-facade__progress-placeholder" aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}

function ProductSetFacade({ set, onOpen }) {
  return (
    <main className="product-set-facade" data-packdex-real-content="pack-ready">
      <header className="product-boot-header">
        <img src="/packdex-icon-192.png" alt="" />
        <strong><span>Pack</span><b>Dex</b></strong>
      </header>
      <section className="product-set-facade__stage">
        <span className="product-boot-label">Pack Ready</span>
        <img className="product-set-facade__logo" src={`/set-logos/${set.setFolder}.png`} alt={`${set.name} logo`} />
        <div className="product-set-facade__cards" aria-label={`${set.name} booster pack`}>
          <img src="/card-back.webp" alt="" />
          <img src="/card-back.webp" alt="" />
        </div>
        <div className="product-set-facade__actions">
          <a href="/sets">Back to Sets</a>
          <a href={`/collection?set=${encodeURIComponent(set.id)}`}>Collection</a>
          <button type="button" onClick={() => onOpen(set)}>Click to Open</button>
        </div>
      </section>
    </main>
  );
}

function DelayedDesktopLoadingFallback() {
  return (
    <main className="loading-overlay startup-loading-overlay" role="status" aria-live="polite" aria-label="Loading PackDex">
      <img className="loading-pokeball" src={POKEBALL_LOADING_SRC} alt="" />
      <span className="loading-text">Loading PackDex</span>
    </main>
  );
}

function DesktopStartupError() {
  return (
    <main className="startup-error" role="alert">
      <img src="/packdex-icon-192.png" alt="" />
      <h1>PackDex couldn’t finish loading.</h1>
      <p>Check your connection, then try again.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload PackDex</button>
    </main>
  );
}

function renderDelayedDesktopFallback() {
  const hasVisibleContent = rootElement.childElementCount > 0 || rootElement.textContent.trim();
  if (hasVisibleContent) return;
  reactRoot ||= ReactDOM.createRoot(rootElement);
  reactRoot.render(<DelayedDesktopLoadingFallback />);
}

function renderDesktopStartupError(error) {
  console.error("Unable to start PackDex", error);
  reactRoot ||= ReactDOM.createRoot(rootElement);
  reactRoot.render(<DesktopStartupError />);
}

function renderInitialProductContent(route, onNavigateSet = () => {}, onOpenSet = () => {}, { replace = false } = {}) {
  performance.mark?.("packdex-product-bootstrap-start");
  const hasSnapshot = rootElement.childElementCount > 0 || rootElement.textContent.trim();
  recordStartup("initialContentChecked", { hasSnapshot: Boolean(hasSnapshot), route: route?.kind || "unknown" });
  if (hasSnapshot && !replace) return;
  reactRoot ||= ReactDOM.createRoot(rootElement);
  flushSync(() => {
    if (route?.kind === "public" && route.page === "sets") reactRoot.render(<ProductCatalogFacade onNavigateSet={onNavigateSet} />);
    else if (route?.kind === "set" && route.set) reactRoot.render(<ProductSetFacade set={route.set} onOpen={onOpenSet} />);
    else reactRoot.render(<DelayedDesktopLoadingFallback />);
  });
  recordStartup("initialRealContentRendered", { screen: route?.kind === "set" ? "pack-ready" : route?.page || "shell" });
}

if (isMobileAppEntry) {
  window.location.replace("/mobile-app/");
} else if (isPublicLanding) {
  renderDelayedDesktopFallback();
  recordStartup("pageModuleImportStart", { screen: "welcome" });
  loadWelcomePage().then(({ default: Page }) => {
    recordStartup("pageModuleImportEnd", { screen: "welcome" });
    renderPage({ Page, screen: "welcome" });
  }).catch(renderDesktopStartupError);
} else if (import.meta.env.DEV && normalizedPath === "/dev/god-pack-animation") {
  renderDelayedDesktopFallback();
  recordStartup("appModuleImportStart", { screen: "devPreview" });
  loadDesktopPage().then(({ default: Page }) => {
    recordStartup("appModuleImportEnd", { screen: "devPreview" });
    renderPage({ Page, props: { route: { kind: "utility", page: "devPreview" } }, screen: "devPreview" });
  }).catch(renderDesktopStartupError);
} else if (isEditorialPublicPath(normalizedPath)) {
  renderDelayedDesktopFallback();
  recordStartup("pageModuleImportStart", { screen: "editorial" });
  import("./PublicPages.jsx").then(({ default: Page }) => {
    recordStartup("pageModuleImportEnd", { screen: "editorial" });
    const route = parseStaticSiteRoute(normalizedPath);
    renderPage({ Page, props: { pathname: normalizedPath, page: route.page }, screen: route.page });
  }).catch(renderDesktopStartupError);
} else {
  recordStartup("routeResolutionStart");
  const route = parseRuntimeSiteRoute(normalizedPath);
  recordStartup("routeResolutionEnd", { route: route.kind, page: route.page || null });
  let activeRoute = route;
  let desktopModule = null;
  let desktopModuleReady = false;
  let detachBootstrapNavigation = () => {};
  const mountDesktopApp = () => {
    if (!desktopModuleReady || !desktopModule || activeRoute.kind === "not-found") return;
    const { default: Page } = desktopModule;
    renderPage({ Page, props: { route: activeRoute }, screen: activeRoute.page || activeRoute.kind });
    window.requestAnimationFrame(detachBootstrapNavigation);
  };
  const handleFacadeSetOpen = (set) => {
    if (activeRoute.kind !== "set" || String(activeRoute.setId || activeRoute.set?.id) !== String(set.id)) return;
    activeRoute = { ...activeRoute, openOnReady: true };
    recordStartup("facadeOpenQueued", { setId: set.id });
    mountDesktopApp();
  };
  const handleFacadeSetNavigation = (set) => {
    activeRoute = parseRuntimeSiteRoute(set.path);
    window.history.pushState({ packdexApp: true, activeTab: "open", screen: "opening", selectedSetId: set.id }, "", set.path);
    recordStartup("facadeSetNavigation", { setId: set.id });
    renderInitialProductContent(activeRoute, handleFacadeSetNavigation, handleFacadeSetOpen, { replace: true });
    mountDesktopApp();
  };
  const handleBootstrapSetLinkClick = (event) => {
    if (!isPlainPrimaryClick(event)) return;
    const link = event.target instanceof Element
      ? event.target.closest("a.public-snapshot__set-link[href^='/set/'], a.public-snapshot__cta[href^='/set/']")
      : null;
    if (!link || !rootElement.contains(link)) return;
    const nextUrl = new URL(link.href, window.location.href);
    if (nextUrl.origin !== window.location.origin) return;
    const nextRoute = parseRuntimeSiteRoute(nextUrl.pathname);
    if (nextRoute.kind !== "set" || !nextRoute.set) return;
    event.preventDefault();
    if (link.classList.contains("public-snapshot__cta") && activeRoute.kind === "set") {
      handleFacadeSetOpen(nextRoute.set);
      return;
    }
    handleFacadeSetNavigation(nextRoute.set);
  };
  const handleBootstrapPopState = () => {
    activeRoute = parseRuntimeSiteRoute(normalizeEntryPath(window.location.pathname));
    recordStartup("bootstrapPopState", { route: activeRoute.kind, page: activeRoute.page || null });
    renderInitialProductContent(activeRoute, handleFacadeSetNavigation, handleFacadeSetOpen, { replace: true });
    mountDesktopApp();
  };
  rootElement.addEventListener("click", handleBootstrapSetLinkClick);
  window.addEventListener("popstate", handleBootstrapPopState);
  detachBootstrapNavigation = () => {
    rootElement.removeEventListener("click", handleBootstrapSetLinkClick);
    window.removeEventListener("popstate", handleBootstrapPopState);
  };
  renderInitialProductContent(route, handleFacadeSetNavigation, handleFacadeSetOpen);
  recordStartup("appModuleImportStart", { screen: route.page || route.kind });
  loadDesktopPage().then(async (appModule) => {
    desktopModule = appModule;
    desktopModuleReady = true;
    recordStartup("appModuleImportEnd", { screen: activeRoute.page || activeRoute.kind });

    if (activeRoute.kind === "not-found") {
      detachBootstrapNavigation();
      const { default: Page } = await import("./PublicPages.jsx");
      renderPage({ Page, props: { pathname: normalizedPath, page: "notFound" }, screen: "notFound" });
      return;
    }

    if (activeRoute.kind === "set" && activeRoute.isAlias && activeRoute.canonicalPath) {
      window.history.replaceState(window.history.state, "", activeRoute.canonicalPath);
    }

    mountDesktopApp();
  }).catch(renderDesktopStartupError);
}
