const PRODUCTION_SITE_URL = "https://www.pack-dex.com";

export function getSiteOrigin() {
  if (typeof window !== "undefined") {
    const { origin, hostname } = window.location;

    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return origin;
    }
  }

  return String(import.meta.env.VITE_SITE_URL || PRODUCTION_SITE_URL).replace(/\/+$/, "");
}

export function getAuthCallbackUrl() {
  return `${getSiteOrigin()}/auth/callback`;
}

export function getResetPasswordUrl() {
  return `${getSiteOrigin()}/reset-password`;
}
