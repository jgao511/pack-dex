import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import PublicPullSharePage from "../mobile-app/src/PublicPullSharePage.jsx";
import "./App.css";

const normalizedPath = window.location.pathname.replace(/\/+$/, "");
const shareRouteMatch = normalizedPath.match(/^\/share\/(v\d+\.[A-Za-z0-9_-]+)$/);
const shortShareRouteMatch = normalizedPath.match(/^\/s\/([A-Za-z0-9_-]{10,12})$/);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {shortShareRouteMatch ? <PublicPullSharePage shareCode={shortShareRouteMatch[1]} /> : shareRouteMatch ? <PublicPullSharePage token={shareRouteMatch[1]} /> : <App />}
  </React.StrictMode>
);
