import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PENDING_CLOUD_PULLS_KEY as DESKTOP_OVERLAY_KEY,
  cloudRowsToCollection as desktopRowsToCollection,
  loadCloudCollection as loadDesktopCollection,
} from "../src/lib/cloudCollection.js";
import {
  PENDING_CLOUD_PULLS_KEY as MOBILE_OVERLAY_KEY,
  loadCloudCollection as loadMobileCollection,
} from "../mobile-app/src/lib/cloudCollection.js";
import {
  COLLECTION_SNAPSHOT_PAGE_SIZE,
  COLLECTION_SNAPSHOT_STALE_CODE,
  createCollectionSnapshotLoader,
} from "../src/lib/collectionSnapshotLoader.js";
import { getAcknowledgedCompletedPackOverlays } from "../src/lib/completedPackQueue.js";

const TEST_USER = { id: "pagination-user" };

class MemoryStorage {
  constructor(entries = {}) { this.entries = new Map(Object.entries(entries)); }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  removeItem(key) { this.entries.delete(key); }
  setItem(key, value) { this.entries.set(key, String(value)); }
}

function makeRows(count, userId = TEST_USER.id) {
  return Array.from({ length: count }, (_, index) => ({
    user_id: userId,
    set_id: `set-${String(Math.floor(index / 700)).padStart(2, "0")}`,
    card_id: `card-${String(index).padStart(5, "0")}`,
    quantity: (index % 4) + 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  }));
}

function compareRows(left, right, column, ascending) {
  const result = String(left[column]).localeCompare(String(right[column]));
  return ascending ? result : -result;
}

function makeClient(rows, {
  failPages = new Set(),
  malformedPages = new Set(),
  deferRequest = null,
} = {}) {
  const requests = [];
  let requestNumber = 0;

  return {
    requests,
    from(table) {
      const query = {
        table,
        countRequested: false,
        filters: [],
        orders: [],
        select(_columns, options) {
          this.countRequested = options?.count === "exact";
          return this;
        },
        eq(column, value) {
          this.filters.push([column, value]);
          return this;
        },
        order(column, { ascending = true } = {}) {
          this.orders.push([column, ascending]);
          return this;
        },
        async range(from, to) {
          const currentRequest = requestNumber++;
          const page = Math.floor(from / COLLECTION_SNAPSHOT_PAGE_SIZE);
          requests.push({
            table: this.table,
            from,
            to,
            page,
            filters: [...this.filters],
            orders: [...this.orders],
            countRequested: this.countRequested,
          });
          if (deferRequest) await deferRequest({ currentRequest, page, query: this });
          if (failPages.has(page)) return { data: null, error: { code: "TEST_PAGE_FAILURE" }, count: null };
          if (malformedPages.has(page)) return { data: null, error: null, count: null };

          const filtered = rows
            .filter((row) => this.filters.every(([column, value]) => String(row[column]) === String(value)))
            .sort((left, right) => {
              for (const [column, ascending] of this.orders) {
                const result = compareRows(left, right, column, ascending);
                if (result !== 0) return result;
              }
              return 0;
            });
          return {
            data: filtered.slice(from, to + 1),
            error: null,
            count: this.countRequested ? filtered.length : null,
          };
        },
      };
      return query;
    },
  };
}

function collectionKeys(collection) {
  return Object.entries(collection)
    .flatMap(([setId, cards]) => Object.keys(cards || {}).map((cardId) => `${setId}\u0000${cardId}`))
    .sort();
}

function expectedKeys(rows) {
  return rows.map((row) => `${row.set_id}\u0000${row.card_id}`).sort();
}

function makeAcknowledgedOverlayStorage(storageKey, cardId = "overlay-card") {
  return new MemoryStorage({
    [`${storageKey}:acknowledged-overlay:v1`]: JSON.stringify([{
      id: "overlay-event",
      userId: TEST_USER.id,
      setId: "set-00",
      cards: [{ id: cardId, number: "1", name: "Overlay card" }],
      state: "acknowledged",
      acknowledgedAt: 1,
    }]),
  });
}

test("desktop collection pagination covers 0, 999, 1000, 1001, 2500+, and 5060 rows exactly", async () => {
  const cases = [
    [0, 1],
    [999, 2],
    [1000, 2],
    [1001, 3],
    [2501, 6],
    [5060, 11],
  ];

  for (const [rowCount, expectedRequests] of cases) {
    const rows = makeRows(rowCount);
    const client = makeClient(rows);
    const collection = await loadDesktopCollection({ client, user: TEST_USER, storage: new MemoryStorage() });
    assert.deepEqual(collectionKeys(collection), expectedKeys(rows), `${rowCount} rows`);
    assert.equal(client.requests.length, expectedRequests, `${rowCount} rows request count`);
    assert.deepEqual(client.requests[0].orders, [["set_id", true], ["card_id", true]]);
    assert.ok(client.requests.every(({ to, from }) => to - from + 1 === COLLECTION_SNAPSHOT_PAGE_SIZE));
    assert.equal(new Set(collectionKeys(collection)).size, rowCount);
  }
});

test("request counts are minimal for the requested production sizes", async () => {
  for (const [rowCount, expectedRequests] of [[1001, 3], [2500, 5], [5060, 11]]) {
    const client = makeClient(makeRows(rowCount));
    await loadDesktopCollection({ client, user: TEST_USER, storage: new MemoryStorage() });
    assert.equal(client.requests.length, expectedRequests, `${rowCount} rows`);
  }
});

test("desktop and mobile return identical complete 5060-row snapshots", async () => {
  const rows = makeRows(5060);
  const desktop = await loadDesktopCollection({
    client: makeClient(rows),
    user: TEST_USER,
    storage: new MemoryStorage(),
  });
  const mobile = await loadMobileCollection({
    client: makeClient(rows),
    user: TEST_USER,
    storage: new MemoryStorage(),
  });
  assert.deepEqual(mobile, desktop);
  assert.deepEqual(collectionKeys(mobile), expectedKeys(rows));
});

test("normal accounts below 1000 rows preserve the previous collection shape", async () => {
  const rows = makeRows(73);
  const collection = await loadDesktopCollection({
    client: makeClient(rows),
    user: TEST_USER,
    storage: new MemoryStorage(),
  });
  assert.deepEqual(collection, desktopRowsToCollection(rows));
});

test("page 2 failure preserves the last known state and acknowledged overlays", async () => {
  const lastKnown = desktopRowsToCollection(makeRows(25));
  let visibleCollection = lastKnown;
  const storage = makeAcknowledgedOverlayStorage(DESKTOP_OVERLAY_KEY);
  const client = makeClient(makeRows(1001), { failPages: new Set([1]) });

  let failure = null;
  try {
    visibleCollection = await loadDesktopCollection({ client, user: TEST_USER, storage });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.recoverable, true);
  assert.equal(failure?.page, 1);
  assert.strictEqual(visibleCollection, lastKnown);
  assert.equal(getAcknowledgedCompletedPackOverlays(DESKTOP_OVERLAY_KEY, TEST_USER.id, storage).length, 1);
});

test("final-page failure preserves the last known state and acknowledged overlays", async () => {
  const lastKnown = desktopRowsToCollection(makeRows(25));
  let visibleCollection = lastKnown;
  const storage = makeAcknowledgedOverlayStorage(DESKTOP_OVERLAY_KEY);
  const client = makeClient(makeRows(1001), { failPages: new Set([2]) });

  let failure = null;
  try {
    visibleCollection = await loadDesktopCollection({ client, user: TEST_USER, storage });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.recoverable, true);
  assert.equal(failure?.page, 2);
  assert.strictEqual(visibleCollection, lastKnown);
  assert.equal(getAcknowledgedCompletedPackOverlays(DESKTOP_OVERLAY_KEY, TEST_USER.id, storage).length, 1);
});

test("malformed and empty response bodies are failures, not complete empty snapshots", async () => {
  const client = makeClient(makeRows(20), { malformedPages: new Set([0]) });
  await assert.rejects(
    loadDesktopCollection({ client, user: TEST_USER, storage: new MemoryStorage() }),
    (error) => error.code === "COLLECTION_SNAPSHOT_MALFORMED_RESPONSE"
  );
});

test("acknowledged overlay remains until a complete snapshot proves every card is present", async () => {
  const storage = makeAcknowledgedOverlayStorage(MOBILE_OVERLAY_KEY);
  await loadMobileCollection({
    client: makeClient(makeRows(3)),
    user: TEST_USER,
    storage,
  });
  assert.equal(getAcknowledgedCompletedPackOverlays(MOBILE_OVERLAY_KEY, TEST_USER.id, storage).length, 1);

  const rowsWithOverlayCard = [
    ...makeRows(3),
    {
      user_id: TEST_USER.id,
      set_id: "set-00",
      card_id: "overlay-card",
      quantity: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    },
  ];
  await loadMobileCollection({
    client: makeClient(rowsWithOverlayCard),
    user: TEST_USER,
    storage,
  });
  assert.equal(getAcknowledgedCompletedPackOverlays(MOBILE_OVERLAY_KEY, TEST_USER.id, storage).length, 0);
});

test("a slower stale refresh cannot overwrite a newer complete snapshot", async () => {
  const loader = createCollectionSnapshotLoader();
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let firstRequestStarted;
  const firstStarted = new Promise((resolve) => { firstRequestStarted = resolve; });
  const client = makeClient(makeRows(1001), {
    deferRequest: async ({ currentRequest }) => {
      if (currentRequest === 0) {
        firstRequestStarted();
        await firstBlocked;
      }
    },
  });

  const older = loader.load({ client, userId: TEST_USER.id });
  await firstStarted;
  const newer = loader.load({ client, userId: TEST_USER.id });
  const newerSnapshot = await newer;
  releaseFirst();
  await assert.rejects(older, (error) => error.code === COLLECTION_SNAPSHOT_STALE_CODE);
  assert.equal(newerSnapshot.rows.length, 1001);
  assert.equal(loader.isCurrent(newerSnapshot), true);
});

test("account switch during pagination invalidates old pages and cannot merge users", async () => {
  const loader = createCollectionSnapshotLoader();
  const rows = [...makeRows(1001, "account-a"), ...makeRows(37, "account-b")];
  let releaseAccountA;
  const accountABlocked = new Promise((resolve) => { releaseAccountA = resolve; });
  let accountAStarted;
  const accountARequestStarted = new Promise((resolve) => { accountAStarted = resolve; });
  const client = makeClient(rows, {
    deferRequest: async ({ currentRequest }) => {
      if (currentRequest === 0) {
        accountAStarted();
        await accountABlocked;
      }
    },
  });

  const accountA = loader.load({ client, userId: "account-a" });
  await accountARequestStarted;
  const accountB = await loader.load({ client, userId: "account-b" });
  releaseAccountA();
  await assert.rejects(accountA, (error) => error.code === COLLECTION_SNAPSHOT_STALE_CODE);
  assert.equal(accountB.userId, "account-b");
  assert.equal(accountB.rows.length, 37);
  assert.ok(accountB.rows.every((row) => row.user_id === "account-b"));
});

test("duplicate rows at page boundaries are rejected", async () => {
  const rows = makeRows(1001);
  rows[500] = { ...rows[499] };
  const client = makeClient(rows);
  await assert.rejects(
    loadDesktopCollection({ client, user: TEST_USER, storage: new MemoryStorage() }),
    (error) => error.code === "COLLECTION_SNAPSHOT_DUPLICATE_ROW"
  );
});

test("desktop and mobile app failure paths publish only complete current snapshots", async () => {
  const [desktopSource, mobileSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8"),
  ]);
  const desktopFailure = desktopSource.slice(
    desktopSource.indexOf('.catch((error) => {\n        console.warn("Cloud collection load failed"'),
    desktopSource.indexOf("loadPersistedBinders(userId)")
  );
  assert.doesNotMatch(desktopFailure, /setCollection\(/);
  assert.match(desktopSource, /isCloudCollectionSnapshotCurrent\(cloudCollection, userId\)/);
  assert.match(mobileSource, /if \(collectionLoaded\) \{\s*setCollection\(mergedCollection\)/);
  assert.match(mobileSource, /accountStateLoadGenerationRef\.current === loadGeneration/);
  assert.match(mobileSource, /invalidateCloudCollectionLoads\(\)/);
});
