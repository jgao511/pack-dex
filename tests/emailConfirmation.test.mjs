import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmEmailAndSignOut,
  parseEmailConfirmation,
} from "../src/lib/emailConfirmation.js";

test("confirmation parameters prefer a one-time token hash and reject unknown OTP types", () => {
  assert.deepEqual(
    parseEmailConfirmation({
      search: "?token_hash=abc123&type=email",
      hash: "",
    }),
    { tokenHash: "abc123", type: "email", code: "", errorDescription: "" }
  );
  assert.equal(
    parseEmailConfirmation({ search: "?token_hash=abc123&type=unexpected", hash: "" }).type,
    "email"
  );
});

test("a token-hash confirmation verifies once and ends the temporary browser session", async () => {
  const calls = [];
  const user = { id: "confirmed-user", email: "collector@example.com" };
  const result = await confirmEmailAndSignOut({
    auth: {
      async verifyOtp(payload) {
        calls.push(["verifyOtp", payload]);
        return { data: { user, session: { user } }, error: null };
      },
      async signOut(options) {
        calls.push(["signOut", options]);
        return { error: null };
      },
    },
  }, { search: "?token_hash=abc123&type=email", hash: "" });

  assert.deepEqual(calls, [
    ["verifyOtp", { token_hash: "abc123", type: "email" }],
    ["signOut", { scope: "local" }],
  ]);
  assert.deepEqual(result, { user, method: "token_hash" });
});

test("legacy code and implicit-session confirmation links remain compatible", async () => {
  const codeCalls = [];
  const user = { id: "legacy-user" };
  const codeResult = await confirmEmailAndSignOut({
    auth: {
      async exchangeCodeForSession(code) {
        codeCalls.push(code);
        return { data: { session: { user }, user }, error: null };
      },
      async signOut() { return { error: null }; },
    },
  }, { search: "?code=legacy-code", hash: "" });
  assert.equal(codeResult.method, "code");
  assert.deepEqual(codeCalls, ["legacy-code"]);

  const sessionResult = await confirmEmailAndSignOut({
    auth: {
      async getSession() { return { data: { session: { user } }, error: null }; },
      async signOut() { return { error: null }; },
    },
  }, { search: "", hash: "#access_token=legacy" });
  assert.equal(sessionResult.method, "session");
});

test("invalid, expired, incomplete, and failed sign-out states never report success", async () => {
  await assert.rejects(
    confirmEmailAndSignOut({ auth: {} }, { search: "?error_description=Expired", hash: "" }),
    /invalid or expired/i
  );
  await assert.rejects(
    confirmEmailAndSignOut({
      auth: {
        async verifyOtp() { return { data: { session: null, user: null }, error: null }; },
      },
    }, { search: "?token_hash=expired&type=email", hash: "" }),
    /missing or has expired/i
  );
  await assert.rejects(
    confirmEmailAndSignOut({
      auth: {
        async verifyOtp() {
          const user = { id: "confirmed-user" };
          return { data: { user, session: { user } }, error: null };
        },
        async signOut() { return { error: new Error("sign out failed") }; },
      },
    }, { search: "?token_hash=abc123&type=email", hash: "" }),
    /sign out failed/i
  );
});
