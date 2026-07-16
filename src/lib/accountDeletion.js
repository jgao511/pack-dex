const ACCOUNT_LOCAL_STORAGE_KEYS = [
  "pokemon-pack-simulator-collection",
  "packdex-binders",
  "packdex-binder-cards",
  "packdex-active-binder-id",
  "packdex-master-binder-cover-colors",
  "packdex-profile-stats",
  "packdex-theme",
  "packdex-mobile-collection-era-filter",
  "packdex-mobile-haptics-enabled",
  "packdex-mobile-intro-seen",
  "packdex_guest_welcome_beta_seen",
];

const PENDING_PULL_STORAGE_KEYS = ["packdex-pending-cloud-pulls", "packdex-mobile-pending-cloud-pulls"];
const USER_WELCOME_KEY_PREFIX = "packdex_welcome_beta_seen_";

function parsePendingPulls(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearDeletedAccountLocalState(userId, storage = typeof window === "undefined" ? null : window.localStorage) {
  if (!storage) return;

  ACCOUNT_LOCAL_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
  storage.removeItem(`${USER_WELCOME_KEY_PREFIX}${userId}`);

  PENDING_PULL_STORAGE_KEYS.forEach((key) => {
    const remainingPulls = parsePendingPulls(storage.getItem(key)).filter((pull) => String(pull?.userId || "") !== String(userId));

    if (remainingPulls.length === 0) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, JSON.stringify(remainingPulls));
    }
  });
}

export async function deleteCurrentAccount(client) {
  if (!client) throw new Error("Account deletion is unavailable until Supabase is configured.");

  const { data, error } = await client.functions.invoke("delete-account", { body: {} });

  if (error) throw error;
  if (!data?.deleted) throw new Error(data?.error || "PackDex could not delete this account.");

  return data;
}
