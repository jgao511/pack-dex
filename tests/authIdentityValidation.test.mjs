import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clearSupabaseAuthStorage,
  isServerRejectedAuthError,
  isSupabaseAuthStorageKey,
  validateSupabaseIdentity,
} from "../src/lib/authIdentityValidation.js";
import { getCachedSupabaseUser } from "../src/lib/sessionUserCache.js";

function makeStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function makeClient(getUserResult) {
  const calls = [];
  return {
    calls,
    auth: {
      storageKey: "sb-packdex-auth-token",
      async getUser() { calls.push("getUser"); return getUserResult; },
      async signOut(options) { calls.push(["signOut", options]); },
    },
  };
}

const cachedSession = { access_token: "cached-token", user: { id: "account-1", email: "old@example.com" } };

test("a cached session alone never enables authenticated state", async () => {
  const storage = makeStorage({ "sb-packdex-auth-token": "cached" });
  const client = makeClient({ data: { user: null }, error: null });
  const result = await validateSupabaseIdentity(client, cachedSession, { storage });

  assert.equal(result.status, "rejected");
  assert.equal(result.user, null);
  assert.deepEqual(client.calls, ["getUser", ["signOut", { scope: "local" }]]);
  assert.equal(storage.getItem("sb-packdex-auth-token"), null);
});

test("a server-validated existing user remains authenticated", async () => {
  const user = { id: "account-1", email: "current@example.com" };
  const client = makeClient({ data: { user }, error: null });
  const result = await validateSupabaseIdentity(client, cachedSession, { storage: makeStorage() });

  assert.equal(result.status, "authenticated");
  assert.equal(result.user, user);
  assert.equal(result.session.user, user);
  assert.equal(await getCachedSupabaseUser(client), user);
  assert.deepEqual(client.calls, ["getUser"]);
});

test("deleted or rejected users clear only the current Supabase project session", async () => {
  const storage = makeStorage({
    "sb-packdex-auth-token": "cached",
    "sb-packdex-auth-token-code-verifier": "verifier",
    "sb-other-auth-token": "preserve",
  });
  const client = makeClient({ data: { user: null }, error: { status: 403, code: "user_not_found", message: "User not found" } });
  const result = await validateSupabaseIdentity(client, cachedSession, { storage });

  assert.equal(result.status, "rejected");
  assert.equal(storage.getItem("sb-packdex-auth-token"), null);
  assert.equal(storage.getItem("sb-packdex-auth-token-code-verifier"), null);
  assert.equal(storage.getItem("sb-other-auth-token"), "preserve");
});

test("transient validation failure does not destroy a potentially valid cached session", async () => {
  const storage = makeStorage({ "sb-packdex-auth-token": "cached" });
  const client = makeClient({ data: null, error: { status: 503, message: "Network unavailable" } });

  await assert.rejects(
    validateSupabaseIdentity(client, cachedSession, { storage }),
    (error) => error?.status === 503 && error?.message === "Network unavailable"
  );
  assert.equal(storage.getItem("sb-packdex-auth-token"), "cached");
  assert.deepEqual(client.calls, ["getUser"]);
});

test("auth storage matching and cleanup are scoped to the configured client key", () => {
  const client = makeClient({ data: { user: null }, error: null });
  const storage = makeStorage({ "sb-packdex-auth-token": "cached", "sb-unrelated-auth-token": "keep" });

  assert.equal(isSupabaseAuthStorageKey(client, "sb-packdex-auth-token"), true);
  assert.equal(isSupabaseAuthStorageKey(client, "sb-unrelated-auth-token"), false);
  assert.deepEqual(clearSupabaseAuthStorage(client, storage), ["sb-packdex-auth-token"]);
  assert.equal(storage.getItem("sb-unrelated-auth-token"), "keep");
  assert.equal(isServerRejectedAuthError({ message: "Auth session missing" }), true);
});

test("web and mobile auth restoration validate before account loads or welcome rewards", async () => {
  const [webApp, mobileApp] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
  ]);

  for (const source of [webApp, mobileApp]) {
    assert.match(source, /validateSupabaseIdentity/);
    assert.match(source, /addEventListener\("focus"/);
    assert.match(source, /addEventListener\("storage"/);
  }
  assert.match(mobileApp, /validateSupabaseIdentity[\s\S]*?loadAccountScopedState[\s\S]*?refreshWelcomeRewardStatus/);
});
