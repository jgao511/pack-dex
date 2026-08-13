import React, { useEffect, useRef, useState } from "react";
import {
  AD_PLACEMENTS,
  adsenseConfig,
  getAdSlotId,
  isPlacementViewportEligible,
  normalizeAdSlotId,
} from "./config.js";
import { getAdEligibility } from "./policy.js";
import { loadAdSenseForContext, requestAdSenseSlot } from "./loader.js";
import "./AdSlot.css";

function getViewportWidth(windowRef) {
  const width = Number(windowRef?.innerWidth);
  return Number.isFinite(width) ? width : Number.NaN;
}

function useViewportWidth(windowRef) {
  const [viewportWidth, setViewportWidth] = useState(() => getViewportWidth(windowRef));

  useEffect(() => {
    if (!windowRef?.addEventListener) return undefined;

    const handleResize = () => setViewportWidth(getViewportWidth(windowRef));
    handleResize();
    windowRef.addEventListener("resize", handleResize, { passive: true });
    return () => windowRef.removeEventListener("resize", handleResize);
  }, [windowRef]);

  return viewportWidth;
}

/**
 * A controlled browser AdSense placement.
 *
 * Callers must identify a known placement and explicitly mark substantive page
 * content ready. Native Capacitor callers must pass `isNative={true}`. Unsafe
 * transient states should be passed through `context` (for example
 * `{ contentReady: true, isPackReveal: true, isMobile: true }`).
 */
export default function AdSlot({
  placement = AD_PLACEMENTS.CONTENT,
  slotId,
  pathname,
  context = {},
  isNative = false,
  className = "",
  style,
  format = "auto",
  fullWidthResponsive = true,
  showDevelopmentPlaceholder = true,
  developmentLabel = "Ad placement",
  minViewportWidth,
  maxViewportWidth,
  config = adsenseConfig,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
}) {
  const insRef = useRef(null);
  const viewportWidth = useViewportWidth(windowRef);
  const [phase, setPhase] = useState("idle");
  const resolvedSlotId = normalizeAdSlotId(slotId) || getAdSlotId(config, placement);
  const resolvedPathname = pathname || windowRef?.location?.pathname || "/";
  const policyContext = {
    ...context,
    pathname: resolvedPathname,
    isNative,
    placement,
    viewportWidth,
  };
  const policyFingerprint = JSON.stringify(policyContext);
  const eligibility = getAdEligibility(policyContext);
  const viewportEligible = isPlacementViewportEligible(placement, viewportWidth);
  const instanceViewportEligible =
    (!Number.isFinite(minViewportWidth) || viewportWidth >= minViewportWidth) &&
    (!Number.isFinite(maxViewportWidth) || viewportWidth <= maxViewportWidth);
  const contextEligible =
    eligibility.eligible && viewportEligible && instanceViewportEligible && config?.enabled !== false;
  const isDevelopmentPlaceholder =
    contextEligible &&
    config?.isDevelopment === true &&
    config?.allowRequestsInDevelopment !== true &&
    showDevelopmentPlaceholder;

  useEffect(() => {
    if (!contextEligible || isDevelopmentPlaceholder || !resolvedSlotId) {
      setPhase("idle");
      return undefined;
    }

    let cancelled = false;
    setPhase("loading");

    loadAdSenseForContext({
      context: policyContext,
      config,
      placement,
      slotId: resolvedSlotId,
      documentRef,
      windowRef,
    })
      .then((loaded) => {
        if (cancelled) return;
        const element = insRef.current;
        if (!loaded || !element) {
          setPhase("unavailable");
          return;
        }

        const wasInitialized =
          element.dataset?.packdexAdInitialized === "true" &&
          element.dataset?.packdexAdFailed !== "true";
        const requested = requestAdSenseSlot(element, windowRef);
        setPhase(requested || wasInitialized ? "requested" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setPhase("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [
    config,
    contextEligible,
    documentRef,
    isDevelopmentPlaceholder,
    placement,
    policyFingerprint,
    resolvedSlotId,
    windowRef,
  ]);

  useEffect(() => {
    const element = insRef.current;
    const MutationObserverImpl = windowRef?.MutationObserver;
    if (!element || !MutationObserverImpl || phase !== "requested") return undefined;

    const updateFillState = () => {
      if (element.getAttribute("data-ad-status") === "unfilled") setPhase("unfilled");
    };
    const observer = new MutationObserverImpl(updateFillState);
    observer.observe(element, { attributes: true, attributeFilter: ["data-ad-status"] });
    updateFillState();
    return () => observer.disconnect();
  }, [phase, windowRef]);

  if (!contextEligible) return null;

  if (isDevelopmentPlaceholder) {
    return (
      <div
        className={`packdex-ad-slot packdex-ad-slot--development ${className}`.trim()}
        data-ad-placement={placement}
        role="note"
        style={style}
      >
        <span>{developmentLabel}</span>
      </div>
    );
  }

  if (!resolvedSlotId || phase === "unavailable" || phase === "unfilled") return null;

  return (
    <aside
      aria-label="Advertisement"
      className={`packdex-ad-slot packdex-ad-slot--${phase} ${className}`.trim()}
      data-ad-placement={placement}
      style={style}
    >
      <ins
        key={`${config.client}:${resolvedSlotId}`}
        ref={insRef}
        className="adsbygoogle"
        data-ad-client={config.client}
        data-ad-slot={resolvedSlotId}
        data-ad-format={format}
        data-full-width-responsive={fullWidthResponsive ? "true" : "false"}
      />
    </aside>
  );
}
