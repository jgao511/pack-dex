export const ACHIEVEMENT_RECONCILIATION_TTL_MS = 30_000;

const reconciliationCacheByUserId = new Map();
const reconciliationInFlightByUserId = new Map();
const reconciliationVersionByUserId = new Map();
let reconciliationGlobalVersion = 0;

function normalizeUserId(userId) {
  return String(userId || "");
}

function getReconciliationVersion(userId) {
  return `${reconciliationGlobalVersion}:${reconciliationVersionByUserId.get(userId) || 0}`;
}

function withoutAwardReplay(result = {}) {
  return {
    ...result,
    awarded: [],
  };
}

export function invalidateAchievementReconciliation(userId = "") {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;

  reconciliationVersionByUserId.set(
    normalizedUserId,
    (reconciliationVersionByUserId.get(normalizedUserId) || 0) + 1
  );
  reconciliationCacheByUserId.delete(normalizedUserId);
  reconciliationInFlightByUserId.delete(normalizedUserId);
}

export function clearAchievementReconciliationCache() {
  reconciliationGlobalVersion += 1;
  reconciliationCacheByUserId.clear();
  reconciliationInFlightByUserId.clear();
  reconciliationVersionByUserId.clear();
}

export async function runAchievementReconciliation({
  userId,
  load,
  now = Date.now(),
  ttlMs = ACHIEVEMENT_RECONCILIATION_TTL_MS,
} = {}) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId || typeof load !== "function") {
    return { progress: [], awarded: [] };
  }

  const cached = reconciliationCacheByUserId.get(normalizedUserId);
  if (cached && cached.expiresAt > now) return cached.result;
  if (cached) reconciliationCacheByUserId.delete(normalizedUserId);

  const existingFlight = reconciliationInFlightByUserId.get(normalizedUserId);
  if (existingFlight) {
    return existingFlight.promise.then(withoutAwardReplay);
  }

  const version = getReconciliationVersion(normalizedUserId);
  const promise = Promise.resolve()
    .then(load)
    .then((result) => {
      const normalizedResult = result && typeof result === "object"
        ? result
        : { progress: [], awarded: [] };

      if (getReconciliationVersion(normalizedUserId) === version) {
        reconciliationCacheByUserId.set(normalizedUserId, {
          expiresAt: now + Math.max(0, Number(ttlMs) || 0),
          result: withoutAwardReplay(normalizedResult),
        });
      }

      return normalizedResult;
    });

  reconciliationInFlightByUserId.set(normalizedUserId, { promise, version });

  try {
    return await promise;
  } finally {
    const currentFlight = reconciliationInFlightByUserId.get(normalizedUserId);
    if (currentFlight?.promise === promise) {
      reconciliationInFlightByUserId.delete(normalizedUserId);
    }
  }
}
