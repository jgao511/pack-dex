import { isNativeRuntime } from "./platform.js";

export const SHARE_RESULT = Object.freeze({
  shared: "shared",
  cancelled: "cancelled",
  unavailable: "unavailable",
});

export function isShareCancellation(error) {
  return error?.name === "AbortError" || /cancel(?:led|ed)?/i.test(String(error?.message || ""));
}

async function openNativeShareSheet(shareData) {
  const { Share } = await import("@capacitor/share");
  await Share.share(shareData);
}

export async function presentPullShare(shareData, {
  native = isNativeRuntime(),
  nativeShare = openNativeShareSheet,
  webShare = globalThis.navigator?.share?.bind(globalThis.navigator),
} = {}) {
  const share = native ? nativeShare : webShare;
  if (typeof share !== "function") return SHARE_RESULT.unavailable;

  try {
    await share(shareData);
    return SHARE_RESULT.shared;
  } catch (error) {
    if (isShareCancellation(error)) return SHARE_RESULT.cancelled;
    return SHARE_RESULT.unavailable;
  }
}
