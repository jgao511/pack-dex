import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  COLLECTION_STORAGE_KEY,
  getCardCount,
  loadCollection,
  markCardsCollected,
  saveCollection,
} from "../src/utils/collectionStorage.js";
import {
  PENDING_CLOUD_PULLS_KEY,
  enqueuePendingCloudPull,
  getPendingCloudPullCount,
  getPendingCloudPulls,
  mergePendingCloudPullsIntoCollection,
  savePulledCardsToCloud,
  syncPendingCloudPulls,
} from "../mobile-app/src/lib/cloudCollection.js";

class MemoryStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  get length() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }

  getItem(key) {
    return this.entries.has(key) ? this.entries.get(key) : null;
  }

  key(index) {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key) {
    this.entries.delete(key);
  }

  setItem(key, value) {
    this.entries.set(key, String(value));
  }
}

const SET_ID = "base-set";
const CARD = { id: "base-set-4", name: "Charizard", number: "4" };

function makeCloudClient({ failCollection = false, failPackEvent = false } = {}) {
  const collectionEvents = new Set();
  const packEvents = new Set();
  const quantities = new Map();
  const calls = [];

  return {
    calls,
    collectionEvents,
    packEvents,
    quantities,
    async rpc(name, payload) {
      calls.push([name, structuredClone(payload)]);

      if (name === "increment_collection_cards") {
        if (failCollection) {
          return { data: null, error: new Error("offline") };
        }

        const rows = [];
        for (const batch of payload.batches) {
          if (!collectionEvents.has(batch.client_event_id)) {
            collectionEvents.add(batch.client_event_id);
            for (const card of batch.cards) {
              const key = `${card.set_id}:${card.card_id}`;
              quantities.set(key, Number(quantities.get(key) || 0) + Number(card.quantity || 0));
            }
          }
          rows.push({ client_event_id: batch.client_event_id });
        }
        return { data: rows, error: null };
      }

      if (name === "record_pack_open_event") {
        if (failPackEvent) {
          return { data: null, error: new Error("stats unavailable") };
        }

        packEvents.add(payload.p_client_event_id);
        const totalCardsPulled = [...quantities.values()].reduce((total, count) => total + count, 0);
        return {
          data: [{
            recorded: true,
            packs_opened: packEvents.size,
            total_cards_pulled: totalCardsPulled,
          }],
          error: null,
        };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
}

test("guest pack survives a collection remount and remains separate from account queues", () => {
  const storage = new MemoryStorage();
  const firstMount = loadCollection(storage);
  const afterPack = markCardsCollected(firstMount, [CARD], SET_ID, 1234);

  saveCollection(afterPack, storage);

  const remountedCollection = loadCollection(storage);
  assert.equal(getCardCount(remountedCollection, CARD, SET_ID), 1);
  assert.ok(storage.getItem(COLLECTION_STORAGE_KEY));
  assert.equal(storage.getItem(PENDING_CLOUD_PULLS_KEY), null);
});

test("mobile app initializes, persists, and restores guest collection state", async () => {
  const source = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const saveFlow = source.match(/async function saveRevealedPack[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(source, /const \[collection, setCollection\] = useState\(loadCollection\)/);
  assert.match(source, /function persistSessionCollection\(nextCollection\) \{\s*if \(!user\) saveCollection\(nextCollection\)/);
  assert.match(source, /function clearAccountScopedState\(\)[\s\S]*?setCollection\(loadCollection\(\)\)/);
  assert.ok(
    saveFlow.indexOf("enqueuePendingCloudPull") < saveFlow.indexOf("syncPendingCloudPulls"),
    "the durable queue write must happen before the first cloud request"
  );
  assert.doesNotMatch(saveFlow, /savePulledCardsToCloud/);
});

test("termination before the signed-in network promise resolves leaves the stable event queued", async () => {
  const storage = new MemoryStorage();
  const eventId = "pack-open:base-set:terminated";
  let requestStarted = false;
  const client = {
    rpc() {
      requestStarted = true;
      return new Promise(() => {});
    },
  };

  const unresolvedSave = savePulledCardsToCloud([CARD], SET_ID, {
    userId: "terminated-user",
    clientEventId: eventId,
    client,
    storage,
    validateUser: false,
    requestTimeoutMs: 0,
  });
  await Promise.resolve();

  assert.equal(requestStarted, true);
  assert.equal(getPendingCloudPullCount("terminated-user", storage), 1);
  assert.equal(getPendingCloudPulls("terminated-user", storage)[0].id, eventId);
  void unresolvedSave;
});

test("relaunch overlays the pending pack and synchronizes collection and stats exactly once", async () => {
  const storage = new MemoryStorage();
  const client = makeCloudClient();
  const userId = "relaunch-user";
  const eventId = "pack-open:base-set:relaunch";
  enqueuePendingCloudPull([CARD], SET_ID, userId, eventId, { storage, createdAt: 2000 });

  const localCollection = mergePendingCloudPullsIntoCollection({}, userId, storage);
  assert.equal(getCardCount(localCollection, CARD, SET_ID), 1);

  const result = await syncPendingCloudPulls(userId, { client, storage, validateUser: false });
  const retry = await syncPendingCloudPulls(userId, { client, storage, validateUser: false });

  assert.deepEqual(
    { attempted: result.attempted, saved: result.saved, failed: result.failed },
    { attempted: 1, saved: 1, failed: 0 }
  );
  assert.deepEqual(
    { attempted: retry.attempted, saved: retry.saved, failed: retry.failed },
    { attempted: 0, saved: 0, failed: 0 }
  );
  assert.equal(client.quantities.get(`${SET_ID}:${CARD.id}`), 1);
  assert.equal(client.packEvents.size, 1);
  assert.equal(result.stats.packsOpened, 1);
  assert.equal(result.stats.totalCardsPulled, 1);
  assert.equal(getPendingCloudPullCount(userId, storage), 0);
});

test("successful immediate sync removes the queued event", async () => {
  const storage = new MemoryStorage();
  const client = makeCloudClient();
  const userId = "immediate-user";
  const eventId = "pack-open:base-set:immediate";

  const result = await savePulledCardsToCloud([CARD], SET_ID, {
    userId,
    clientEventId: eventId,
    client,
    storage,
    validateUser: false,
  });

  assert.equal(result.saved, 1);
  assert.equal(getPendingCloudPullCount(userId, storage), 0);
  assert.deepEqual(client.calls.map(([name]) => name), [
    "increment_collection_cards",
    "record_pack_open_event",
  ]);
});

test("collection RPC failure retains the exact queued event", async () => {
  const storage = new MemoryStorage();
  const client = makeCloudClient({ failCollection: true });
  const userId = "offline-user";
  const eventId = "pack-open:base-set:offline";
  enqueuePendingCloudPull([CARD], SET_ID, userId, eventId, { storage });

  await assert.rejects(
    syncPendingCloudPulls(userId, { client, storage, validateUser: false }),
    /offline/
  );

  assert.equal(getPendingCloudPullCount(userId, storage), 1);
  assert.equal(getPendingCloudPulls(userId, storage)[0].id, eventId);
});

test("stats-phase interruption retains the event without double-overlaying confirmed cards", async () => {
  const storage = new MemoryStorage();
  const client = makeCloudClient({ failPackEvent: true });
  const userId = "stats-retry-user";
  const eventId = "pack-open:base-set:stats-retry";
  enqueuePendingCloudPull([CARD], SET_ID, userId, eventId, { storage });

  await assert.rejects(
    syncPendingCloudPulls(userId, { client, storage, validateUser: false }),
    /stats unavailable/
  );

  const queued = getPendingCloudPulls(userId, storage)[0];
  assert.ok(queued.collectionConfirmedAt);
  assert.equal(queued.packEventConfirmedAt, null);
  const cloudCollection = {
    [SET_ID]: {
      [CARD.id]: { count: 1, firstCollectedAt: 1, lastCollectedAt: 1 },
    },
  };
  assert.equal(
    getCardCount(mergePendingCloudPullsIntoCollection(cloudCollection, userId, storage), CARD, SET_ID),
    1
  );

  client.rpc = makeCloudClient().rpc;
  const result = await syncPendingCloudPulls(userId, { client, storage, validateUser: false });
  assert.equal(result.saved, 1);
  assert.equal(
    client.calls.filter(([name]) => name === "increment_collection_cards").length,
    1,
    "the already-confirmed collection event must not be incremented again"
  );
  assert.equal(getPendingCloudPullCount(userId, storage), 0);
});

test("repeated retry with the same event id never duplicates card quantities or pack events", async () => {
  const storage = new MemoryStorage();
  const client = makeCloudClient();
  const userId = "idempotent-user";
  const eventId = "pack-open:base-set:idempotent";
  enqueuePendingCloudPull([CARD, CARD], SET_ID, userId, eventId, { storage });

  await syncPendingCloudPulls(userId, { client, storage, validateUser: false });
  enqueuePendingCloudPull([CARD, CARD], SET_ID, userId, eventId, { storage });
  await syncPendingCloudPulls(userId, { client, storage, validateUser: false });

  assert.equal(client.quantities.get(`${SET_ID}:${CARD.id}`), 2);
  assert.equal(client.collectionEvents.size, 1);
  assert.equal(client.packEvents.size, 1);
});

test("pending pulls and synchronization are isolated by user id", async () => {
  const storage = new MemoryStorage();
  const userAClient = makeCloudClient();
  enqueuePendingCloudPull([CARD], SET_ID, "user-a", "pack-open:base-set:user-a", { storage });
  enqueuePendingCloudPull([CARD, CARD], SET_ID, "user-b", "pack-open:base-set:user-b", { storage });

  assert.equal(getCardCount(mergePendingCloudPullsIntoCollection({}, "user-a", storage), CARD, SET_ID), 1);
  assert.equal(getCardCount(mergePendingCloudPullsIntoCollection({}, "user-b", storage), CARD, SET_ID), 2);

  await syncPendingCloudPulls("user-a", {
    client: userAClient,
    storage,
    validateUser: false,
  });

  assert.equal(getPendingCloudPullCount("user-a", storage), 0);
  assert.equal(getPendingCloudPullCount("user-b", storage), 1);
  assert.equal(getPendingCloudPulls("user-b", storage)[0].id, "pack-open:base-set:user-b");
});
