import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import MobileResetPasswordPage from "./MobileResetPasswordPage.jsx";
import { supabase } from "./lib/supabaseClient.js";
import "./App.css";

const isResetPasswordRoute =
  window.location.pathname === "/mobile-app/reset-password" ||
  window.location.pathname.endsWith("/mobile-app/reset-password");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isResetPasswordRoute ? <MobileResetPasswordPage supabase={supabase} /> : <App />}
  </React.StrictMode>
);
