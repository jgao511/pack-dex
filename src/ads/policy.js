import { AD_PLACEMENTS } from "./config.js";

export const AD_ELIGIBLE_PUBLIC_ROUTES = Object.freeze([
  "/",
  "/welcome",
  "/sets",
  "/set/:slug",
  "/how-it-works",
  "/faq",
  "/about",
]);

const STATIC_ROUTE_KINDS = Object.freeze({
  "/": "home",
  "/welcome": "welcome",
  "/sets": "sets",
  "/how-it-works": "how-it-works",
  "/faq": "faq",
  "/about": "about",
});

const BLOCKED_SCREEN_PATTERN =
  /(?:^|[-_ ])(?:auth|callback|confirm|confirmation|email-confirmation|error|loading|login|logout|onboarding|password|permission|profile|redirect|reset|settings|signup|sign-up|welcome-reward)(?:$|[-_ ])/i;
const INTERACTION_SCREEN_PATTERN =
  /(?:pack[-_ ]?(?:open|opening|reveal|summary)|pull[-_ ]?summary|card[-_ ]?reveal|tap[-_ ]?reveal|swipe[-_ ]?reveal)/i;

function normalizeStateName(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export function normalizeAdPathname(value) {
  const rawValue = String(value ?? "/").trim() || "/";
  let pathname = rawValue;

  try {
    pathname = new URL(rawValue, "https://packdex.invalid").pathname;
  } catch {
    pathname = rawValue.split(/[?#]/, 1)[0] || "/";
  }

  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}

export function classifyAdRoute(pathname) {
  const normalizedPath = normalizeAdPathname(pathname);
  const staticKind = STATIC_ROUTE_KINDS[normalizedPath];

  if (staticKind) {
    return Object.freeze({ eligible: true, kind: staticKind, pathname: normalizedPath, slug: "" });
  }

  const setMatch = normalizedPath.match(/^\/set\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (setMatch) {
    return Object.freeze({
      eligible: true,
      kind: "set",
      pathname: normalizedPath,
      slug: setMatch[1],
    });
  }

  return Object.freeze({ eligible: false, kind: "utility", pathname: normalizedPath, slug: "" });
}

function isExplicitlyBlocked(context) {
  return Boolean(
    context.disabled ||
      context.isLoading ||
      context.hasError ||
      context.isError ||
      context.isNotFound ||
      context.isAuthScreen ||
      context.isAccountScreen ||
      context.isOnboarding ||
      context.isRedirecting ||
      context.isNavigationOnly ||
      context.isEmptyState ||
      context.isPermissionDialog
  );
}

function isNativeContext(context) {
  const runtime = normalizeStateName(context.runtime);
  return Boolean(
    context.isNative ||
      context.isNativePlatform ||
      ["native", "capacitor", "android-native", "ios-native"].includes(runtime)
  );
}

function isUnsafeInteraction(context) {
  const screen = normalizeStateName(context.screen ?? context.view ?? context.appState);
  const interaction = normalizeStateName(context.interaction);
  const isInteractionScreen =
    context.isPackReveal ||
    context.isPackSummary ||
    context.isFullscreenInteraction ||
    INTERACTION_SCREEN_PATTERN.test(screen) ||
    INTERACTION_SCREEN_PATTERN.test(interaction);

  if (!isInteractionScreen) return false;

  const viewportWidth = Number(context.viewportWidth);
  const isMobile =
    context.isMobile === true ||
    context.isTouchFocused === true ||
    (Number.isFinite(viewportWidth) && viewportWidth < 768) ||
    /mobile/i.test(screen) ||
    /mobile/i.test(interaction);

  if (isMobile) return true;

  return !(
    context.allowDesktopRailDuringInteraction === true &&
    context.placement === AD_PLACEMENTS.SET_RAIL &&
    Number.isFinite(viewportWidth) &&
    viewportWidth >= 1280
  );
}

export function getAdEligibility(context = {}) {
  const route = classifyAdRoute(context.canonicalPath || context.pathname || "/");

  if (isNativeContext(context)) return Object.freeze({ eligible: false, reason: "native-runtime", route });
  if (!route.eligible) return Object.freeze({ eligible: false, reason: "ineligible-route", route });
  if (context.contentReady !== true) {
    return Object.freeze({ eligible: false, reason: "content-not-ready", route });
  }
  if (isExplicitlyBlocked(context)) {
    return Object.freeze({ eligible: false, reason: "blocked-state", route });
  }

  const screen = normalizeStateName(context.screen ?? context.view ?? context.appState);
  if (BLOCKED_SCREEN_PATTERN.test(screen)) {
    return Object.freeze({ eligible: false, reason: "blocked-screen", route });
  }
  if (isUnsafeInteraction(context)) {
    return Object.freeze({ eligible: false, reason: "unsafe-interaction", route });
  }
  const consentStatus = normalizeStateName(context.consentStatus);
  if (consentStatus === "pending" || consentStatus === "denied") {
    return Object.freeze({ eligible: false, reason: "consent-unavailable", route });
  }

  return Object.freeze({ eligible: true, reason: "eligible", route });
}

export function isAdEligibleContext(context = {}) {
  return getAdEligibility(context).eligible;
}
