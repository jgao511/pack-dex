import assert from "node:assert/strict";
import test from "node:test";
import {
  FUNCTION_DEADLINE_MS,
  UPSTREAM_GROUP_CONCURRENCY,
  UPSTREAM_SET_TIMEOUT_MS,
  runBoundedGroups,
  shouldRetryUpstream,
} from "../supabase/functions/refresh-pokemon-prices/boundedGroups.js";

function abortableDelay(delayMs, signal, value) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

test("upstream groups overlap without exceeding the named concurrency limit", async (t) => {
  let active = 0;
  let observedMax = 0;
  const startedAt = Date.now();
  const result = await runBoundedGroups(Array.from({ length: 5 }, (_, id) => ({ id })), async (group, { signal }) => {
    active += 1;
    observedMax = Math.max(observedMax, active);
    try { return await abortableDelay(60, signal, group.id); }
    finally { active -= 1; }
  }, { concurrency: UPSTREAM_GROUP_CONCURRENCY, perGroupTimeoutMs: 500, deadlineMs: 1_000 });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.successes.length, 5);
  assert.equal(result.failures.length, 0);
  assert.equal(result.maxActive, UPSTREAM_GROUP_CONCURRENCY);
  assert.equal(observedMax, UPSTREAM_GROUP_CONCURRENCY);
  assert.ok(elapsed < 240, `bounded concurrent execution took ${elapsed}ms`);
  t.diagnostic(`5 groups × 60ms completed in ${elapsed}ms with max concurrency ${observedMax}`);
});

test("ten independent groups execute in bounded waves rather than serially", async (t) => {
  const startedAt = Date.now();
  const result = await runBoundedGroups(Array.from({ length: 10 }, (_, id) => ({ id })), (group, { signal }) => abortableDelay(50, signal, group.id), { concurrency: 3, perGroupTimeoutMs: 500, deadlineMs: 1_000 });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.successes.length, 10);
  assert.equal(result.maxActive, 3);
  assert.ok(elapsed >= 150 && elapsed < 300, `expected four bounded waves, observed ${elapsed}ms`);
  t.diagnostic(`10 groups × 50ms completed in ${elapsed}ms`);
});

test("one slow group is aborted while completed groups remain usable", async () => {
  const groups = [{ id: "slow" }, { id: "a" }, { id: "b" }, { id: "c" }];
  const result = await runBoundedGroups(groups, (group, { signal }) => abortableDelay(group.id === "slow" ? 500 : 20, signal, group.id), { concurrency: 3, perGroupTimeoutMs: 75, deadlineMs: 150 });
  assert.deepEqual(result.successes.map(({ value }) => value).sort(), ["a", "b", "c"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, "upstream_timeout");
  assert.ok(result.durationMs < 140);
});

test("one upstream 504 produces a failed group without discarding successes", async () => {
  const result = await runBoundedGroups([{ id: "ok-1" }, { id: "bad" }, { id: "ok-2" }], async (group) => {
    if (group.id === "bad") throw Object.assign(new Error("gateway"), { status: 504 });
    return [{ card_id: group.id }];
  }, { concurrency: 3, perGroupTimeoutMs: 100, deadlineMs: 200 });
  assert.equal(result.successes.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, "upstream_http_504");
  assert.deepEqual(result.successes.flatMap(({ value }) => value).map((row) => row.card_id).sort(), ["ok-1", "ok-2"]);
});

test("eight healthy groups finish while one timeout is bounded", async (t) => {
  const groups = [{ id: "slow" }, ...Array.from({ length: 8 }, (_, index) => ({ id: `ok-${index}` }))];
  const startedAt = Date.now();
  const result = await runBoundedGroups(groups, (group, { signal }) => abortableDelay(group.id === "slow" ? 500 : 25, signal, group.id), { concurrency: 3, perGroupTimeoutMs: 110, deadlineMs: 250 });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.successes.length, 8);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, "upstream_timeout");
  assert.ok(elapsed < 190);
  t.diagnostic(`8 healthy groups + 1 timeout completed in ${elapsed}ms`);
});

test("all failed groups return promptly with no false successes", async (t) => {
  const startedAt = Date.now();
  const result = await runBoundedGroups(Array.from({ length: 6 }, (_, id) => ({ id })), async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); }, { concurrency: 3, perGroupTimeoutMs: 100, deadlineMs: 250 });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.successes.length, 0);
  assert.equal(result.failures.length, 6);
  assert.ok(result.failures.every(({ reason }) => reason === "upstream_http_503"));
  t.diagnostic(`6 failed groups returned in ${elapsed}ms`);
});

test("the total deadline aborts unfinished work and returns cleanly", async () => {
  const startedAt = Date.now();
  const result = await runBoundedGroups([{ id: 1 }, { id: 2 }, { id: 3 }], (group, { signal }) => abortableDelay(500, signal, group.id), { concurrency: 3, perGroupTimeoutMs: 1_000, deadlineMs: 65 });
  assert.equal(result.successes.length, 0);
  assert.equal(result.failures.length, 3);
  assert.ok(result.failures.every(({ reason }) => reason === "function_deadline"));
  assert.ok(Date.now() - startedAt < 180);
});

test("retry policy allows at most one transient retry with sufficient budget", () => {
  assert.equal(shouldRetryUpstream({ status: 504, attempt: 0, remainingMs: 4_000 }), true);
  assert.equal(shouldRetryUpstream({ status: 429, attempt: 0, retryAfterMs: 500, remainingMs: 2_000 }), true);
  assert.equal(shouldRetryUpstream({ status: 504, attempt: 1, remainingMs: 4_000 }), false);
  assert.equal(shouldRetryUpstream({ status: 504, attempt: 0, remainingMs: 1_000 }), false);
  assert.equal(shouldRetryUpstream({ status: 404, attempt: 0, remainingMs: 4_000 }), false);
});

test("production timing constants stay within the approved bounds", () => {
  assert.ok([3, 4].includes(UPSTREAM_GROUP_CONCURRENCY));
  assert.ok(UPSTREAM_SET_TIMEOUT_MS >= 5_000 && UPSTREAM_SET_TIMEOUT_MS <= 7_000);
  assert.ok(FUNCTION_DEADLINE_MS >= 10_000 && FUNCTION_DEADLINE_MS <= 12_000);
});
