import assert from "node:assert/strict";
import test from "node:test";
import {
  ACHIEVEMENT_RECONCILIATION_TTL_MS,
  clearAchievementReconciliationCache,
  invalidateAchievementReconciliation,
  runAchievementReconciliation,
} from "../src/lib/achievementReconciliationCache.js";

function result(id = "value_10") {
  return {
    progress: [{ achievementId: id, progressCurrent: 10, progressTarget: 10 }],
    awarded: [{ achievementId: id }],
  };
}

test("simultaneous reconciliation calls for one user share one request", async () => {
  clearAchievementReconciliationCache();
  let calls = 0;
  let resolveLoad;
  const load = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveLoad = resolve;
    });
  };

  const first = runAchievementReconciliation({ userId: "user-1", load, now: 1_000 });
  const joined = runAchievementReconciliation({ userId: "user-1", load, now: 1_000 });
  await Promise.resolve();

  assert.equal(calls, 1);
  resolveLoad(result());
  const [firstResult, joinedResult] = await Promise.all([first, joined]);

  assert.equal(firstResult.awarded.length, 1);
  assert.deepEqual(joinedResult.progress, firstResult.progress);
  assert.deepEqual(joinedResult.awarded, [], "joined callers must not replay unlock notifications");
});

test("successful reconciliation is cached per user for thirty seconds", async () => {
  clearAchievementReconciliationCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return result();
  };

  const first = await runAchievementReconciliation({ userId: "user-1", load, now: 5_000 });
  const repeated = [];
  for (let index = 1; index <= 10; index += 1) {
    repeated.push(await runAchievementReconciliation({ userId: "user-1", load, now: 5_000 + index }));
  }

  assert.equal(ACHIEVEMENT_RECONCILIATION_TTL_MS, 30_000);
  assert.equal(calls, 1);
  assert.equal(first.awarded.length, 1);
  repeated.forEach((cached) => {
    assert.deepEqual(cached.progress, first.progress);
    assert.deepEqual(cached.awarded, []);
  });
});

test("expired and failed reconciliation results are never reused", async () => {
  clearAchievementReconciliationCache();
  let successfulCalls = 0;
  const load = async () => {
    successfulCalls += 1;
    return result();
  };

  await runAchievementReconciliation({ userId: "user-1", load, now: 10_000 });
  await runAchievementReconciliation({
    userId: "user-1",
    load,
    now: 10_000 + ACHIEVEMENT_RECONCILIATION_TTL_MS,
  });
  assert.equal(successfulCalls, 2);

  clearAchievementReconciliationCache();
  let failedCalls = 0;
  const fail = async () => {
    failedCalls += 1;
    throw new Error("temporary failure");
  };
  await assert.rejects(runAchievementReconciliation({ userId: "user-2", load: fail }));
  await assert.rejects(runAchievementReconciliation({ userId: "user-2", load: fail }));
  assert.equal(failedCalls, 2);
});

test("collection changes invalidate only the affected user's cached result", async () => {
  clearAchievementReconciliationCache();
  const calls = new Map();
  const loadFor = (userId) => async () => {
    calls.set(userId, (calls.get(userId) || 0) + 1);
    return result(`${userId}-value`);
  };

  await runAchievementReconciliation({ userId: "user-1", load: loadFor("user-1"), now: 20_000 });
  await runAchievementReconciliation({ userId: "user-2", load: loadFor("user-2"), now: 20_000 });
  invalidateAchievementReconciliation("user-1");
  await runAchievementReconciliation({ userId: "user-1", load: loadFor("user-1"), now: 20_001 });
  await runAchievementReconciliation({ userId: "user-2", load: loadFor("user-2"), now: 20_001 });

  assert.equal(calls.get("user-1"), 2);
  assert.equal(calls.get("user-2"), 1);
});

test("cached reconciliation results are never reused across user identities", async () => {
  clearAchievementReconciliationCache();
  let userOneCalls = 0;
  let userTwoCalls = 0;

  const userOne = await runAchievementReconciliation({
    userId: "user-1",
    now: 25_000,
    load: async () => {
      userOneCalls += 1;
      return result("user-1-achievement");
    },
  });
  const userTwo = await runAchievementReconciliation({
    userId: "user-2",
    now: 25_001,
    load: async () => {
      userTwoCalls += 1;
      return result("user-2-achievement");
    },
  });

  assert.equal(userOneCalls, 1);
  assert.equal(userTwoCalls, 1);
  assert.equal(userOne.progress[0].achievementId, "user-1-achievement");
  assert.equal(userTwo.progress[0].achievementId, "user-2-achievement");
});

test("logout and account-switch clearing prevents cached state reuse", async () => {
  clearAchievementReconciliationCache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return result();
  };

  await runAchievementReconciliation({ userId: "user-1", load, now: 30_000 });
  clearAchievementReconciliationCache();
  await runAchievementReconciliation({ userId: "user-1", load, now: 30_001 });

  assert.equal(calls, 2);
});

test("invalidation during a request prevents the stale result from being cached", async () => {
  clearAchievementReconciliationCache();
  let calls = 0;
  let resolveFirst;
  const first = runAchievementReconciliation({
    userId: "user-1",
    now: 40_000,
    load: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    },
  });
  await Promise.resolve();
  invalidateAchievementReconciliation("user-1");
  resolveFirst(result("stale"));
  await first;

  const fresh = await runAchievementReconciliation({
    userId: "user-1",
    now: 40_001,
    load: async () => {
      calls += 1;
      return result("fresh");
    },
  });

  assert.equal(calls, 2);
  assert.equal(fresh.progress[0].achievementId, "fresh");
});
