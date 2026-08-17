const SUPPORTED_EMAIL_OTP_TYPES = new Set(["email", "signup"]);

export function parseEmailConfirmation(location = globalThis.location) {
  const search = new URLSearchParams(String(location?.search || ""));
  const hash = new URLSearchParams(String(location?.hash || "").replace(/^#/, ""));

  return {
    tokenHash: search.get("token_hash") || "",
    type: SUPPORTED_EMAIL_OTP_TYPES.has(search.get("type")) ? search.get("type") : "email",
    code: search.get("code") || "",
    errorDescription:
      search.get("error_description") ||
      hash.get("error_description") ||
      search.get("error") ||
      hash.get("error") ||
      "",
  };
}

export async function confirmEmailAndSignOut(client, location = globalThis.location) {
  if (!client?.auth) throw new Error("PackDex account services are unavailable.");

  const callback = parseEmailConfirmation(location);
  if (callback.errorDescription) {
    throw new Error("This verification link is invalid or expired. Please request a new email.");
  }

  let session = null;
  let user = null;

  if (callback.tokenHash) {
    const { data, error } = await client.auth.verifyOtp({
      token_hash: callback.tokenHash,
      type: callback.type,
    });
    if (error) throw error;
    session = data?.session || null;
    user = data?.user || session?.user || null;
  } else if (callback.code) {
    const { data, error } = await client.auth.exchangeCodeForSession(callback.code);
    if (error) throw error;
    session = data?.session || null;
    user = data?.user || session?.user || null;
  } else {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data?.session || null;
    user = session?.user || null;
  }

  if (!session || !user) throw new Error("Confirmation link is missing or has expired.");

  const { error: signOutError } = await client.auth.signOut({ scope: "local" });
  if (signOutError) throw signOutError;

  return { user, method: callback.tokenHash ? "token_hash" : callback.code ? "code" : "session" };
}
