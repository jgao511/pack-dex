import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clearDeletedAccountLocalState, deleteCurrentAccount } from "../src/lib/accountDeletion.js";

function makeStorage(entries = {}) {
  const values = new Map(Object.entries(entries));

  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("account deletion clears PackDex local state while preserving another account's queued pull", () => {
  const storage = makeStorage({
    "pokemon-pack-simulator-collection": "{}",
    "packdex-binders": "{}",
    "packdex-theme": "dark",
    "packdex-pending-cloud-pulls": JSON.stringify([{ userId: "delete-me" }, { userId: "other-user" }]),
    "packdex-mobile-pending-cloud-pulls": JSON.stringify([{ userId: "delete-me" }]),
    "packdex_welcome_beta_seen_delete-me": "true",
  });

  clearDeletedAccountLocalState("delete-me", storage);

  assert.equal(storage.getItem("pokemon-pack-simulator-collection"), null);
  assert.equal(storage.getItem("packdex-binders"), null);
  assert.equal(storage.getItem("packdex-theme"), null);
  assert.equal(storage.getItem("packdex_welcome_beta_seen_delete-me"), null);
  assert.deepEqual(JSON.parse(storage.getItem("packdex-pending-cloud-pulls")), [{ userId: "other-user" }]);
  assert.equal(storage.getItem("packdex-mobile-pending-cloud-pulls"), null);
});

test("client uses only the authenticated Edge Function and does not send a target user", async () => {
  const calls = [];
  const client = {
    functions: {
      invoke: async (...args) => {
        calls.push(args);
        return { data: { deleted: true }, error: null };
      },
    },
  };

  await deleteCurrentAccount(client);

  assert.deepEqual(calls, [["delete-account", { body: {} }]]);
});

test("deletion UI is authenticated-only and requires deliberate DELETE confirmation", async () => {
  const [webApp, mobileApp, dialog, mobileDialog] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DeleteAccountDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/components/DeleteAccountDialog.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(webApp, /user \? \([\s\S]*?onDeleteAccount/);
  assert.match(mobileApp, /\{user && \([\s\S]*?onDeleteAccount/);
  assert.match(dialog, /confirmation !== "DELETE"/);
  assert.match(dialog, /Permanently Delete Account/);
  assert.match(mobileDialog, /confirmation !== "DELETE"/);
  assert.match(mobileDialog, /Permanently Delete Account/);
});

test("successful deletion shows a persistent confirmation state on web and mobile", async () => {
  const [webApp, mobileApp, dialog, mobileDialog] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DeleteAccountDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/components/DeleteAccountDialog.jsx", import.meta.url), "utf8"),
  ]);

  for (const source of [dialog, mobileDialog]) {
    assert.match(source, /useState\("idle"\)/);
    assert.match(source, /setDeletionState\("confirming"\)/);
    assert.match(source, /setDeletionState\("deleting"\)/);
    assert.match(source, /setDeletionState\("success"\)/);
    assert.match(source, /Account Deleted/);
    assert.match(source, /Your PackDex account and saved account data have been permanently deleted\./);
    assert.match(source, /Continue as Guest/);
  }

  for (const app of [webApp, mobileApp]) {
    const deleteHandler = app.match(/async function handleDeleteAccount\(\) \{[\s\S]*?\r?\n  \}\r?\n\r?\n  async function handleContinueAsGuest/ )?.[0] || "";
    assert.notEqual(deleteHandler, "");
    assert.doesNotMatch(deleteHandler, /setIsDeleteAccountOpen\(false\)/);
    assert.match(app, /onContinueAsGuest=\{handleContinueAsGuest\}/);
  }
});

test("deletion failure returns to a retryable error state", async () => {
  const [dialog, mobileDialog] = await Promise.all([
    readFile(new URL("../src/components/DeleteAccountDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/components/DeleteAccountDialog.jsx", import.meta.url), "utf8"),
  ]);

  for (const source of [dialog, mobileDialog]) {
    assert.match(source, /setDeletionState\("error"\)/);
    assert.match(source, /Account deletion could not be completed\. Please try again\./);
    assert.match(source, /Try Deleting Again/);
    assert.match(source, /if \(deletionState === "error"\) setDeletionState\("confirming"\)/);
  }
});

test("success action clears the local session before returning to guest mode", async () => {
  const [webApp, mobileApp] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(webApp, /async function handleContinueAsGuest\(\) \{[\s\S]*?auth\.signOut\(\{ scope: "local" \}\)[\s\S]*?setAuthSession\(null\)[\s\S]*?setIsDeleteAccountOpen\(false\)/);
  assert.match(mobileApp, /async function handleContinueAsGuest\(\) \{[\s\S]*?auth\.signOut\(\{ scope: "local" \}\)[\s\S]*?clearAccountScopedState\(\)[\s\S]*?setIsDeleteAccountOpen\(false\)/);
});

test("mobile deletion dialog resolves React from the mobile application", async () => {
  const mobileApp = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");

  assert.match(mobileApp, /import DeleteAccountDialog from "\.\/components\/DeleteAccountDialog\.jsx"/);
  assert.doesNotMatch(mobileApp, /\.\.\/\.\.\/src\/components\/DeleteAccountDialog/);
});

test("server deletion binds data and auth deletion to the authenticated user only", async () => {
  const [functionSource, migration, scannerMigration] = await Promise.all([
    readFile(new URL("../supabase/functions/delete-account/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716120000_account_deletion.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716150000_scanner_card_actions.sql", import.meta.url), "utf8"),
  ]);

  assert.match(functionSource, /getAuthenticatedUser\(req\)/);
  assert.match(functionSource, /target_user_id: user\.id/);
  assert.match(functionSource, /deleteUser\(user\.id\)/);
  assert.doesNotMatch(functionSource, /req\.json/);
  for (const table of ["user_wishlist", "user_achievements", "user_binders", "user_collection_increment_events", "user_pack_open_events", "user_welcome_rewards", "user_profile_stats", "user_collection"]) {
    assert.match(migration, new RegExp(`delete from public\\.${table} where user_id = target_user_id`));
    assert.match(scannerMigration, new RegExp(`delete from public\\.${table} where user_id = target_user_id`));
  }
  assert.match(scannerMigration, /delete from public\.user_scanner_card_additions where user_id = target_user_id/);
});
