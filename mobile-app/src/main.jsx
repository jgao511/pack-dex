import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Capacitor } from "@capacitor/core";
import MobileBootstrap from "./MobileBootstrap.jsx";
import {
  consumePendingMobileBootstrapSetId,
  consumePendingMobileBootstrapTab,
  consumePendingMobileBootstrapCollectionSetId,
  consumePendingMobileBootstrapOpenRequested,
  consumePendingMobileBootstrapOnboardingAction,
  setPendingMobileBootstrapTab,
} from "./lib/mobileBootstrapIntent.js";
import { getInitialMobileTab } from "./lib/mobileRouting.js";
import { isMobileOnboardingComplete } from "./lib/mobileOnboardingBootstrap.js";
import { normalizeCanonicalProductionLocation } from "../../src/utils/authRedirects.js";
import "./App.css";

const perf = window.__packdexPerformance || (window.__packdexPerformance = {});
perf.mobileMainEvaluated = performance.now();
document.documentElement.dataset.packdexMobileMainEvaluated = String(perf.mobileMainEvaluated);
performance.mark?.("packdex-mobile-main-evaluated");

const isCanonicalRedirecting = normalizeCanonicalProductionLocation();
const isNativePlatform = Capacitor.isNativePlatform();
document.documentElement.classList.toggle("capacitor-native", isNativePlatform);

const normalizedPath = window.location.pathname.replace(/\/+$/, "");
const isResetPasswordRoute = normalizedPath === "/mobile-app/reset-password" || normalizedPath === "/reset-password";
const shareRouteMatch = normalizedPath.match(/^\/mobile-app\/share\/([A-Za-z0-9_-]+)$/);
const scannerTestEnabled = import.meta.env.DEV || __PACKDEX_SCANNER_TEST__;
const isScannerDevRoute = scannerTestEnabled && (normalizedPath === "/mobile-app/dev/card-scanner" ||
  new URLSearchParams(window.location.search).get("scanner-test") === "1"
);

let heavyAppPromise;
let serviceWorkerScheduled = false;

function loadHeavyApp() {
  if (heavyAppPromise) return heavyAppPromise;
  perf.mobileHeavyAppRequestStart = performance.now();
  document.documentElement.dataset.packdexMobileHeavyAppRequestStart = String(perf.mobileHeavyAppRequestStart);
  performance.mark?.("packdex-mobile-heavy-app-request-start");
  heavyAppPromise = import("./App.jsx").then((module) => {
    perf.mobileHeavyAppLoaded = performance.now();
    document.documentElement.dataset.packdexMobileHeavyAppLoaded = String(perf.mobileHeavyAppLoaded);
    performance.mark?.("packdex-mobile-heavy-app-loaded");
    return module.default;
  });
  return heavyAppPromise;
}

function scheduleServiceWorkerRegistration() {
  if (isNativePlatform || serviceWorkerScheduled) return;
  serviceWorkerScheduled = true;
  const run = () => import("../../src/lib/clientUpdate.js")
    .then(({ registerPackDexServiceWorker }) => registerPackDexServiceWorker())
    .catch((error) => {
      if (import.meta.env.DEV) console.warn("Unable to register the PackDex update worker", error);
    });
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 2500 });
  else window.setTimeout(run, 800);
}

function isReturningOrDesktopGuest() {
  const search = new URLSearchParams(window.location.search);
  if (search.get("desktop") === "1") return true;
  if (isMobileOnboardingComplete()) return true;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const mobileHint = Boolean(navigator.userAgentData?.mobile);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches || false;
  return !(mobileUa || mobileHint || coarsePointer || window.innerWidth <= 768);
}

function renderStrict(root, node) {
  root.render(<React.StrictMode>{node}</React.StrictMode>);
}

function MobileStartupError() {
  return (
    <main className="mobile-app theme-dark">
      <section className="phone-shell" aria-label="PackDex mobile app">
        <div className="screen-content mobile-startup-error" role="alert">
          <img src="/packdex-icon-192.png" alt="" />
          <h1>PackDex couldn’t finish loading.</h1>
          <p>Check your connection, then try again.</p>
          <button className="primary-action" type="button" onClick={() => window.location.reload()}>Reload PackDex</button>
        </div>
      </section>
    </main>
  );
}

async function renderRoute(root) {
  if (isScannerDevRoute) {
    const { default: CardScannerDevPage } = await import("./CardScannerDevPage.jsx");
    renderStrict(root, <CardScannerDevPage />);
    return;
  }

  if (shareRouteMatch) {
    const { default: PublicPullSharePage } = await import("./PublicPullSharePage.jsx");
    renderStrict(root, <PublicPullSharePage shareCode={shareRouteMatch[1]} />);
    return;
  }

  if (isResetPasswordRoute) {
    const [{ default: MobileResetPasswordPage }, { supabase }] = await Promise.all([
      import("./MobileResetPasswordPage.jsx"),
      import("./lib/supabaseClient.js"),
    ]);
    renderStrict(root, <MobileResetPasswordPage supabase={supabase} />);
    return;
  }

  const initialTab = getInitialMobileTab();
  const isReturningVisitor = isReturningOrDesktopGuest();
  const bootstrapMode = !isReturningVisitor
    ? "onboarding"
    : initialTab === "open"
      ? "selector"
      : initialTab;
  const requestApp = (tab = "") => {
    if (tab) setPendingMobileBootstrapTab(tab);
    return loadHeavyApp();
  };

  flushSync(() => root.render(
    <MobileBootstrap mode={bootstrapMode} onNeedApp={requestApp} />
  ));

  const App = await requestApp();
  const bootstrapSetId = consumePendingMobileBootstrapSetId();
  const bootstrapTab = consumePendingMobileBootstrapTab();
  const bootstrapCollectionSetId = consumePendingMobileBootstrapCollectionSetId();
  const bootstrapOpenRequested = consumePendingMobileBootstrapOpenRequested();
  const bootstrapOnboardingIntent = consumePendingMobileBootstrapOnboardingAction();
  perf.mobileHeavyAppRenderStart = performance.now();
  document.documentElement.dataset.packdexMobileHeavyAppRenderStart = String(perf.mobileHeavyAppRenderStart);
  performance.mark?.("packdex-mobile-heavy-app-render-start");
  flushSync(() => root.render(
    <React.StrictMode>
      <App
        bootstrapSetId={bootstrapSetId}
        bootstrapTab={bootstrapTab}
        bootstrapCollectionSetId={bootstrapCollectionSetId}
        bootstrapOpenRequested={bootstrapOpenRequested}
        bootstrapOnboardingIntent={bootstrapOnboardingIntent}
      />
    </React.StrictMode>
  ));
}

if (!isCanonicalRedirecting) {
  const root = createRoot(document.getElementById("root"));
  perf.mobileReactRootCreated = performance.now();
  document.documentElement.dataset.packdexMobileReactRootCreated = String(perf.mobileReactRootCreated);
  performance.mark?.("packdex-mobile-react-root-created");

  window.addEventListener("packdex:mobile-real-screen", scheduleServiceWorkerRegistration, { once: true });
  if (isNativePlatform) {
    import("./lib/externalLinks.js").then(({ installNativeExternalLinkRouting }) => installNativeExternalLinkRouting());
  }
  renderRoute(root).catch((error) => {
    console.error("Unable to start PackDex Mobile", error);
    renderStrict(root, <MobileStartupError />);
  });
}
