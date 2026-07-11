import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import PublicPullSharePage from "../mobile-app/src/PublicPullSharePage.jsx";
import "./App.css";

const normalizedPath = window.location.pathname.replace(/\/+$/, "");
const shareRouteMatch = normalizedPath.match(/^\/share\/(v\d+\.[A-Za-z0-9_-]+)$/);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {shareRouteMatch ? <PublicPullSharePage token={shareRouteMatch[1]} /> : <App />}
  </React.StrictMode>
);
