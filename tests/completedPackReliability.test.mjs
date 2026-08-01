import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ATOMIC_PACK_SUBMISSION_VERSION,
  getPendingPackRetryDelayMs,
  sanitizePendingPackQueueEntries,
} from "../src/lib/packSubmissionPolicy.js";
import {
  PENDING_CLOUD_PULLS_KEY,
  cancelPendingCloudPullSync,
  enqueuePendingCloudPull,
  getPendingCloudPulls,
  syncPendingCloudPulls,
} from "../mobile-app/src/lib/cloudCollection.js";
import { ensurePackOpenClientEventId } from "../src/lib/packOpenEvents.js";

class MemoryStorage {
  constructor(entries = {}) { this.entries = new Map(Object.entries(entries)); }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  removeItem(key) { this.entries.delete(key); }
  setItem(key, value) { this.entries.set(key, String(value)); }
}

const CARD = { id: "base-set-4", number: "4", name: "Charizard" };

function accepted(payload, packsOpened = 1) {
  return {
    data: [{
      client_event_id: payload.batches[0].client_event_id,
      accepted: true,
      recorded: true,
      packs_opened: packsOpened,
      total_cards_pulled: packsOpened,
    }],
    error: null,
  };
}

test("queue migration deep-validates, rejects ambiguous batches, and deduplicates event ids", () => {
  const valid = {
    id: "event-1",
    userId: "user-1",
    setId: "base-set",
    cards: [CARD],
    createdAt: 1,
  };
  const richerDuplicate = { ...valid, cards: [CARD, { ...CARD, id: "base-set-5", number: "5" }] };
  const result = sanitizePendingPackQueueEntries([
    valid,
    richerDuplicate,
    { ...valid, id: "cross-set", cards: [{ ...CARD, setId: "jungle" }] },
    { ...valid, id: "ambiguous", batches: [{ cards: [CARD] }, { cards: [CARD] }] },
    { ...valid, id: "missing-card-id", cards: [{ name: "Unknown" }] },
  ]);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].cards.length, 2);
  assert.equal(result.entries[0].submissionVersion, ATOMIC_PACK_SUBMISSION_VERSION);
  assert.ok(result.reasons.includes("duplicate_client_event_id"));
  assert.ok(result.reasons.includes("ambiguous_multi_pack_job"));
  assert.ok(result.reasons.includes("invalid_pack_cards"));
});

test("overlapping synchronization triggers join one in-flight serial drain", async () => {
  const storage = new MemoryStorage();
  enqueuePendingCloudPull([CARD], "base-set", "user-1", "event-1", { storage });
  let release;
  let calls = 0;
  const client = {
    async rpc(_name, payload) {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
      return accepted(payload);
    },
  };

  const first = syncPendingCloudPulls("user-1", { client, storage, validateUser: false, requestTimeoutMs: 0 });
  const second = syncPendingCloudPulls("user-1", { client, storage, validateUser: false, requestTimeoutMs: 0 });
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.saved, 1);
  assert.equal(secondResult.saved, 1);
  assert.equal(calls, 1);
});

test("a rate-limited queue stops immediately and does not sacrifice later packs", async () => {
  const storage = new MemoryStorage();
  for (const id of ["event-1", "event-2", "event-3"]) {
    enqueuePendingCloudPull([CARD], "base-set", "user-1", id, { storage });
  }
  const calls = [];
  const client = {
    async rpc(_name, payload) {
      const id = payload.batches[0].client_event_id;
      calls.push(id);
      if (id === "event-1") return accepted(payload);
      return {
        data: [{ client_event_id: id, accepted: false, rejection_reason: "pack_rate_limit_one_second" }],
        error: null,
      };
    },
  };
  const result = await syncPendingCloudPulls("user-1", { client, storage, validateUser: false, now: () => 10_000 });
  const remaining = getPendingCloudPulls("user-1", storage);

  assert.deepEqual(calls, ["event-1", "event-2"]);
  assert.equal(result.saved, 1);
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].id, "event-2");
  assert.equal(remaining[0].attempts, 1);
  assert.equal(remaining[1].attempts, 0);
});

test("account switching cannot submit the next queued pack under the new user", async () => {
  const storage = new MemoryStorage();
  enqueuePendingCloudPull([CARD], "base-set", "user-a", "event-a1", { storage });
  enqueuePendingCloudPull([CARD], "base-set", "user-a", "event-a2", { storage });
  let currentUser = { id: "user-a" };
  let calls = 0;
  const client = {
    auth: {
      async getUser() { return { data: { user: currentUser }, error: null }; },
    },
    async rpc(_name, payload) {
      calls += 1;
      currentUser = { id: "user-b" };
      return accepted(payload);
    },
  };

  await assert.rejects(syncPendingCloudPulls("user-a", {
    client,
    storage,
    validateUser: true,
    requestTimeoutMs: 0,
  }));
  assert.equal(calls, 1);
  assert.equal(getPendingCloudPulls("user-a", storage).length, 2);
  cancelPendingCloudPullSync("user-a");
});

test("retry backoff is bounded, jittered, and stable event ids belong to logical packs", () => {
  assert.equal(getPendingPackRetryDelayMs(0, { reason: "pack_rate_limit_one_second" }), 1_250);
  assert.equal(getPendingPackRetryDelayMs(0, { random: () => 0 }), 1_500);
  assert.ok(getPendingPackRetryDelayMs(20, { random: () => 1 }) <= 300_000);

  const firstPack = [CARD];
  const firstId = ensurePackOpenClientEventId(firstPack, "base-set");
  assert.equal(ensurePackOpenClientEventId(firstPack, "base-set"), firstId);
  assert.notEqual(ensurePackOpenClientEventId([CARD], "base-set"), firstId);
});

test("forward migration controls stale shape errors without granting the retired function", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260801190000_controlled_pack_submission_boundary.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /invalid_completed_pack_count/);
  assert.match(migration, /invalid_completed_pack_payload/);
  assert.match(migration, /return query select[\s\S]*false,[\s\S]*v_rejection_reason/);
  assert.match(migration, /revoke all on function public\.increment_collection_cards_v2_internal/);
  assert.match(migration, /grant execute on function public\.increment_collection_cards\(jsonb\)[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.record_pack_open_event[\s\S]*to authenticated/);
});

test("ads.txt production regression check compares the source and built artifact exactly", async () => {
  const verify = await readFile(new URL("../scripts/verify-production-routes.mjs", import.meta.url), "utf8");
  assert.match(verify, /publicAdsPath/);
  assert.match(verify, /builtAdsPath/);
  assert.match(verify, /pub-4828542760410446/);
});
