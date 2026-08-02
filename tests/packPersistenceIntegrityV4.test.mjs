import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PENDING_CLOUD_PULLS_KEY,
  enqueuePendingCloudPull,
  getPendingCloudPullCount,
  mergePendingCloudPullsIntoCollection,
  syncPendingCloudPulls,
} from "../mobile-app/src/lib/cloudCollection.js";
import {
  getAcknowledgedCompletedPackOverlays,
  getCompletedPackQuarantineEntries,
  reconcileAcknowledgedCompletedPackOverlays,
} from "../src/lib/completedPackQueue.js";

class MemoryStorage {
  constructor(entries = {}) { this.entries = new Map(Object.entries(entries)); }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  removeItem(key) { this.entries.delete(key); }
  setItem(key, value) { this.entries.set(key, String(value)); }
}

const CARD = { id: "base-set-4", number: "4", name: "Charizard" };

function enqueue(storage, eventId = "event-1", userId = "user-1") {
  enqueuePendingCloudPull([CARD], "base-set", userId, eventId, { storage });
}

function acknowledgement(payload, overrides = {}) {
  return [{
    client_event_id: payload.batches[0].client_event_id,
    accepted: true,
    recorded: true,
    already_processed: false,
    rejection_code: null,
    retryable: false,
    packs_opened: 1,
    total_cards_pulled: 1,
    ...overrides,
  }];
}

async function expectPreservedResponse(data) {
  const storage = new MemoryStorage();
  enqueue(storage);
  await assert.rejects(syncPendingCloudPulls("user-1", {
    client: { async rpc() { return { data, error: null }; } },
    storage,
    validateUser: false,
    requestTimeoutMs: 0,
    now: () => 1_000,
    random: () => 0,
  }), (error) => error.code === "PACK_INVALID_ACKNOWLEDGEMENT");
  assert.equal(getPendingCloudPullCount("user-1", storage), 1);
  return storage;
}

test("empty acknowledgement preserves the exact completed pack", async () => {
  await expectPreservedResponse([]);
});

test("missing accepted preserves the exact completed pack", async () => {
  await expectPreservedResponse([{ client_event_id: "event-1", recorded: true }]);
});

test("accepted without recorded or already_processed preserves the pack", async () => {
  await expectPreservedResponse([{ client_event_id: "event-1", accepted: true }]);
});

test("mismatched acknowledgement event id preserves the submitted pack", async () => {
  await expectPreservedResponse([{
    client_event_id: "different-event",
    accepted: true,
    recorded: true,
    already_processed: false,
  }]);
});

test("expired session refreshes once and submits the logical pack exactly once", async () => {
  const storage = new MemoryStorage();
  enqueue(storage);
  let rpcCalls = 0;
  let refreshCalls = 0;
  const client = {
    auth: {
      async refreshSession() {
        refreshCalls += 1;
        return { data: { session: { refreshed: true } }, error: null };
      },
    },
    async rpc(_name, payload) {
      rpcCalls += 1;
      if (rpcCalls === 1) return { data: null, error: { status: 401, message: "expired JWT" } };
      return { data: acknowledgement(payload), error: null };
    },
  };
  const result = await syncPendingCloudPulls("user-1", {
    client, storage, validateUser: false, requestTimeoutMs: 0,
  });
  assert.equal(result.saved, 1);
  assert.equal(rpcCalls, 2);
  assert.equal(refreshCalls, 1);
  assert.equal(getPendingCloudPullCount("user-1", storage), 0);
});

test("401 and 403 failures preserve packs when session recovery is unavailable", async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      const storage = new MemoryStorage();
      enqueue(storage, `event-${status}`);
      await assert.rejects(syncPendingCloudPulls("user-1", {
        client: { async rpc() { return { data: null, error: { status } }; } },
        storage,
        validateUser: false,
        requestTimeoutMs: 0,
        now: () => 1_000,
      }));
      assert.equal(getPendingCloudPullCount("user-1", storage), 1);
    });
  }
});

test("PGRST202 and 42883 deployment skew preserve then recover the same event", async (t) => {
  for (const code of ["PGRST202", "42883"]) {
    await t.test(code, async () => {
      const storage = new MemoryStorage();
      enqueue(storage, `event-${code}`);
      let now = 1_000;
      let calls = 0;
      const client = {
        async rpc(_name, payload) {
          calls += 1;
          if (calls === 1) return { data: null, error: { code, message: "RPC unavailable" } };
          return { data: acknowledgement(payload), error: null };
        },
      };
      await assert.rejects(syncPendingCloudPulls("user-1", {
        client, storage, validateUser: false, requestTimeoutMs: 0, now: () => now, random: () => 0,
      }));
      assert.equal(getPendingCloudPullCount("user-1", storage), 1);
      now = 20_000;
      const recovered = await syncPendingCloudPulls("user-1", {
        client, storage, validateUser: false, requestTimeoutMs: 0, now: () => now,
      });
      assert.equal(recovered.saved, 1);
      assert.equal(calls, 2);
    });
  }
});

test("timeout after server commit resolves as already_processed without double counting", async () => {
  const storage = new MemoryStorage();
  enqueue(storage, "commit-timeout");
  let committed = false;
  let writes = 0;
  let now = 1_000;
  const client = {
    async rpc(_name, payload) {
      if (!committed) {
        committed = true;
        writes += 1;
        return new Promise((resolve) => setTimeout(() => resolve({
          data: acknowledgement(payload), error: null,
        }), 30));
      }
      return { data: acknowledgement(payload, { recorded: false, already_processed: true }), error: null };
    },
  };
  await assert.rejects(syncPendingCloudPulls("user-1", {
    client, storage, validateUser: false, requestTimeoutMs: 2, now: () => now, random: () => 0,
  }), /timed out/);
  now = 20_000;
  const result = await syncPendingCloudPulls("user-1", {
    client, storage, validateUser: false, requestTimeoutMs: 0, now: () => now,
  });
  assert.equal(result.saved, 1);
  assert.equal(writes, 1);
});

test("pending overlay survives refresh, sign-out, and account switching", () => {
  const storage = new MemoryStorage();
  enqueue(storage, "owner-event", "owner");
  const displayed = mergePendingCloudPullsIntoCollection({}, "owner", storage);
  assert.equal(displayed["base-set"]["base-set-4"].count, 1);
  assert.equal(getPendingCloudPullCount("owner", storage), 1);
  assert.equal(getPendingCloudPullCount("other", storage), 0);
  assert.equal(getPendingCloudPullCount("owner", storage), 1);
});

test("acknowledgement overlay closes the cloud-refresh race exactly once", async () => {
  const storage = new MemoryStorage();
  enqueue(storage, "race-event");
  const requestStartedAt = 1_000;
  await syncPendingCloudPulls("user-1", {
    client: { async rpc(_name, payload) { return { data: acknowledgement(payload), error: null }; } },
    storage,
    validateUser: false,
    requestTimeoutMs: 0,
    now: () => 2_000,
  });
  assert.equal(getAcknowledgedCompletedPackOverlays(PENDING_CLOUD_PULLS_KEY, "user-1", storage).length, 1);
  assert.equal(reconcileAcknowledgedCompletedPackOverlays(
    PENDING_CLOUD_PULLS_KEY, "user-1", requestStartedAt, storage
  ), 0);
  assert.equal(reconcileAcknowledgedCompletedPackOverlays(
    PENDING_CLOUD_PULLS_KEY, "user-1", 3_000, storage
  ), 1);
});

test("documented permanent rejection moves the payload to recoverable quarantine", async () => {
  const storage = new MemoryStorage();
  enqueue(storage, "invalid-event");
  const result = await syncPendingCloudPulls("user-1", {
    client: { async rpc(_name, payload) { return { data: acknowledgement(payload, {
      accepted: false,
      recorded: false,
      already_processed: false,
      rejection_code: "invalid_completed_pack_payload",
      rejection_reason: "invalid_completed_pack_payload",
      retryable: false,
    }), error: null }; } },
    storage,
    validateUser: false,
    requestTimeoutMs: 0,
  });
  assert.equal(result.rejected, 1);
  assert.equal(getPendingCloudPullCount("user-1", storage), 0);
  assert.equal(getCompletedPackQuarantineEntries(PENDING_CLOUD_PULLS_KEY, storage).length, 1);
});

test("server migration keeps collection receipt and pack event in one locked transaction", async () => {
  const [sql, receiptSchema] = await Promise.all([
    readFile(new URL(
      "../supabase/migrations/20260731173000_atomic_pack_submission_rate_limits.sql",
      import.meta.url
    ), "utf8"),
    readFile(new URL(
      "../supabase/migrations/20260711143000_compact_collection_and_profile_operations.sql",
      import.meta.url
    ), "utf8"),
  ]);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /insert into public\.user_collection_increment_events/);
  assert.match(sql, /insert into public\.user_pack_open_events/);
  assert.match(receiptSchema, /primary key \(user_id, client_event_id\)/);
});

test("service-worker upgrade never clears completed-pack local storage", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|indexedDB\.deleteDatabase/);
  assert.doesNotMatch(source, /caches\.keys\(\)[\s\S]*localStorage/);
});

test("profile labels distinguish collection quantity from pack-only pulls", async () => {
  const [mobileSource, desktopSource] = await Promise.all([
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(mobileSource, /<span>Cards in Collection<\/span>/);
  assert.doesNotMatch(mobileSource, /<span>Total Pulled<\/span>/);
  assert.match(desktopSource, /<span>Total Cards Pulled<\/span>/);
});
