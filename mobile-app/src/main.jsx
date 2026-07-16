import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.jsx";
import MobileResetPasswordPage from "./MobileResetPasswordPage.jsx";
import PublicPullSharePage from "./PublicPullSharePage.jsx";
import { supabase } from "./lib/supabaseClient.js";
import { installIosExternalLinkRouting } from "./lib/externalLinks.js";
import "./App.css";

const isNativePlatform = Capacitor.isNativePlatform();
document.documentElement.classList.toggle("capacitor-native", isNativePlatform);
installIosExternalLinkRouting();

if (import.meta.env.DEV) {
  const viewport = window.visualViewport;
  console.info("[PackDex mobile viewport]", {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    visualViewportWidth: viewport?.width ?? null,
    visualViewportHeight: viewport?.height ?? null,
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    isNativePlatform,
  });
}

const normalizedPath = window.location.pathname.replace(/\/+$/, "");
const isResetPasswordRoute =
  normalizedPath === "/mobile-app/reset-password" || normalizedPath === "/reset-password";
const shareRouteMatch = normalizedPath.match(/^\/mobile-app\/share\/([A-Za-z0-9_-]+)$/);
const scannerTestEnabled = import.meta.env.DEV || __PACKDEX_SCANNER_TEST__;
const isScannerDevRoute = scannerTestEnabled && (normalizedPath === "/mobile-app/dev/card-scanner" || new URLSearchParams(window.location.search).get("scanner-test") === "1");
const CardScannerDevPage = scannerTestEnabled ? React.lazy(() => import("./CardScannerDevPage.jsx")) : null;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isScannerDevRoute && CardScannerDevPage ? <React.Suspense fallback={null}><CardScannerDevPage /></React.Suspense> : shareRouteMatch ? <PublicPullSharePage shareCode={shareRouteMatch[1]} /> : isResetPasswordRoute ? <MobileResetPasswordPage supabase={supabase} /> : <App />}
  </React.StrictMode>
);
