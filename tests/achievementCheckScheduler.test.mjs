import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clearAchievementCheckScheduler,
  resetAchievementCheckSchedulerForTests,
  scheduleAchievementCheck,
} from "../src/lib/achievementCheckScheduler.js";
import {
  enqueuePendingCloudPull,
  syncPendingCloudPulls,
} from "../mobile-app/src/lib/cloudCollection.js";

class MemoryStorage {
  constructor() { this.entries = new Map(); }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  setItem(key, value) { this.entries.set(key, String(value)); }
  removeItem(key) { this.entries.delete(key); }
}

function progression(packsOpened, totalCardsPulled = packsOpened * 10) {
  return { packsOpened, totalCardsPulled };
}

function makeInvoke({ failures = 0 } = {}) {
  const calls = [];
  return {
    calls,
    invoke: async (options) => {
      calls.push(structuredClone(options));
      if (calls.length <= failures) {
        return { data: null, error: { status: 503, message: "temporarily unavailable" } };
      }
      return {
        data: {
          awarded: [],
          progressionFingerprint: `server:${calls.length}`,
          requestId: options.body.request_id,
        },
        error: null,
      };
    },
  };
}

function schedule({ userId = "user-1", value = progression(1), storage = new MemoryStorage(), invoke, ...options }) {
  return scheduleAchievementCheck({
    userId,
    progression: value,
    storage,
    invoke,
    coalesceMs: 0,
    retryBaseMs: 0,
    ...options,
  });
}

test.beforeEach(() => resetAchievementCheckSchedulerForTests());

test("one durable pack and rapid repeated input produce at most one achievement POST", async () => {
  const storage = new MemoryStorage();
  const transport = makeInvoke();
  const requests = Array.from({ length: 25 }, () => schedule({ storage, invoke: transport.invoke }));
  await Promise.all(requests);
  assert.equal(transport.calls.length, 1);
});

test("optimistic update plus server confirmation shares one progression check", async () => {
  const storage = new MemoryStorage();
  const transport = makeInvoke();
  await Promise.all([
    schedule({ storage, invoke: transport.invoke, value: progression(4, 40) }),
    schedule({ storage, invoke: transport.invoke, value: progression(4, 40) }),
  ]);
  assert.equal(transport.calls.length, 1);
});

test("component remount and auth initialization reuse the persisted successful fingerprint", async () => {
  const storage = new MemoryStorage();
  const transport = makeInvoke();
  await schedule({ storage, invoke: transport.invoke, value: progression(8, 80) });
  resetAchievementCheckSchedulerForTests();
  await schedule({ storage, invoke: transport.invoke, value: progression(8, 80) });
  assert.equal(transport.calls.length, 1);
});

test("two simultaneous callers share one in-flight network request", async () => {
  const storage = new MemoryStorage();
  let release;
  let calls = 0;
  const invoke = async (options) => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    return { data: { awarded: [], requestId: options.body.request_id }, error: null };
  };
  const first = schedule({ storage, invoke });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = schedule({ storage, invoke });
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("a durable mutation is not swallowed by an older profile check already in flight", async () => {
  const storage = new MemoryStorage();
  const calls = [];
  let releaseProfile;
  const invoke = async (options) => {
    calls.push(structuredClone(options));
    if (calls.length === 1) {
      await new Promise((resolve) => { releaseProfile = resolve; });
    }
    return { data: { awarded: [], requestId: options.body.request_id }, error: null };
  };

  const profileCheck = schedule({
    storage,
    invoke,
    scope: "profile_reconcile",
    value: progression(5),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const durableCheck = schedule({ storage, invoke, value: progression(6) });
  assert.equal(calls.length, 1);
  releaseProfile();
  await Promise.all([profileCheck, durableCheck]);
  assert.deepEqual(calls.map((call) => call.body.scope), ["profile_reconcile", "pack_and_collection"]);
});

test("a collection mutation invalidates richer profile reconciliation state", async () => {
  const storage = new MemoryStorage();
  const transport = makeInvoke();
  const value = progression(5);
  await schedule({ storage, invoke: transport.invoke, scope: "profile_reconcile", value });
  await schedule({ storage, invoke: transport.invoke, value });
  await schedule({ storage, invoke: transport.invoke, scope: "profile_reconcile", value });
  assert.equal(transport.calls.length, 3);
});

test("transient retries are bounded and preserve one request identity", async () => {
  const storage = new MemoryStorage();
  const transport = makeInvoke({ failures: 99 });
  await assert.rejects(schedule({ storage, invoke: transport.invoke, maxAttempts: 3 }));
  assert.equal(transport.calls.length, 3);
  assert.equal(new Set(transport.calls.map((call) => call.body.request_id)).size, 1);
});

test("successful empty results are not retried", async () => {
  const storage = new MemoryStorage();
  const transport = makeInvoke();
  await schedule({ storage, invoke: transport.invoke });
  assert.equal(transport.calls.length, 1);
});

test("account changes never reuse another user's fingerprint cache", async () => {
  const storage = new MemoryStorage();
  const transport = makeInvoke();
  await schedule({ userId: "user-a", storage, invoke: transport.invoke, value: progression(2) });
  await schedule({ userId: "user-b", storage, invoke: transport.invoke, value: progression(2) });
  assert.equal(transport.calls.length, 2);
  clearAchievementCheckScheduler("user-a", { storage });
});

test("a genuine later progression state triggers a new check", async () => {
  const storage = new MemoryStorage();
  const transport = makeInvoke();
  await schedule({ storage, invoke: transport.invoke, value: progression(2) });
  await schedule({ storage, invoke: transport.invoke, value: progression(3) });
  assert.equal(transport.calls.length, 2);
});

test("ten queued packs flush completely before one achievement check", async () => {
  const storage = new MemoryStorage();
  const card = { id: "base1-4", name: "Charizard", rarity: "Rare Holo" };
  for (let index = 0; index < 10; index += 1) {
    enqueuePendingCloudPull([card], "base-set", "queue-user", `queued-pack-${index}`, {
      storage,
      createdAt: 1_000 + index,
    });
  }

  let rpcCalls = 0;
  let achievementPosts = 0;
  const client = {
    async rpc(_name, payload) {
      rpcCalls += 1;
      return {
        data: [{
          accepted: true,
          recorded: true,
          already_processed: false,
          retryable: false,
          rejection_code: "",
          client_event_id: payload.batches[0].client_event_id,
          packs_opened: rpcCalls,
          total_cards_pulled: rpcCalls,
        }],
        error: null,
      };
    },
    functions: {
      async invoke() {
        achievementPosts += 1;
        return { data: { awarded: [] }, error: null };
      },
    },
  };

  const result = await syncPendingCloudPulls("queue-user", {
    client,
    storage,
    validateUser: false,
    requestTimeoutMs: 0,
    achievementSchedulerOptions: { storage, coalesceMs: 0, retryBaseMs: 0 },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(result.saved, 10);
  assert.equal(rpcCalls, 10);
  assert.equal(achievementPosts, 1);
});

test("profile and collection navigation, auth bootstrap, and React mount effects do not schedule checks", async () => {
  const source = await readFile(new URL("../mobile-app/src/App.jsx", import.meta.url), "utf8");
  const authBootstrap = source.match(/useEffect\(\(\) => \{\s*let mounted = true;[\s\S]*?\n  \}, \[\]\);/)?.[0] || "";
  const profile = source.match(/function ProfileScreen\([\s\S]*?\n\}/)?.[0] || "";
  const renderSwitch = source.match(/function renderActiveScreen\([\s\S]*?\n  \}/)?.[0] || "";

  assert.doesNotMatch(authBootstrap, /scheduleServerAchievementCheck|check-achievements/);
  assert.doesNotMatch(profile, /scheduleServerAchievementCheck|check-achievements/);
  assert.doesNotMatch(renderSwitch, /scheduleServerAchievementCheck|check-achievements/);
  assert.equal((source.match(/subscribeAchievementCheckResults/g) || []).length, 2);
});

test("Edge Function deduplicates authoritative progression with a service-role-only bounded table", async () => {
  const edge = await readFile(new URL("../supabase/functions/check-achievements/index.ts", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../supabase/migrations/20260805143000_achievement_check_dedup.sql", import.meta.url),
    "utf8"
  );

  assert.match(edge, /makeProgressionFingerprint\(\{[\s\S]*packsOpened[\s\S]*totalCards[\s\S]*uniqueCards/);
  assert.doesNotMatch(edge, /body\?\.progression_fingerprint[^\n]*makeProgressionFingerprint/);
  assert.match(edge, /claimAchievementCheck[\s\S]*server_progression_cache/);
  assert.ok(edge.indexOf("claimAchievementCheck(admin") < edge.indexOf('from("user_achievements")'));
  assert.match(edge, /prune prior achievement check fingerprints/);
  assert.match(migration, /primary key \(user_id, scope, progression_fingerprint\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all[^\n]*anon, authenticated/);
});
