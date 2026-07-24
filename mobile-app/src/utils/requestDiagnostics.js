const counters = new Map();

export function countDevRequest(name) {
  if (!import.meta.env?.DEV) return;
  const next = (counters.get(name) || 0) + 1;
  counters.set(name, next);
  console.info(`[PackDex request count] ${name}: ${next}`);
}
