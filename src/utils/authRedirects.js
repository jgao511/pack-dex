export const PRODUCTION_SITE_URL = "https://www.pack-dex.com";
export const PUBLIC_SITE_URL = String(
  import.meta.env?.VITE_PUBLIC_SITE_URL || PRODUCTION_SITE_URL
).replace(/\/+$/, "");

export function buildPublicSiteUrl(pathname = "/", origin = PUBLIC_SITE_URL) {
  const normalizedPath = String(pathname || "/");
  if (!normalizedPath.startsWith("/") || normalizedPath.startsWith("//")) {
    throw new Error("Public PackDex URLs require a root-relative path.");
  }
  return `${String(origin || PUBLIC_SITE_URL).replace(/\/+$/, "")}${normalizedPath}`;
}

export function getSiteOrigin(location = globalThis.window?.location) {
  if (location) {
    const { origin, hostname, protocol } = location;

    if (
      (protocol === "http:" || protocol === "https:") &&
      (hostname === "localhost" || hostname === "127.0.0.1")
    ) {
      return origin;
    }
  }

  return PUBLIC_SITE_URL;
}

export function getAuthCallbackUrl() {
  return buildPublicSiteUrl("/auth/callback");
}

export function getResetPasswordUrl() {
  return `${getSiteOrigin()}/reset-password`;
}

export function getMobileAuthCallbackUrl() {
  return getAuthCallbackUrl();
}

export function getMobileResetPasswordUrl({
  native = false,
  location = globalThis.window?.location,
} = {}) {
  const origin = native ? PRODUCTION_SITE_URL : getSiteOrigin(location);
  return buildPublicSiteUrl("/mobile-app/reset-password", origin);
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
