import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import PublicPullSharePage from "../mobile-app/src/PublicPullSharePage.jsx";
import "./App.css";

const normalizedPath = window.location.pathname.replace(/\/+$/, "");
const legacyShareRouteMatch = normalizedPath.match(/^\/share\/(v\d+\.[A-Za-z0-9_-]+)$/);
const shareRouteMatch = normalizedPath.match(/^\/share\/([A-Za-z0-9_-]+)$/);
const shortShareRouteMatch = normalizedPath.match(/^\/s\/([A-Za-z0-9_-]{10,12})$/);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {legacyShareRouteMatch ? <PublicPullSharePage token={legacyShareRouteMatch[1]} interfaceMode="desktop" /> : shareRouteMatch ? <PublicPullSharePage shareCode={shareRouteMatch[1]} interfaceMode="desktop" /> : shortShareRouteMatch ? <PublicPullSharePage shareCode={shortShareRouteMatch[1]} interfaceMode="desktop" /> : <App />}
  </React.StrictMode>
);
