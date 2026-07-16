import assert from "node:assert/strict";
import test from "node:test";
import { addScannedCardOnce, loadScannerCardActionState } from "../mobile-app/src/lib/scannerCardActions.js";

function query(result) {
  return {
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve(result); },
  };
}

test("scanner collection RPC derives identity server-side and normalizes first-add success", async () => {
  const calls = [];
  const supabase = {
    async rpc(name, payload) {
      calls.push([name, payload]);
      return { data: [{ added: true, already_added: false, quantity: 3 }], error: null };
    },
  };

  const result = await addScannedCardOnce(supabase, { cardId: "xy12-113", setId: "xy12" });

  assert.deepEqual(calls, [["add_scanned_card_once", { p_card_id: "xy12-113", p_set_id: "xy12" }]]);
  assert.deepEqual(result, { added: true, alreadyAdded: false, quantity: 3 });
  assert.equal("user_id" in calls[0][1], false);
});

test("scanner collection RPC reports a repeated card without another increment", async () => {
  const supabase = { rpc: async () => ({ data: [{ added: false, already_added: true, quantity: 3 }], error: null }) };
  assert.deepEqual(
    await addScannedCardOnce(supabase, { cardId: "xy12-113", setId: "xy12" }),
    { added: false, alreadyAdded: true, quantity: 3 },
  );
});

test("scanner action state uses bounded receipt and wishlist lookups", async () => {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(table);
      if (table === "user_scanner_card_additions") return query({ data: { card_id: "xy12-113" }, error: null });
      return query({ data: { card_id: "xy12-113" }, error: null });
    },
  };

  assert.deepEqual(
    await loadScannerCardActionState(supabase, { cardId: "xy12-113", setId: "xy12" }),
    { collectionAdded: true, wishlisted: true },
  );
  assert.deepEqual(calls, ["user_scanner_card_additions", "user_wishlist"]);
});

test("invalid scanner identifiers are rejected before a server call", async () => {
  let called = false;
  const supabase = { rpc: async () => { called = true; return { data: [], error: null }; } };
  await assert.rejects(addScannedCardOnce(supabase, { cardId: "", setId: "xy12" }), /Invalid card ID/);
  assert.equal(called, false);
});
