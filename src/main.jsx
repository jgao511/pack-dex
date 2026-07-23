import React from "react";
import ReactDOM from "react-dom/client";
import "./base.css";
import "./landing.css";
import { loadDesktopPage, loadWelcomePage } from "./pageLoaders.js";
import {
  getWelcomeEntryDecision,
  isLikelyMobileVisitor,
  markWelcomeSeen,
  normalizeEntryPath,
} from "./welcomeEntry.js";

const pathname = window.location.pathname || "/";
const normalizedPath = normalizeEntryPath(pathname);
const isMobileVisitor = isLikelyMobileVisitor({
  userAgent: window.navigator.userAgent,
  userAgentMobile: window.navigator.userAgentData?.mobile,
  coarsePointer: window.matchMedia?.("(pointer: coarse)")?.matches,
  viewportWidth: window.innerWidth,
});
const entryDecision = getWelcomeEntryDecision({
  pathname,
  search: window.location.search,
  isMobile: isMobileVisitor,
  storageHost: window,
});

if (normalizedPath === "/" && new URLSearchParams(window.location.search).get("desktop") === "1") {
  markWelcomeSeen(window);
  window.history.replaceState(window.history.state, "", "/");
}

if (entryDecision === "mobile-app") {
  window.location.replace("/mobile-app/");
} else {
  const renderPage = ({ default: Page }) => {
    ReactDOM.createRoot(document.getElementById("root")).render(
      <React.StrictMode>
        <Page isMobileVisitor={isMobileVisitor} />
      </React.StrictMode>
    );
  };

  if (entryDecision === "welcome") {
    loadWelcomePage().then(renderPage);
  } else {
    loadDesktopPage().then(renderPage);
  }
}
