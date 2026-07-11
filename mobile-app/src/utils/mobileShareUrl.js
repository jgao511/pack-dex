export const PUBLIC_SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export function buildMobileShareUrl(result, origin = globalThis.window?.location?.origin) {
  const shareCode = typeof result?.share_code === "string" ? result.share_code.trim() : "";
  const normalizedOrigin = typeof origin === "string" ? origin.trim().replace(/\/+$/, "") : "";

  if (!shareCode || !PUBLIC_SHARE_CODE_PATTERN.test(shareCode) || !normalizedOrigin) {
    throw new Error("Unable to create the mobile share link.");
  }

  return `${normalizedOrigin}/mobile-app/share/${encodeURIComponent(shareCode)}`;
}
