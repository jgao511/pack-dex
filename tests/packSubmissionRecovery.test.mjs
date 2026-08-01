import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ATOMIC_PACK_RPC_NAME,
  ATOMIC_PACK_SUBMISSION_VERSION,
  RETIRED_PACK_RPC_NAME,
  classifyPackSubmissionError,
  getSafeCompletedPackPayloadShape,
  makeAtomicPackRpcPayload,
  sanitizePendingPackQueueEntries,
} from "../src/lib/packSubmissionPolicy.js";
import {
  PENDING_CLOUD_PULLS_KEY,
  enqueuePendingCloudPull,
  getPendingCloudPullCount,
  syncPendingCloudPulls,
} from "../mobile-app/src/lib/cloudCollection.js";
import {
  PENDING_CLOUD_PULLS_KEY as DESKTOP_PENDING_CLOUD_PULLS_KEY,
  enqueuePendingCloudPull as enqueueDesktopPendingCloudPull,
  getPendingCloudPullCount as getDesktopPendingCloudPullCount,
  syncPendingCloudPulls as syncDesktopPendingCloudPulls,
} from "../src/lib/cloudCollection.js";
import {
  PACKDEX_CLIENT_VERSION,
  shouldReloadForServiceWorkerVersion,
} from "../src/lib/clientUpdate.js";
import { claimPackPersistence } from "../mobile-app/src/lib/packRevealLifecycle.js";

class MemoryStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  removeItem(key) { this.entries.delete(key); }
  setItem(key, value) { this.entries.set(key, String(value)); }
}

const CARD = { id: "base-set-4", name: "Charizard", number: "4" };

function queuedPull(overrides = {}) {
  return {
    id: "pack-open:base-set:legacy",
    userId: "user-1",
    setId: "base-set",
    cards: [CARD],
    createdAt: 1,
    collectionConfirmedAt: true,
    packEventConfirmedAt: null,
    ...overrides,
  };
}

function successfulRow(payload, packsOpened = 1) {
  return [{
    client_event_id: payload.batches[0].client_event_id,
    accepted: true,
    recorded: true,
    packs_opened: packsOpened,
    total_cards_pulled: packsOpened,
  }];
}

test("an explicit retired event-only queue job is discarded without any RPC", async () => {
  const storage = new MemoryStorage({
    [PENDING_CLOUD_PULLS_KEY]: JSON.stringify([
      queuedPull({ rpcName: RETIRED_PACK_RPC_NAME }),
    ]),
  });
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push([name, structuredClone(payload)]);
      return { data: successfulRow(payload), error: null };
    },
  };

  const result = await syncPendingCloudPulls("user-1", {
    client,
    storage,
    validateUser: false,
  });

  assert.equal(result.attempted, 0);
  assert.equal(result.saved, 0);
  assert.equal(getPendingCloudPullCount("user-1", storage), 0);
  assert.deepEqual(calls, []);
});

test("a versionless split-save pull is repaired only through the atomic RPC", async () => {
  const storage = new MemoryStorage({
    [PENDING_CLOUD_PULLS_KEY]: JSON.stringify([
      queuedPull({ collectionConfirmedAt: 123, packEventConfirmedAt: null }),
    ]),
  });
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push([name, structuredClone(payload)]);
      return { data: successfulRow(payload), error: null };
    },
  };

  const result = await syncPendingCloudPulls("user-1", { client, storage, validateUser: false });

  assert.equal(result.saved, 1);
  assert.deepEqual(calls.map(([name]) => name), [ATOMIC_PACK_RPC_NAME]);
  assert.equal(calls[0][1].batches[0].client_event_id, "pack-open:base-set:legacy");
  assert.equal(getPendingCloudPullCount("user-1", storage), 0);
});

test("a 42501 response is permanent, removed immediately, and never retried", async () => {
  const storage = new MemoryStorage({
    [PENDING_CLOUD_PULLS_KEY]: JSON.stringify([
      queuedPull({ submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION }),
    ]),
  });
  let calls = 0;
  const client = {
    async rpc() {
      calls += 1;
      return {
        data: null,
        error: { code: "42501", message: "permission denied for function record_pack_open_event" },
      };
    },
  };

  const first = await syncPendingCloudPulls("user-1", { client, storage, validateUser: false });
  const retry = await syncPendingCloudPulls("user-1", { client, storage, validateUser: false });

  assert.equal(first.rejected, 1);
  assert.equal(first.failed, 0);
  assert.equal(retry.attempted, 0);
  assert.equal(calls, 1);
  assert.equal(getPendingCloudPullCount("user-1", storage), 0);
});

test("empty and multi-pack atomic submissions are rejected locally", () => {
  assert.throws(() => makeAtomicPackRpcPayload([]), { code: "22023" });
  assert.throws(
    () => makeAtomicPackRpcPayload([
      { client_event_id: "one", cards: [{ set_id: "base-set", card_id: "1", quantity: 1 }] },
      { client_event_id: "two", cards: [{ set_id: "base-set", card_id: "2", quantity: 1 }] },
    ]),
    { code: "22023" }
  );
  assert.deepEqual(getSafeCompletedPackPayloadShape([]), {
    rpc: ATOMIC_PACK_RPC_NAME,
    submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION,
    batchCount: 0,
    clientEventId: "",
    cardRowCount: 0,
    totalCardQuantity: 0,
    setCount: 0,
  });
});

test("multiple queued packs submit individually and sequentially", async () => {
  const storage = new MemoryStorage();
  enqueuePendingCloudPull([CARD], "base-set", "user-1", "pack-1", { storage });
  enqueuePendingCloudPull([CARD], "base-set", "user-1", "pack-2", { storage });
  enqueuePendingCloudPull([CARD], "base-set", "user-1", "pack-3", { storage });
  let active = 0;
  let peakActive = 0;
  const calls = [];
  const client = {
    async rpc(name, payload) {
      active += 1;
      peakActive = Math.max(peakActive, active);
      calls.push([name, structuredClone(payload)]);
      await Promise.resolve();
      active -= 1;
      return { data: successfulRow(payload, calls.length), error: null };
    },
  };

  const result = await syncPendingCloudPulls("user-1", { client, storage, validateUser: false });

  assert.equal(result.saved, 3);
  assert.equal(peakActive, 1);
  assert.deepEqual(calls.map(([, payload]) => payload.batches.length), [1, 1, 1]);
  assert.deepEqual(
    calls.map(([, payload]) => payload.batches[0].client_event_id),
    ["pack-1", "pack-2", "pack-3"]
  );
});

test("desktop pending packs use the same sequential atomic path", async () => {
  const storage = new MemoryStorage();
  enqueueDesktopPendingCloudPull([CARD], "base-set", "desktop-user", "desktop-pack-1", { storage });
  enqueueDesktopPendingCloudPull([CARD], "base-set", "desktop-user", "desktop-pack-2", { storage });
  let active = 0;
  let peakActive = 0;
  const calls = [];
  const client = {
    async rpc(name, payload) {
      active += 1;
      peakActive = Math.max(peakActive, active);
      calls.push([name, structuredClone(payload)]);
      await Promise.resolve();
      active -= 1;
      return { data: successfulRow(payload, calls.length), error: null };
    },
  };

  const result = await syncDesktopPendingCloudPulls("desktop-user", { client, storage });

  assert.equal(result.saved, 2);
  assert.equal(peakActive, 1);
  assert.deepEqual(calls.map(([name]) => name), [ATOMIC_PACK_RPC_NAME, ATOMIC_PACK_RPC_NAME]);
  assert.deepEqual(calls.map(([, payload]) => payload.batches.length), [1, 1]);
  assert.equal(getDesktopPendingCloudPullCount("desktop-user", storage), 0);
  assert.equal(storage.getItem(DESKTOP_PENDING_CLOUD_PULLS_KEY), "[]");
});

test("duplicate UI completion claims cannot persist the same pack twice", () => {
  const first = claimPackPersistence("", "pack-open:base-set:stable-event");
  const duplicatePointer = claimPackPersistence(first.saveKey, "pack-open:base-set:stable-event");
  const duplicateAnimation = claimPackPersistence(first.saveKey, "pack-open:base-set:stable-event");

  assert.equal(first.shouldPersist, true);
  assert.equal(duplicatePointer.shouldPersist, false);
  assert.equal(duplicateAnimation.shouldPersist, false);
});

test("22023 entries are discarded while a transient network failure remains queued", async () => {
  const invalidStorage = new MemoryStorage();
  enqueuePendingCloudPull([CARD], "base-set", "user-1", "invalid-pack", { storage: invalidStorage });
  let invalidCalls = 0;
  const invalidClient = {
    async rpc() {
      invalidCalls += 1;
      return { data: null, error: { code: "22023", message: "Exactly one completed pack must be submitted" } };
    },
  };
  await syncPendingCloudPulls("user-1", { client: invalidClient, storage: invalidStorage, validateUser: false });
  await syncPendingCloudPulls("user-1", { client: invalidClient, storage: invalidStorage, validateUser: false });
  assert.equal(invalidCalls, 1);
  assert.equal(getPendingCloudPullCount("user-1", invalidStorage), 0);

  const transientStorage = new MemoryStorage();
  enqueuePendingCloudPull([CARD], "base-set", "user-1", "offline-pack", { storage: transientStorage });
  await assert.rejects(
    syncPendingCloudPulls("user-1", {
      client: { async rpc() { return { data: null, error: new Error("offline") }; } },
      storage: transientStorage,
      validateUser: false,
    }),
    /offline/
  );
  assert.equal(getPendingCloudPullCount("user-1", transientStorage), 1);
});

test("stale service-worker and client-version states fail safely", async () => {
  assert.equal(shouldReloadForServiceWorkerVersion({
    announcedVersion: "pack-atomic-v3",
    clientVersion: PACKDEX_CLIENT_VERSION,
    reloadedVersion: "",
  }), true);
  assert.equal(shouldReloadForServiceWorkerVersion({
    announcedVersion: "pack-atomic-v3",
    clientVersion: PACKDEX_CLIENT_VERSION,
    reloadedVersion: "pack-atomic-v3",
  }), false);

  const storage = new MemoryStorage({
    [PENDING_CLOUD_PULLS_KEY]: JSON.stringify([
      queuedPull({ submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION + 1 }),
    ]),
  });
  let calls = 0;
  const result = await syncPendingCloudPulls("user-1", {
    client: { async rpc() { calls += 1; throw new Error("must not call"); } },
    storage,
    validateUser: false,
  });
  assert.equal(result.attempted, 0);
  assert.equal(result.rejected, 0);
  assert.equal(calls, 0);
  assert.equal(getPendingCloudPullCount("user-1", storage), 0);

  const swSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const headersSource = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(swSource, /skipWaiting\(\)/);
  assert.match(swSource, /clients\.claim\(\)/);
  assert.match(swSource, /cache: "no-store"/);
  assert.match(headersSource, /\/sw\.js[\s\S]*Cache-Control: no-store/);
  assert.match(headersSource, /\/mobile-app\/assets\/\*[\s\S]*immutable/);
});

test("permanent and transient retry classification stays narrow", () => {
  assert.deepEqual(
    classifyPackSubmissionError(
      { code: "42501", message: "permission denied for function record_pack_open_event" },
      { rpcName: RETIRED_PACK_RPC_NAME }
    ).retryable,
    false
  );
  assert.equal(classifyPackSubmissionError({ code: "22023" }).retryable, false);
  assert.equal(classifyPackSubmissionError({ code: "22P02" }).retryable, false);
  assert.equal(classifyPackSubmissionError({ code: "PGRST202" }).retryable, false);
  assert.equal(classifyPackSubmissionError({ status: 401 }).retryable, false);
  assert.equal(classifyPackSubmissionError({ status: 429 }).retryable, false);
  assert.equal(classifyPackSubmissionError(new Error("unexpected application failure")).retryable, false);
  assert.equal(classifyPackSubmissionError(new Error("offline")).retryable, true);
  assert.equal(classifyPackSubmissionError(new Error("request timed out")).retryable, true);
  assert.equal(classifyPackSubmissionError({ status: 503 }).retryable, true);
});

test("queue sanitation removes malformed and retired jobs without deleting valid atomic pulls", () => {
  const valid = queuedPull({ submissionVersion: ATOMIC_PACK_SUBMISSION_VERSION });
  const result = sanitizePendingPackQueueEntries([
    null,
    { operation: RETIRED_PACK_RPC_NAME, id: "event-only" },
    { ...queuedPull(), rpc: `public.${RETIRED_PACK_RPC_NAME}` },
    { ...queuedPull(), submissionVersion: "not-a-version" },
    valid,
  ]);

  assert.deepEqual(result.entries, [valid]);
  assert.equal(result.removed, 4);
  assert.ok(result.reasons.includes("retired_event_only_job"));
  assert.ok(result.reasons.includes("malformed_pack_job"));
  assert.ok(result.reasons.includes("incompatible_pack_job_version"));
});

test("malformed persisted queue JSON is removed and does not crash synchronization", async () => {
  const storage = new MemoryStorage({ [PENDING_CLOUD_PULLS_KEY]: "{not-json" });
  let calls = 0;
  const result = await syncPendingCloudPulls("user-1", {
    client: { async rpc() { calls += 1; throw new Error("must not call"); } },
    storage,
    validateUser: false,
  });

  assert.equal(result.attempted, 0);
  assert.equal(calls, 0);
  assert.equal(storage.getItem(PENDING_CLOUD_PULLS_KEY), null);
});

test("guest save helpers never enqueue or call a pack RPC", async () => {
  const desktopStorage = new MemoryStorage();
  const mobileStorage = new MemoryStorage();
  let calls = 0;
  const client = { async rpc() { calls += 1; throw new Error("guest must not call"); } };

  const desktopResult = await import("../src/lib/cloudCollection.js")
    .then(({ savePulledCardsToCloud }) => savePulledCardsToCloud([CARD], "base-set", {
      userId: "",
      clientEventId: "guest-event",
      client,
      storage: desktopStorage,
    }));
  const mobileResult = await import("../mobile-app/src/lib/cloudCollection.js")
    .then(({ savePulledCardsToCloud }) => savePulledCardsToCloud([CARD], "base-set", {
      userId: "",
      clientEventId: "guest-event",
      client,
      storage: mobileStorage,
      validateUser: false,
    }));

  assert.equal(desktopResult.recorded, false);
  assert.equal(mobileResult.attempted, 0);
  assert.equal(calls, 0);
  assert.equal(desktopStorage.getItem(DESKTOP_PENDING_CLOUD_PULLS_KEY), null);
  assert.equal(mobileStorage.getItem(PENDING_CLOUD_PULLS_KEY), null);
});

test("current desktop and mobile client sources have no retired RPC call site", async () => {
  const [desktopSource, mobileSource, desktopApp, mobileApp, eventHelpers] = await Promise.all([
    readFile(new URL("../src/lib/cloudCollection.js", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/lib/cloudCollection.js", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/packOpenEvents.js", import.meta.url), "utf8"),
  ]);

  for (const source of [desktopSource, mobileSource, desktopApp, mobileApp, eventHelpers]) {
    assert.doesNotMatch(source, /\.rpc\(["'`]record_pack_open_event["'`]/);
    assert.doesNotMatch(source, /callRpcWithTimeout\([^)]*record_pack_open_event/);
    assert.doesNotMatch(source, /functions\.invoke\(["'`]record-pack-open["'`]/);
  }
  for (const source of [desktopSource, mobileSource]) {
    assert.match(source, /ATOMIC_PACK_RPC_NAME/);
    assert.match(source, /makeAtomicPackRpcPayload/);
  }
});
