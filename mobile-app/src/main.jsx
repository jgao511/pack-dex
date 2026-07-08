import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import MobileResetPasswordPage from "./MobileResetPasswordPage.jsx";
import { supabase } from "./lib/supabaseClient.js";
import "./App.css";

const normalizedPath = window.location.pathname.replace(/\/+$/, "");
const isResetPasswordRoute =
  normalizedPath === "/mobile-app/reset-password" || normalizedPath === "/reset-password";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isResetPasswordRoute ? <MobileResetPasswordPage supabase={supabase} /> : <App />}
  </React.StrictMode>
);
