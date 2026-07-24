import { clearCachedSupabaseUser, getCachedSupabaseUser } from "./sessionUserCache.js";

const REJECTED_AUTH_CODES = new Set([
  "auth_session_missing",
  "bad_jwt",
  "invalid_jwt",
  "refresh_token_already_used",
  "refresh_token_not_found",
  "session_not_found",
  "user_not_found",
]);

function getDefaultStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function getSupabaseAuthStorageKey(client) {
  const configuredKey = String(client?.auth?.storageKey || "").trim();
  if (configuredKey) return configuredKey;

  try {
    const projectRef = new URL(client?.supabaseUrl || "").hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : "";
  } catch {
    return "";
  }
}

export function isSupabaseAuthStorageKey(client, key) {
  const storageKey = getSupabaseAuthStorageKey(client);
  return Boolean(storageKey && typeof key === "string" && (key === storageKey || key.startsWith(`${storageKey}-`)));
}

export function clearSupabaseAuthStorage(client, storage = getDefaultStorage()) {
  const storageKey = getSupabaseAuthStorageKey(client);
  if (!storage || !storageKey) return [];

  const removed = [];
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!isSupabaseAuthStorageKey(client, key)) continue;
    storage.removeItem(key);
    removed.push(key);
  }
  return removed;
}

export function isServerRejectedAuthError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();

  return (
    status === 401 ||
    status === 403 ||
    REJECTED_AUTH_CODES.has(code) ||
    /(?:auth session|session).*(?:missing|not found|invalid|expired)/.test(message) ||
    /(?:invalid|expired|rejected|missing).*(?:jwt|token|session)/.test(message) ||
    /(?:jwt|token).*(?:invalid|expired|rejected|missing)/.test(message) ||
    /user.*(?:not found|deleted|missing)/.test(message) ||
    message.includes("unauthorized")
  );
}

export async function clearRejectedAuthSession(client, storage = getDefaultStorage()) {
  clearCachedSupabaseUser(client);
  clearSupabaseAuthStorage(client, storage);
  await client?.auth?.signOut?.({ scope: "local" }).catch(() => {});
  clearSupabaseAuthStorage(client, storage);
}

export async function validateSupabaseIdentity(client, session, { storage = getDefaultStorage() } = {}) {
  if (!client || !session?.access_token) return { status: "guest", session: null, user: null, error: null };

  clearCachedSupabaseUser(client);
  try {
    const user = await getCachedSupabaseUser(client, { force: true });
    if (!user?.id || (session.user?.id && session.user.id !== user.id)) {
      const missingUserError = Object.assign(new Error("Authenticated user was not found."), {
        code: "user_not_found",
        status: 401,
      });
      throw missingUserError;
    }

    return { status: "authenticated", session: { ...session, user }, user, error: null };
  } catch (error) {
    if (!isServerRejectedAuthError(error)) throw error;
    await clearRejectedAuthSession(client, storage);
    return { status: "rejected", session: null, user: null, error };
  }
}
