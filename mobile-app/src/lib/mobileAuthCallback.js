import { MobileOnboardingError } from "./mobileOnboardingFinalizer.js";

export function parseMobileAuthCallback(location = globalThis.location) {
  const search = new URLSearchParams(String(location?.search || ""));
  const hash = new URLSearchParams(String(location?.hash || "").replace(/^#/, ""));
  const errorDescription =
    search.get("error_description") ||
    hash.get("error_description") ||
    search.get("error") ||
    hash.get("error") ||
    "";

  return {
    code: search.get("code") || "",
    errorCode: search.get("error_code") || hash.get("error_code") || "",
    errorDescription,
  };
}

export async function establishMobileAuthCallbackSession(client, location = globalThis.location) {
  if (!client?.auth) {
    throw new MobileOnboardingError("PackDex account services are unavailable.", {
      code: "auth_unavailable",
      kind: "invalid_verification_link",
    });
  }

  const callback = parseMobileAuthCallback(location);
  if (callback.errorDescription) {
    throw new MobileOnboardingError(
      "This verification link is invalid or expired. Please request a new email.",
      {
        code: callback.errorCode || "invalid_verification_link",
        kind: "invalid_verification_link",
      }
    );
  }

  if (callback.code) {
    const { error } = await client.auth.exchangeCodeForSession(callback.code);
    if (error) {
      throw new MobileOnboardingError(
        "This verification link is invalid or expired. Please request a new email.",
        {
          code: String(error.code || "verification_exchange_failed"),
          kind: "invalid_verification_link",
          cause: error,
        }
      );
    }
  }

  return callback;
}
