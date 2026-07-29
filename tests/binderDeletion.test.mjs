import assert from "node:assert/strict";
import test from "node:test";
import { deletePersistedBinder } from "../src/lib/binderPersistence.js";

function createLocalStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("guest binder deletion removes only the selected binder and preserves Collection quantities", async () => {
  const localStorage = createLocalStorage();
  globalThis.window = { localStorage };

  const collection = {
    sample_set: {
      "sample-card": { count: 3, firstCollectedAt: 10, lastCollectedAt: 20 },
    },
  };
  const collectionBeforeDelete = structuredClone(collection);
  const binders = [
    {
      id: "keep-binder",
      name: "Keep",
      tag: "Custom Binder",
      type: "custom",
      cards: [],
    },
    {
      id: "delete-binder",
      name: "Delete",
      tag: "Custom Binder",
      type: "custom",
      cards: [
        {
          key: "sample_set::sample-card",
          setId: "sample_set",
          cardId: "sample-card",
          order: 0,
        },
      ],
    },
  ];

  try {
    const remaining = await deletePersistedBinder({
      userId: "",
      binderId: "delete-binder",
      binders,
    });

    assert.deepEqual(remaining.map((binder) => binder.id), ["keep-binder"]);
    assert.deepEqual(collection, collectionBeforeDelete);

    const stored = JSON.parse(localStorage.getItem("packdex-binders"));
    assert.deepEqual(stored.binders.map((binder) => binder.id), ["keep-binder"]);
  } finally {
    delete globalThis.window;
  }
});

test("deleting the last binder stays deleted after the shared local refresh", async () => {
  const localStorage = createLocalStorage();
  localStorage.setItem("packdex-binder-cards", JSON.stringify([
    {
      key: "sample_set::sample-card",
      setId: "sample_set",
      cardId: "sample-card",
      order: 0,
    },
  ]));
  globalThis.window = { localStorage };

  try {
    const remaining = await deletePersistedBinder({
      userId: "",
      binderId: "only-binder",
      binders: [
        {
          id: "only-binder",
          name: "Only Binder",
          tag: "Custom Binder",
          type: "custom",
          cards: [],
        },
      ],
    });

    assert.deepEqual(remaining, []);
    assert.deepEqual(JSON.parse(localStorage.getItem("packdex-binders")), { binders: [] });
  } finally {
    delete globalThis.window;
  }
});
