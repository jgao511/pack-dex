export function withAsyncTimeout(promise, {
  timeoutMs = 12000,
  label = "Operation",
} = {}) {
  let timeoutId = 0;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => globalThis.clearTimeout(timeoutId));
}
