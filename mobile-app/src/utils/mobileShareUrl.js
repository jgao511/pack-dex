import { buildPublicSiteUrl, PRODUCTION_SITE_URL } from "../../../src/utils/authRedirects.js";

export const PUBLIC_SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

function normalizeWebOrigin(origin) {
  try {
    const parsed = new URL(String(origin || ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : "";
  } catch {
    return "";
  }
}

export function buildMobileShareUrl(result, {
  native = false,
  origin = globalThis.window?.location?.origin,
  publicSiteUrl = PRODUCTION_SITE_URL,
} = {}) {
  const shareCode = typeof result?.share_code === "string" ? result.share_code.trim() : "";

  if (!shareCode || !PUBLIC_SHARE_CODE_PATTERN.test(shareCode)) {
    throw new Error("Unable to create the mobile share link.");
  }

  const webOrigin = normalizeWebOrigin(origin);
  const shareOrigin = native || !webOrigin ? publicSiteUrl : webOrigin;
  return buildPublicSiteUrl(`/mobile-app/share/${encodeURIComponent(shareCode)}`, shareOrigin);
}
