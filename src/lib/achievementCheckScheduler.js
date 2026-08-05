const DEFAULT_COALESCE_MS = 4_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 250;
const CACHE_PREFIX = "packdex-achievement-check:v2";

const stateByUserId = new Map();
const resultListeners = new Set();

function defaultStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function normalizedCounter(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : "unknown";
}

function storageKey(userId, scope) {
  return `${CACHE_PREFIX}:${encodeURIComponent(String(userId || ""))}:${encodeURIComponent(scope)}`;
}

function readCachedCheck(storage, userId, scope) {
  if (!storage?.getItem) return null;
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(userId, scope)) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedCheck(storage, userId, scope, value) {
  if (!storage?.setItem) return;
  try {
    storage.setItem(storageKey(userId, scope), JSON.stringify(value));
  } catch {
    // A storage quota/privacy failure must not affect durable progression saves.
  }
}

function removeCachedChecks(storage, userId) {
  if (!storage?.removeItem) return;
  for (const scope of ["pack_and_collection", "profile_reconcile"]) {
    storage.removeItem(storageKey(userId, scope));
  }
}

function removeCachedCheck(storage, userId, scope) {
  if (!storage?.removeItem) return;
  storage.removeItem(storageKey(userId, scope));
}

function withoutAwardReplay(result = {}, source = "shared_in_flight") {
  return {
    ...result,
    awarded: [],
    deduplicated: true,
    deduplicationSource: source,
  };
}

function makeRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `achievement-check:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function functionErrorStatus(error) {
  return Number(error?.context?.status || error?.status || 0);
}

export function isTransientAchievementCheckError(error) {
  const status = functionErrorStatus(error);
  if (status === 429 || status >= 500) return true;
  if (status > 0) return false;
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return name.includes("fetch") || name === "typeerror" ||
    /network|failed to fetch|timed out|timeout|connection/.test(message);
}

export function createAchievementProgressionFingerprint({
  userId,
  scope = "pack_and_collection",
  progression = {},
} = {}) {
  return JSON.stringify({
    version: 2,
    userId: String(userId || ""),
    scope: String(scope || "pack_and_collection"),
    packsOpened: normalizedCounter(progression.packsOpened ?? progression.packs_opened),
    totalCardsPulled: normalizedCounter(progression.totalCardsPulled ?? progression.total_cards_pulled),
    uniqueCards: normalizedCounter(progression.uniqueCards ?? progression.unique_cards),
  });
}

async function invokeWithBoundedRetry(job) {
  let lastError = null;
  for (let attempt = 1; attempt <= job.maxAttempts; attempt += 1) {
    let response;
    try {
      response = await job.invoke({
        body: {
          scope: job.scope,
          progression_fingerprint: job.fingerprint,
          request_id: job.requestId,
          reason: job.reason,
        },
      });
    } catch (error) {
      response = { data: null, error };
    }

    if (!response?.error) return response?.data || {};
    lastError = response.error;
    if (attempt >= job.maxAttempts || !isTransientAchievementCheckError(lastError)) break;
    await job.waitFn(job.retryBaseMs * (2 ** (attempt - 1)));
  }
  throw lastError || new Error("Achievement check failed without a response.");
}

async function invokeUnderCrossContextLock(job) {
  const run = async () => {
    const cached = readCachedCheck(job.storage, job.userId, job.scope);
    if (cached?.fingerprint === job.fingerprint && cached?.result) {
      return withoutAwardReplay(cached.result, "cross_context_cache");
    }
    return invokeWithBoundedRetry(job);
  };

  const locks = typeof navigator === "undefined" ? null : navigator.locks;
  if (!locks?.request) return run();
  const lockName = `packdex-achievement-check:${job.userId}:${job.scope}`;
  return locks.request(lockName, { mode: "exclusive" }, run);
}

function emitFreshResult(userId, result) {
  for (const listener of resultListeners) {
    try {
      listener({ userId, result });
    } catch (error) {
      console.warn("PackDex achievement result listener failed", error);
    }
  }
}

function settleWaiters(waiters, result, error) {
  waiters.forEach((waiter, index) => {
    if (error) waiter.reject(error);
    else waiter.resolve(index === 0 ? result : withoutAwardReplay(result));
  });
}

function scheduleDrain(userId, state, delay) {
  if (state.timer) globalThis.clearTimeout(state.timer);
  state.timer = globalThis.setTimeout(() => {
    state.timer = null;
    drainPendingCheck(userId, state);
  }, Math.max(0, delay));
}

function drainPendingCheck(userId, state) {
  if (!state.pending || state.inFlight) return;
  const job = state.pending;
  state.pending = null;

  const promise = invokeUnderCrossContextLock(job)
    .then((result) => {
      const normalizedResult = result && typeof result === "object" ? result : {};
      const wasFresh = normalizedResult.deduplicationSource !== "cross_context_cache";
      if (!state.cancelled && normalizedResult.pending !== true) {
        writeCachedCheck(job.storage, job.userId, job.scope, {
          fingerprint: job.fingerprint,
          serverFingerprint: String(normalizedResult.progressionFingerprint || ""),
          checkedAt: Date.now(),
          result: withoutAwardReplay(normalizedResult, "persistent_progression_cache"),
        });
      }
      if (!state.cancelled && wasFresh) emitFreshResult(job.userId, normalizedResult);
      settleWaiters(job.waiters, normalizedResult, null);
      return normalizedResult;
    })
    .catch((error) => {
      settleWaiters(job.waiters, null, error);
      throw error;
    })
    .finally(() => {
      if (state.inFlight?.promise === promise) state.inFlight = null;
      if (!state.cancelled && state.pending) {
        scheduleDrain(userId, state, Math.max(0, state.pending.dueAt - Date.now()));
      }
    });

  state.inFlight = { fingerprint: job.fingerprint, scope: job.scope, promise };
  // The per-caller promises carry failures; keep this internal orchestration promise handled.
  promise.catch(() => {});
}

export function scheduleAchievementCheck({
  userId,
  progression = {},
  scope = "pack_and_collection",
  reason = "durable_progression_mutation",
  client,
  invoke = client?.functions?.invoke
    ? (options) => client.functions.invoke("check-achievements", options)
    : null,
  storage = defaultStorage(),
  coalesceMs = DEFAULT_COALESCE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  waitFn = wait,
} = {}) {
  const normalizedUserId = String(userId || "");
  const normalizedScope = scope === "profile_reconcile" ? scope : "pack_and_collection";
  if (!normalizedUserId || typeof invoke !== "function") {
    return Promise.resolve({ awarded: [], skipped: [{ reason: "missing_scheduler_input" }] });
  }

  const fingerprint = createAchievementProgressionFingerprint({
    userId: normalizedUserId,
    scope: normalizedScope,
    progression,
  });
  const cached = readCachedCheck(storage, normalizedUserId, normalizedScope);
  if (cached?.fingerprint === fingerprint && cached?.result) {
    return Promise.resolve(withoutAwardReplay(cached.result, "persistent_progression_cache"));
  }
  if (normalizedScope === "pack_and_collection") {
    // Any new durable collection/progression state can change the richer value
    // and set-mastery reconciliation even when its compact pack counters do not.
    removeCachedCheck(storage, normalizedUserId, "profile_reconcile");
  }

  let state = stateByUserId.get(normalizedUserId);
  if (!state) {
    state = { inFlight: null, pending: null, timer: null, cancelled: false };
    stateByUserId.set(normalizedUserId, state);
  }
  if (state.inFlight?.fingerprint === fingerprint && state.inFlight.scope === normalizedScope) {
    return state.inFlight.promise.then((result) => withoutAwardReplay(result));
  }
  const callerPromise = new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    if (state.pending) {
      state.pending.waiters.push(waiter);
      const combinedScope = state.pending.scope === "profile_reconcile" || normalizedScope === "profile_reconcile"
        ? "profile_reconcile"
        : "pack_and_collection";
      const combinedFingerprint = createAchievementProgressionFingerprint({
        userId: normalizedUserId,
        scope: combinedScope,
        progression,
      });
      if (state.pending.fingerprint !== combinedFingerprint || state.pending.scope !== combinedScope) {
        state.pending.fingerprint = combinedFingerprint;
        state.pending.scope = combinedScope;
        state.pending.progression = progression;
        state.pending.reason = reason;
        state.pending.requestId = makeRequestId();
      }
      return;
    }

    state.pending = {
      userId: normalizedUserId,
      scope: normalizedScope,
      progression,
      fingerprint,
      reason,
      requestId: makeRequestId(),
      invoke,
      storage,
      maxAttempts: Math.max(1, Math.min(3, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS)),
      retryBaseMs: Number.isFinite(Number(retryBaseMs))
        ? Math.max(0, Number(retryBaseMs))
        : DEFAULT_RETRY_BASE_MS,
      waitFn,
      waiters: [waiter],
      dueAt: Date.now() + Math.max(0, Number(coalesceMs) || 0),
    };
  });

  if (!state.inFlight && state.pending && !state.timer) {
    scheduleDrain(normalizedUserId, state, Math.max(0, state.pending.dueAt - Date.now()));
  }
  return callerPromise;
}

export function subscribeAchievementCheckResults(listener) {
  if (typeof listener !== "function") return () => {};
  resultListeners.add(listener);
  return () => resultListeners.delete(listener);
}

export function clearAchievementCheckScheduler(userId = "", {
  storage = defaultStorage(),
  removePersisted = true,
} = {}) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId) return;
  const state = stateByUserId.get(normalizedUserId);
  if (state) state.cancelled = true;
  if (state?.timer) globalThis.clearTimeout(state.timer);
  if (state?.pending) {
    const error = new Error("Achievement check cancelled because the active account changed.");
    settleWaiters(state.pending.waiters, null, error);
  }
  stateByUserId.delete(normalizedUserId);
  if (removePersisted) removeCachedChecks(storage, normalizedUserId);
}

export function resetAchievementCheckSchedulerForTests() {
  for (const [userId] of stateByUserId) {
    clearAchievementCheckScheduler(userId, { storage: null, removePersisted: false });
  }
  resultListeners.clear();
}

export const ACHIEVEMENT_CHECK_COALESCE_MS = DEFAULT_COALESCE_MS;
export const ACHIEVEMENT_CHECK_MAX_ATTEMPTS = DEFAULT_MAX_ATTEMPTS;
