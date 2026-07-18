export const UPSTREAM_GROUP_CONCURRENCY = 3;
export const UPSTREAM_SET_TIMEOUT_MS = 6_500;
export const FUNCTION_DEADLINE_MS = 11_000;
export const MIN_RETRY_REMAINING_MS = 1_500;

const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

export function parseRetryAfterMs(value, now = Date.now()) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1_000));
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export function shouldRetryUpstream({ status, attempt, retryAfterMs = 0, remainingMs }) {
  return attempt === 0
    && TRANSIENT_STATUSES.has(Number(status))
    && retryAfterMs + MIN_RETRY_REMAINING_MS <= remainingMs;
}

export function classifyGroupFailure(error, abortReason = "") {
  if (abortReason === "total_deadline") return "function_deadline";
  if (abortReason === "group_timeout" || error?.name === "AbortError") return "upstream_timeout";
  if (Number(error?.status) > 0) return `upstream_http_${Number(error.status)}`;
  if (error?.code === "upstream_parsing") return "parsing_error";
  if (error?.code === "unsupported_mapping") return "unsupported_mapping";
  if (error?.code === "no_market_data") return "no_market_data";
  return "upstream_error";
}

export function waitForRetry(delayMs, signal) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Request aborted", "AbortError"));
    }, { once: true });
  });
}

export async function runBoundedGroups(groups, worker, {
  concurrency = UPSTREAM_GROUP_CONCURRENCY,
  perGroupTimeoutMs = UPSTREAM_SET_TIMEOUT_MS,
  deadlineMs = FUNCTION_DEADLINE_MS,
  now = Date.now,
} = {}) {
  const queue = [...groups];
  const startedAt = now();
  const deadlineAt = startedAt + deadlineMs;
  const successes = [];
  const failures = [];
  const activeControllers = new Set();
  let cursor = 0;
  let activeCount = 0;
  let maxActive = 0;
  let deadlineReached = false;

  const deadlineTimer = setTimeout(() => {
    deadlineReached = true;
    activeControllers.forEach((controller) => controller.abort("total_deadline"));
  }, deadlineMs);

  async function runNext() {
    while (cursor < queue.length) {
      const group = queue[cursor];
      cursor += 1;
      const remainingMs = deadlineAt - now();
      if (remainingMs <= 0 || deadlineReached) {
        failures.push({ group, reason: "function_deadline" });
        continue;
      }

      const controller = new AbortController();
      activeControllers.add(controller);
      activeCount += 1;
      maxActive = Math.max(maxActive, activeCount);
      const timeoutMs = Math.max(1, Math.min(perGroupTimeoutMs, remainingMs));
      const timeoutReason = remainingMs <= perGroupTimeoutMs ? "total_deadline" : "group_timeout";
      const timeout = setTimeout(() => controller.abort(timeoutReason), timeoutMs);

      try {
        const value = await worker(group, {
          signal: controller.signal,
          deadlineAt,
          remainingMs: () => Math.max(0, deadlineAt - now()),
        });
        successes.push({ group, value });
      } catch (error) {
        failures.push({ group, reason: classifyGroupFailure(error, controller.signal.reason), error });
      } finally {
        clearTimeout(timeout);
        activeControllers.delete(controller);
        activeCount -= 1;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, queue.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  clearTimeout(deadlineTimer);

  return {
    successes,
    failures,
    maxActive,
    durationMs: Math.max(0, now() - startedAt),
    deadlineReached,
  };
}
