import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { clearCachedSupabaseUser } from "../src/lib/sessionUserCache.js";
import { sets } from "../src/data/sets.js";

const clientUrl = new URL("../src/lib/supabaseClient.js", import.meta.url).href;
const hook = registerHooks({
  load(url, context, next) {
    if (url !== clientUrl) return next(url, context);
    return { format: "module", shortCircuit: true, source:
      "export const supabase = {}; export const isSupabaseConfigured = true;" };
  },
});
const { supabase } = await import(clientUrl);
const desktop = await import("../src/lib/cloudCollection.js");
const mobile = await import("../mobile-app/src/lib/cloudCollection.js");
hook.deregister();

const setId = "delta-reign";
const cards = sets.find(set => set.id === setId).cards.slice(0, 10);
const rows = cards.map(card => ({ set_id: setId, card_id: card.id, quantity: 1 }));
const saved = { userId: "alice", setId, cards, acknowledgedAt: 1 };

for (const [surface, api] of Object.entries({ desktop, mobile })) {
  function setup(t, page, overlays = [saved]) {
    const values = new Map();
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const key = api.PENDING_CLOUD_PULLS_KEY + ":acknowledged-overlay:v1";
    storage.setItem(key, JSON.stringify(overlays));
    globalThis.window = { localStorage: storage };
    t.after(() => { delete globalThis.window; });
    clearCachedSupabaseUser(supabase);
    supabase.auth = { getUser: async () => ({ data: { user: { id: "alice" } } }) };
    supabase.from = table => {
      assert.equal(table, "user_collection");
      return {
        select() { return this; },
        eq(column, user) { assert.deepEqual([column, user], ["user_id", "alice"]); return this; },
        order() { return this; },
        range: page,
      };
    };
    return {
      overlays: () => JSON.parse(storage.getItem(key)),
      queue: () => storage.getItem(api.PENDING_CLOUD_PULLS_KEY),
      display: async () => api.mergePendingCloudPullsIntoCollection(await api.loadCloudCollection(), "alice"),
    };
  }

  test(surface + " saved pack stays at 530 across reloads", async t => {
    const baseline = { set_id: setId, card_id: "prior-card", quantity: 520 };
    const fixture = setup(t, () => ({ data: [baseline, ...rows] }));
    for (let load = 0; load < 3; load++) {
      const collection = (await fixture.display())[setId];
      assert.equal(Object.values(collection).reduce((sum, card) => sum + card.count, 0), 530);
      assert.deepEqual(fixture.overlays(), []);
    }
  });

  test(surface + " unsynced pack stays visible and queued", async t => {
    const fixture = setup(t, () => ({ data: rows }), []);
    api.enqueuePendingCloudPull(cards, setId, "alice", "test-pending-pack");
    const queue = fixture.queue();
    assert.equal(JSON.parse(queue).length, 1);
    const collection = (await fixture.display())[setId];
    for (const card of cards) assert.equal(collection[card.id].count, 2);
    assert.equal(fixture.queue(), queue);
  });

  test(surface + " other accounts and newer acknowledgements are isolated", async t => {
    const other = { ...saved, userId: "bob" };
    const newer = { ...saved, acknowledgedAt: Date.now() + 60_000 };
    const fixture = setup(t, () => ({ data: rows }), [saved, other, newer]);
    const collection = (await fixture.display())[setId];
    assert.equal(collection[cards[0].id].count, 2);
    assert.deepEqual(fixture.overlays(), [other, newer]);
  });

  test(surface + " missing card in target set retains the entire overlay", async t => {
    const fixture = setup(t, () => ({ data: [...rows.slice(1), { ...rows[0], set_id: "other" }] }));
    await fixture.display();
    assert.deepEqual(fixture.overlays(), [saved]);
  });

  for (const failed of [true, false]) {
    test(surface + (failed ? " failed" : " incomplete") + " final page retains acknowledged overlay", async t => {
      const fullPage = Array.from({ length: 1000 }, (_, i) => rows[i % rows.length]);
      const fixture = setup(t, from => from === 0 ? { data: fullPage }
        : { data: null, error: failed ? new Error("page failed") : null });
      if (failed) await assert.rejects(fixture.display(), /page failed/);
      else await fixture.display();
      assert.deepEqual(fixture.overlays(), [saved]);
    });
  }
}
