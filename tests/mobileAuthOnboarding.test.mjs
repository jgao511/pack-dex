import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MOBILE_ONBOARDING_PENDING_KEY,
  MOBILE_ONBOARDING_VERSION_KEY,
  clearPendingMobileOnboarding,
  inspectPendingMobileOnboarding,
  markMobileOnboardingComplete,
  readPendingMobileOnboarding,
  savePendingMobileOnboarding,
} from "../mobile-app/src/lib/mobileOnboarding.js";
import {
  finalizeMobileOnboarding,
  getMobileOnboardingErrorPresentation,
  waitForAuthenticatedMobileSession,
} from "../mobile-app/src/lib/mobileOnboardingFinalizer.js";
import {
  establishMobileAuthCallbackSession,
  parseMobileAuthCallback,
} from "../mobile-app/src/lib/mobileAuthCallback.js";
import {
  consumeOnboardingCompleteParam,
  getInitialMobileTab,
} from "../mobile-app/src/lib/mobileRouting.js";
import {
  getMobileAuthCallbackUrl,
  getMobileResetPasswordUrl,
  normalizeCanonicalProductionLocation,
} from "../src/utils/authRedirects.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function tutorialPayload(storage, now = Date.parse("2026-07-27T12:00:00Z")) {
  return savePendingMobileOnboarding({
    setId: "151",
    cardIds: Array.from({ length: 10 }, (_, index) => `card-${index}`),
  }, storage, now);
}

function authenticatedClient(invoke) {
  const user = { id: "account-1", email: "collector@example.com" };
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "jwt", user } }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
    },
    functions: { invoke },
  };
}

test("pending onboarding is stable, credential-free, and survives normal completion cleanup", () => {
  const storage = memoryStorage();
  const first = tutorialPayload(storage);
  const second = savePendingMobileOnboarding({
    setId: "different-set",
    cardIds: Array.from({ length: 10 }, (_, index) => `different-${index}`),
  }, storage, Date.parse("2026-07-27T13:00:00Z"));

  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first).sort(), [
    "cardIds",
    "completionId",
    "createdAt",
    "destination",
    "migrationStatus",
    "setId",
    "skipped",
    "tutorialPackEventId",
    "version",
  ]);
  assert.equal(JSON.stringify(first).includes("password"), false);
  assert.equal(JSON.stringify(first).includes("access_token"), false);

  markMobileOnboardingComplete(storage);
  assert.ok(readPendingMobileOnboarding(storage));
  assert.equal(storage.getItem(MOBILE_ONBOARDING_VERSION_KEY), "1");
});

test("malformed and expired pending payloads are rejected without being silently deleted", () => {
  const malformedStorage = memoryStorage();
  malformedStorage.setItem(MOBILE_ONBOARDING_PENDING_KEY, JSON.stringify({ password: "never-store-this" }));
  assert.equal(inspectPendingMobileOnboarding(malformedStorage).reason, "malformed");
  assert.ok(malformedStorage.getItem(MOBILE_ONBOARDING_PENDING_KEY));

  const expiredStorage = memoryStorage();
  tutorialPayload(expiredStorage, Date.parse("2026-01-01T00:00:00Z"));
  const inspection = inspectPendingMobileOnboarding(expiredStorage, Date.parse("2026-03-01T00:00:00Z"));
  assert.equal(inspection.payload, null);
  assert.equal(inspection.reason, "expired");
  assert.ok(expiredStorage.getItem(MOBILE_ONBOARDING_PENDING_KEY));
});

test("callback/session finalization saves once, refreshes, clears pending, and opens Profile", async () => {
  const storage = memoryStorage();
  const pending = tutorialPayload(storage);
  const invocations = [];
  const refreshed = [];
  const navigations = [];
  const result = await finalizeMobileOnboarding({
    client: authenticatedClient(async (name, options) => {
      invocations.push({ name, options });
      return {
        data: {
          ok: true,
          status: "completed",
          tutorialPackSaved: true,
          rewardProgress: 1,
          stats: { packsOpened: 1, totalCardsPulled: 10 },
        },
        error: null,
      };
    }),
    storage,
    refreshData: async (user, response) => refreshed.push({ user, response }),
    navigate: (destination) => navigations.push(destination),
  });

  assert.equal(result.rewardProgress, 1);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].name, "complete-mobile-onboarding");
  assert.deepEqual(invocations[0].options.body, {
    version: 1,
    completion_id: pending.completionId,
    set_id: pending.setId,
    card_ids: pending.cardIds,
    tutorial_pack_event_id: pending.tutorialPackEventId,
    skipped: false,
  });
  assert.equal(refreshed.length, 1);
  assert.equal(storage.getItem(MOBILE_ONBOARDING_PENDING_KEY), null);
  assert.equal(storage.getItem(MOBILE_ONBOARDING_VERSION_KEY), "1");
  assert.deepEqual(navigations, ["/mobile-app/?tab=profile"]);
});

test("a lost success response preserves pending and retry accepts already_completed without another grant", async () => {
  const storage = memoryStorage();
  tutorialPayload(storage);
  let serverGrantCount = 0;
  let attempt = 0;
  const client = authenticatedClient(async () => {
    attempt += 1;
    if (attempt === 1) {
      serverGrantCount += 1;
      return {
        data: null,
        error: {
          context: new Response(JSON.stringify({
            ok: false,
            code: "server_migration_failure",
            message: "Response was lost.",
            retryable: true,
          }), { status: 500, headers: { "Content-Type": "application/json" } }),
        },
      };
    }
    return {
      data: {
        ok: true,
        status: "already_completed",
        tutorialPackSaved: true,
        rewardProgress: 1,
      },
      error: null,
    };
  });

  await assert.rejects(
    finalizeMobileOnboarding({ client, storage, navigate: () => {} }),
    (error) => {
      const presentation = getMobileOnboardingErrorPresentation(error);
      assert.equal(presentation.httpStatus, 500);
      assert.equal(presentation.code, "server_migration_failure");
      assert.equal(presentation.retryable, true);
      return true;
    }
  );
  assert.equal(readPendingMobileOnboarding(storage).migrationStatus, "failed");

  const retried = await finalizeMobileOnboarding({ client, storage, navigate: () => {} });
  assert.equal(retried.status, "already_completed");
  assert.equal(serverGrantCount, 1);
  assert.equal(storage.getItem(MOBILE_ONBOARDING_PENDING_KEY), null);
});

test("verification with no pending payload opens Profile without calling the grant function", async () => {
  const storage = memoryStorage();
  let functionCalls = 0;
  const destinations = [];
  const result = await finalizeMobileOnboarding({
    client: authenticatedClient(async () => {
      functionCalls += 1;
      return { data: null, error: null };
    }),
    storage,
    allowNoPending: true,
    navigate: (destination) => destinations.push(destination),
  });

  assert.equal(result.status, "no_pending");
  assert.equal(result.tutorialPackSaved, false);
  assert.equal(functionCalls, 0);
  assert.deepEqual(destinations, ["/mobile-app/?tab=profile"]);
});

test("failed finalization keeps the authenticated session and pending payload retryable", async () => {
  const storage = memoryStorage();
  tutorialPayload(storage);
  const client = authenticatedClient(async () => {
    throw new TypeError("network offline");
  });

  await assert.rejects(finalizeMobileOnboarding({ client, storage, navigate: () => {} }), (error) => {
    assert.equal(error.kind, "network_interruption");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(readPendingMobileOnboarding(storage).migrationStatus, "failed");
  assert.equal((await client.auth.getSession()).data.session.user.id, "account-1");
});

test("session readiness waits for the first valid session and user", async () => {
  let sessionReads = 0;
  const user = { id: "account-1" };
  const client = {
    auth: {
      getSession: async () => {
        sessionReads += 1;
        return sessionReads < 3
          ? { data: { session: null }, error: null }
          : { data: { session: { access_token: "jwt", user } }, error: null };
      },
      getUser: async () => ({ data: { user }, error: null }),
    },
  };

  const result = await waitForAuthenticatedMobileSession(client, {
    attempts: 3,
    intervalMs: 0,
    waitFn: async () => {},
  });
  assert.equal(result.user.id, user.id);
  assert.equal(sessionReads, 3);
});

test("callback parses query and fragment errors and exchanges an authorization code", async () => {
  assert.deepEqual(
    parseMobileAuthCallback({ search: "?error_code=otp_expired", hash: "#error_description=Expired+link" }),
    { code: "", errorCode: "otp_expired", errorDescription: "Expired link" }
  );

  const exchanged = [];
  await establishMobileAuthCallbackSession({
    auth: {
      exchangeCodeForSession: async (code) => {
        exchanged.push(code);
        return { data: { session: {} }, error: null };
      },
    },
  }, { search: "?code=authorization-code", hash: "" });
  assert.deepEqual(exchanged, ["authorization-code"]);

  await assert.rejects(
    establishMobileAuthCallbackSession({ auth: {} }, {
      search: "?error_code=otp_expired&error_description=Expired",
      hash: "",
    }),
    (error) => error.kind === "invalid_verification_link"
  );
});

test("canonical mobile auth URLs and URL-driven Profile routing are exact", () => {
  assert.equal(getMobileAuthCallbackUrl(), "https://www.pack-dex.com/mobile-app/auth/callback");
  assert.equal(getMobileResetPasswordUrl(), "https://www.pack-dex.com/mobile-app/reset-password");
  assert.equal(getInitialMobileTab({ pathname: "/mobile-app/", search: "?tab=profile&onboardingComplete=1" }), "profile");

  const replacements = [];
  consumeOnboardingCompleteParam({
    location: { href: "https://www.pack-dex.com/mobile-app/?tab=profile&onboardingComplete=1" },
    history: { replaceState: (...args) => replacements.push(args) },
    title: "PackDex",
  });
  assert.equal(replacements[0][2], "/mobile-app/?tab=profile");

  const canonicalReplacements = [];
  assert.equal(normalizeCanonicalProductionLocation({
    protocol: "https:",
    hostname: "pack-dex.com",
    href: "https://pack-dex.com/mobile-app/auth/callback?code=abc#state",
    replace: (url) => canonicalReplacements.push(url),
  }), true);
  assert.deepEqual(canonicalReplacements, [
    "https://www.pack-dex.com/mobile-app/auth/callback?code=abc#state",
  ]);
});

test("signup, callback, cleanup, Profile reward, and reset routes use the shared safe flow", async () => {
  const [appSource, websiteSource, resetSource, onboardingSource, rewardSource, copyBuildSource, routeCheckSource] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/MobileResetPasswordPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/lib/mobileOnboarding.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/welcomeReward.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/copy-mobile-build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/verify-production-routes.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /emailRedirectTo:\s*getMobileAuthCallbackUrl\(\)/);
  assert.match(appSource, /establishMobileAuthCallbackSession\(supabase/);
  assert.match(appSource, /withAsyncTimeout\(authRequest/);
  assert.match(appSource, /label:\s*isCreateMode \? "Account creation" : "Sign in"/);
  assert.match(appSource, /Check your email for a verification link before trying again/);
  assert.match(appSource, /return to the PackDex app and sign in with the same credentials/);
  assert.match(appSource, /finalizeMobileOnboarding\(\{/);
  const mobileCallbackSource = appSource.match(/function MobileAuthCallbackPage\(\) \{[\s\S]*?function getMobileViewportHeight/)?.[0] || "";
  assert.match(mobileCallbackSource, /waitForAuthenticatedMobileSession\(supabase\)/);
  assert.match(mobileCallbackSource, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(mobileCallbackSource, /Account verified\./);
  assert.match(mobileCallbackSource, /return to the PackDex app/);
  assert.doesNotMatch(mobileCallbackSource, /finalizeMobileOnboarding|window\.location\.(?:replace|assign)/);
  assert.match(websiteSource, /Account confirmed! Redirecting to PackDex/);
  assert.match(websiteSource, /window\.location\.assign\("\/"\)/);
  assert.doesNotMatch(appSource.match(/function clearAccountScopedState\(\)[\s\S]*?\n  \}/)?.[0] || "", /MOBILE_ONBOARDING_PENDING_KEY|clearPendingMobileOnboarding/);
  assert.match(appSource, /isLoggedIn && welcomeRewardStatus\?\.isEligible && !welcomeRewardStatus\?\.isClaimed/);
  assert.match(rewardSource, /if \(!user\) return \{ isEligible: false, isClaimed: true/);

  assert.match(resetSource, /token_hash: tokenHash/);
  assert.match(resetSource, /type: "recovery"/);
  assert.match(resetSource, /supabase\.auth\.updateUser\(\{ password: newPassword \}\)/);
  assert.match(resetSource, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(resetSource, /close this window, return to the PackDex app/);
  assert.doesNotMatch(resetSource, /window\.location\.replace\(`\$\{MOBILE_HOME_PATH\}\?tab=profile`\)|window\.location\.assign|href="\/"/);

  assert.match(onboardingSource, /clearPendingMobileOnboarding/);
  assert.match(onboardingSource, /MOBILE_ONBOARDING_PENDING_KEY/);
  assert.match(copyBuildSource, /targetDist,\s*"auth",\s*"callback"/);
  assert.match(routeCheckSource, /"mobile-app",\s*"auth",\s*"callback",\s*"index\.html"/);
});

test("server migration locks per user, uses stable receipts/events, and returns duplicate success", async () => {
  const [functionSource, migrationSource, configSource] = await Promise.all([
    readFile(new URL("../supabase/functions/complete-mobile-onboarding/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260727233000_fix_mobile_onboarding_completion.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);

  assert.match(functionSource, /getAuthenticatedUser\(req\)/);
  assert.doesNotMatch(functionSource, /body\?\.user_id|body\?\.userId/);
  assert.match(functionSource, /status: alreadyCompleted \? "already_completed" : "completed"/);
  assert.match(functionSource, /errorResponse\(401, code/);
  assert.match(functionSource, /"server_migration_failure"/);
  assert.match(configSource, /\[functions\.complete-mobile-onboarding\]\s+verify_jwt = false/);

  assert.match(migrationSource, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/);
  assert.match(migrationSource, /on conflict on constraint user_collection_increment_events_pkey do nothing/);
  assert.match(migrationSource, /on conflict on constraint user_collection_user_id_set_id_card_id_key do update/);
  assert.match(migrationSource, /on conflict \(user_id, client_event_id\) do nothing/);
  assert.match(migrationSource, /v_event_id text := 'mobile-onboarding:v' \|\| p_version::text/);
  assert.match(migrationSource, /false,\s*true,/);
  assert.match(migrationSource, /client_event_id not like 'welcome-god-pack:%'/);
});

test("explicit pending cleanup remains available only for confirmed finalization", () => {
  const storage = memoryStorage();
  tutorialPayload(storage);
  clearPendingMobileOnboarding(storage);
  assert.equal(storage.getItem(MOBILE_ONBOARDING_PENDING_KEY), null);
});
