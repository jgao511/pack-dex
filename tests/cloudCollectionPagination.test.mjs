import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_COLLECTION_COLUMNS,
  CLOUD_COLLECTION_PAGE_SIZE,
  loadCloudCollectionPages,
} from "../src/lib/cloudCollectionPagination.js";
import { appendCloudRowsToCollection as appendDesktopRows } from "../src/lib/cloudCollection.js";
import { appendCloudRowsToCollection as appendMobileRows } from "../mobile-app/src/lib/cloudCollection.js";

class CollectionQuery {
  constructor(client) {
    this.client = client;
    this.orders = [];
  }

  select(columns) {
    this.columns = columns;
    return this;
  }

  eq(column, value) {
    this.filter = [column, value];
    return this;
  }

  order(column, options) {
    this.orders.push([column, options]);
    return this;
  }

  async range(from, to) {
    const pageSize = to - from + 1;
    const remaining = Math.max(0, this.client.totalRows - from);
    const rowCount = Math.min(pageSize, remaining);
    const data = rowCount === pageSize
      ? this.client.fullPage
      : this.client.fullPage.slice(0, rowCount);

    this.client.calls.push({
      table: this.table,
      columns: this.columns,
      filter: this.filter,
      orders: this.orders,
      from,
      to,
    });

    if (this.client.failAtFrom === from) {
      return { data: null, error: new Error("page failed") };
    }

    return { data, error: null };
  }
}

class CollectionClient {
  constructor(totalRows, { failAtFrom = -1 } = {}) {
    this.totalRows = totalRows;
    this.failAtFrom = failAtFrom;
    this.calls = [];
    this.fullPage = Array.from({ length: CLOUD_COLLECTION_PAGE_SIZE }, (_, index) => ({
      id: `row-${index}`,
      set_id: "stress-set",
      card_id: `card-${index}`,
      quantity: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }));
  }

  from(table) {
    const query = new CollectionQuery(this);
    query.table = table;
    return query;
  }
}

test("collection pagination restores every row beyond Supabase's first 1,000", async () => {
  const client = new CollectionClient(1151);
  let loadedRows = 0;

  const totalRows = await loadCloudCollectionPages(client, "support-account", (page) => {
    loadedRows += page.length;
  });

  assert.equal(totalRows, 1151);
  assert.equal(loadedRows, 1151);
  assert.deepEqual(client.calls.map(({ from, to }) => [from, to]), [
    [0, 999],
    [1000, 1999],
  ]);
  assert.equal(client.calls[0].table, "user_collection");
  assert.equal(client.calls[0].columns, CLOUD_COLLECTION_COLUMNS);
  assert.deepEqual(client.calls[0].filter, ["user_id", "support-account"]);
  assert.deepEqual(client.calls[0].orders, [
    ["created_at", { ascending: true }],
    ["id", { ascending: true }],
  ]);
});

test("an exact page multiple fetches the terminating empty page without truncation", async () => {
  const client = new CollectionClient(2000);

  assert.equal(await loadCloudCollectionPages(client, "exact-page-user", () => {}), 2000);
  assert.deepEqual(client.calls.map(({ from, to }) => [from, to]), [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test("a later page failure rejects the whole collection load", async () => {
  const client = new CollectionClient(2500, { failAtFrom: 1000 });

  await assert.rejects(
    loadCloudCollectionPages(client, "failed-page-user", () => {}),
    /page failed/
  );
});

test("pagination has no hidden cap at one million rows", async () => {
  const client = new CollectionClient(1_000_000);
  let loadedRows = 0;

  const totalRows = await loadCloudCollectionPages(client, "million-row-user", (page) => {
    loadedRows += page.length;
  });

  assert.equal(totalRows, 1_000_000);
  assert.equal(loadedRows, 1_000_000);
  assert.equal(client.calls.length, 1001);
  assert.deepEqual(
    [client.calls.at(-1).from, client.calls.at(-1).to],
    [1_000_000, 1_000_999]
  );
});

test("desktop and iOS preserve one million owned cards without quadratic conversion", () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => ({
    set_id: `set-${Math.floor(index / 250)}`,
    card_id: `card-${index}`,
    quantity: 100,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
  }));

  for (const appendRows of [appendDesktopRows, appendMobileRows]) {
    const collection = appendRows({}, rows);
    const entries = Object.values(collection).flatMap((set) => Object.values(set));

    assert.equal(entries.length, 10_000);
    assert.equal(entries.reduce((total, entry) => total + entry.count, 0), 1_000_000);
  }
});
