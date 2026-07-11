import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import MobileResetPasswordPage from "./MobileResetPasswordPage.jsx";
import PublicPullSharePage from "./PublicPullSharePage.jsx";
import { supabase } from "./lib/supabaseClient.js";
import "./App.css";

const normalizedPath = window.location.pathname.replace(/\/+$/, "");
const isResetPasswordRoute =
  normalizedPath === "/mobile-app/reset-password" || normalizedPath === "/reset-password";
const legacyShareRouteMatch = normalizedPath.match(/^\/mobile-app\/share\/(v\d+\.[A-Za-z0-9_-]+)$/);
const shareRouteMatch = normalizedPath.match(/^\/mobile-app\/share\/([A-Za-z0-9_-]+)$/);
const shortShareRouteMatch = normalizedPath.match(/^\/s\/([A-Za-z0-9_-]{10,12})$/);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {legacyShareRouteMatch ? <PublicPullSharePage token={legacyShareRouteMatch[1]} interfaceMode="mobile" /> : shareRouteMatch ? <PublicPullSharePage shareCode={shareRouteMatch[1]} interfaceMode="mobile" /> : shortShareRouteMatch ? <PublicPullSharePage shareCode={shortShareRouteMatch[1]} interfaceMode="mobile" /> : isResetPasswordRoute ? <MobileResetPasswordPage supabase={supabase} /> : <App />}
  </React.StrictMode>
);
