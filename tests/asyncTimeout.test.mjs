import assert from "node:assert/strict";
import test from "node:test";
import { withAsyncTimeout } from "../mobile-app/src/lib/asyncTimeout.js";

test("account hydration timeout preserves successful operations", async () => {
  assert.equal(await withAsyncTimeout(Promise.resolve("ready"), { timeoutMs: 20 }), "ready");
});

test("account hydration timeout rejects a stalled operation", async () => {
  await assert.rejects(
    withAsyncTimeout(new Promise(() => {}), { timeoutMs: 5, label: "Account collection loading" }),
    /Account collection loading timed out\./
  );
});
