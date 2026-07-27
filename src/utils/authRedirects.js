export const PRODUCTION_SITE_URL = "https://www.pack-dex.com";
export const PUBLIC_SITE_URL = String(
  import.meta.env?.VITE_PUBLIC_SITE_URL || PRODUCTION_SITE_URL
).replace(/\/+$/, "");

export function getSiteOrigin() {
  if (typeof window !== "undefined") {
    const { origin, hostname } = window.location;

    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return origin;
    }
  }

  return PUBLIC_SITE_URL;
}

export function getAuthCallbackUrl() {
  return `${getSiteOrigin()}/auth/callback`;
}

export function getResetPasswordUrl() {
  return `${getSiteOrigin()}/reset-password`;
}

export function getMobileAuthCallbackUrl() {
  return `${getSiteOrigin()}/mobile-app/auth/callback`;
}

export function getMobileResetPasswordUrl() {
  return `${getSiteOrigin()}/mobile-app/reset-password`;
}

export function normalizeCanonicalProductionLocation(location = globalThis.location) {
  if (!location || location.protocol !== "https:" || location.hostname !== "pack-dex.com") {
    return false;
  }

  const canonicalUrl = new URL(location.href);
  canonicalUrl.hostname = "www.pack-dex.com";
  location.replace(canonicalUrl.toString());
  return true;
}
