import { supabase } from "./supabaseClient.js";

export const PUBLIC_STATS_CACHE_KEY = "packdex_public_stats_v1";
export const PUBLIC_STATS_CACHE_TTL_MS = 10 * 60 * 1000;

function getDefaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function normalizePublicPackDexStats(value) {
  const row = Array.isArray(value) ? value[0] : value;
  const cardsPulled = Number(row?.cards_pulled ?? row?.cardsPulled);
  const rawPacksOpened = row?.packs_opened ?? row?.packsOpened;
  const packsOpened = rawPacksOpened == null ? null : Number(rawPacksOpened);

  if (!Number.isFinite(cardsPulled) || cardsPulled < 0) return null;
  if (packsOpened != null && (!Number.isFinite(packsOpened) || packsOpened < 0)) return null;

  return {
    cardsPulled: Math.trunc(cardsPulled),
    packsOpened: packsOpened == null ? null : Math.trunc(packsOpened),
    updatedAt: row?.updated_at || row?.updatedAt || null,
  };
}

export function formatPublicStat(value, locale) {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.trunc(Number(value) || 0)));
}

export function readCachedPublicPackDexStats({
  storage = getDefaultStorage(),
  now = Date.now(),
} = {}) {
  if (!storage) return null;

  try {
    const cached = JSON.parse(storage.getItem(PUBLIC_STATS_CACHE_KEY) || "null");
    const stats = normalizePublicPackDexStats(cached?.stats);
    const cachedAt = Number(cached?.cachedAt);

    if (!stats || !Number.isFinite(cachedAt) || cachedAt <= 0) return null;

    return {
      stats,
      cachedAt,
      isFresh: now - cachedAt < PUBLIC_STATS_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function writeCachedPublicPackDexStats(stats, { storage, now }) {
  if (!storage) return;

  try {
    storage.setItem(PUBLIC_STATS_CACHE_KEY, JSON.stringify({ stats, cachedAt: now }));
  } catch {
    // A full or unavailable browser store should not affect the welcome page.
  }
}

let activeRequest = null;

export async function getPublicPackDexStats({
  client = supabase,
  storage = getDefaultStorage(),
  now = Date.now(),
  force = false,
} = {}) {
  const cached = readCachedPublicPackDexStats({ storage, now });

  if (!force && cached?.isFresh) return cached.stats;
  if (!client) return cached?.stats || null;
  if (activeRequest) return activeRequest;

  activeRequest = (async () => {
    const { data, error } = await client.rpc("get_public_packdex_stats");

    if (error) {
      if (cached?.stats) return cached.stats;
      throw error;
    }

    const stats = normalizePublicPackDexStats(data);
    if (!stats) {
      if (cached?.stats) return cached.stats;
      throw new Error("PackDex public stats returned an invalid response.");
    }

    writeCachedPublicPackDexStats(stats, { storage, now });
    return stats;
  })().finally(() => {
    activeRequest = null;
  });

  return activeRequest;
}
