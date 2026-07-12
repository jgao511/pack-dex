import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.jsx";
import MobileResetPasswordPage from "./MobileResetPasswordPage.jsx";
import PublicPullSharePage from "./PublicPullSharePage.jsx";
import CardScannerDevPage from "./CardScannerDevPage.jsx";
import { supabase } from "./lib/supabaseClient.js";
import "./App.css";

const isNativePlatform = Capacitor.isNativePlatform();
document.documentElement.classList.toggle("capacitor-native", isNativePlatform);

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
const isScannerDevRoute = import.meta.env.DEV && normalizedPath === "/mobile-app/dev/card-scanner";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isScannerDevRoute ? <CardScannerDevPage /> : shareRouteMatch ? <PublicPullSharePage shareCode={shareRouteMatch[1]} /> : isResetPasswordRoute ? <MobileResetPasswordPage supabase={supabase} /> : <App />}
  </React.StrictMode>
);
