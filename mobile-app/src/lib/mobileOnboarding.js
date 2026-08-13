import { activeSets, getSetCardById, sets } from "../../../src/data/sets.js";
import {
  generateNormalPackOnly,
  isCardAllowedInPackSlot,
} from "../../../src/utils/packGenerator.js";
import { isLikelyMobileVisitor } from "../../../src/welcomeEntry.js";
import { supabase } from "./supabaseClient.js";
import {
  MOBILE_ONBOARDING_STATE_KEY,
  MOBILE_ONBOARDING_VERSION,
  MOBILE_ONBOARDING_VERSION_KEY,
} from "./mobileOnboardingBootstrap.js";

export {
  MOBILE_ONBOARDING_STATE_KEY,
  MOBILE_ONBOARDING_VERSION,
  MOBILE_ONBOARDING_VERSION_KEY,
} from "./mobileOnboardingBootstrap.js";

export const MOBILE_ONBOARDING_PENDING_KEY = "packdex_mobile_onboarding_pending_v1";
export const MOBILE_ONBOARDING_DEVICE_KEY = "packdex_mobile_onboarding_device_id";
export const MOBILE_ONBOARDING_GUEST_PACK_KEY = "packdex_mobile_onboarding_guest_pack_v1";
export const MOBILE_ONBOARDING_GUEST_APPLIED_KEY = "packdex_mobile_onboarding_guest_applied_v1";
export const MOBILE_ONBOARDING_COMPLETION_ID = "mobile-onboarding:v1";
export const MOBILE_ONBOARDING_TUTORIAL_EVENT_ID = "mobile-onboarding:v1";
export const MOBILE_ONBOARDING_DESTINATION = "/mobile-app/?tab=profile";
export const MOBILE_ONBOARDING_PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const PENDING_MIGRATION_STATUSES = new Set(["pending", "syncing", "failed"]);

export const TUTORIAL_HIT_POOLS = {
  "151": ["151-166-bulbasaur", "151-175-psyduck", "151-181-dragonair"],
  "prismatic-evolutions": [
    "prismatic-evolutions-147-ceruledge-ex",
    "prismatic-evolutions-156-sylveon-ex",
    "prismatic-evolutions-165-dragapult-ex",
  ],
  "pitch-black": [
    "pitch-black-86-armarouge",
    "pitch-black-90-slowbro",
    "pitch-black-95-silvally",
  ],
};

export const TUTORIAL_SHOWCASE_POOLS = {
  "pitch-black": [
    "pitch-black-114-mega-zeraora-ex",
    "pitch-black-116-mega-darkrai-ex",
    "pitch-black-90-slowbro",
  ],
  "151": ["151-198-venusaur-ex", "151-173-pikachu", "151-200-blastoise-ex"],
  "prismatic-evolutions": [
    "prismatic-evolutions-156-sylveon-ex",
    "prismatic-evolutions-165-dragapult-ex",
    "prismatic-evolutions-167-eevee-ex",
  ],
};

export const ONBOARDING_CONVEYOR_CARD_REFS = [
  ["base-set", "base1-4"],
  ["paldean-fates", "paldean-fates-232-mew-ex"],
  ["neo-genesis", "neo1-9"],
  ["paldea-evolved", "paldea-evolved-203-magikarp"],
  ["ex-deoxys", "ex8-107"],
  ["151", "151-200-blastoise-ex"],
  ["platinum-arceus", "pl4-94"],
  ["team-up", "team-up-164-gengar-mimikyu-gx"],
  ["black-white-plasma-storm", "bw8-136"],
  ["evolving-skies", "evolving-skies-191-dragonite-v"],
  ["xy7", "xy7-98-m_rayquaza-ex"],
  ["lost-origin", "lost-origin-186-giratina-v"],
  ["surging-sparks", "surging-sparks-238-pikachu-ex"],
  ["prismatic-evolutions", "prismatic-evolutions-161-umbreon-ex"],
  ["twilight-masquerade", "twilight-masquerade-214-greninja-ex"],
  ["base-set", "base1-58"],
];

function getStorage(storage = globalThis.localStorage) {
  try {
    return storage || null;
  } catch {
    return null;
  }
}

export function getOnboardingDeviceId(storage = getStorage()) {
  if (!storage) return "device";
  let value = storage.getItem(MOBILE_ONBOARDING_DEVICE_KEY);
  if (!value) {
    value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storage.setItem(MOBILE_ONBOARDING_DEVICE_KEY, value);
  }
  return value;
}

export function hasCompletedMobileOnboarding(storage = getStorage()) {
  return Number(storage?.getItem(MOBILE_ONBOARDING_VERSION_KEY) || 0) >= MOBILE_ONBOARDING_VERSION;
}

export function isMobileOnboardingEligible({
  userAgent = globalThis.navigator?.userAgent || "",
  userAgentMobile = globalThis.navigator?.userAgentData?.mobile || false,
  coarsePointer = globalThis.matchMedia?.("(pointer: coarse)")?.matches || false,
  viewportWidth = globalThis.innerWidth ?? Number.POSITIVE_INFINITY,
  search = globalThis.location?.search || "",
} = {}) {
  if (new URLSearchParams(String(search)).get("desktop") === "1") return false;
  return isLikelyMobileVisitor({ userAgent, userAgentMobile, coarsePointer, viewportWidth });
}

export function getCommunityStatItems(stats) {
  return [
    typeof stats?.packsOpened === "number"
      ? { rawValue: stats.packsOpened, label: "packs opened" }
      : null,
    typeof stats?.cardsPulled === "number"
      ? { rawValue: stats.cardsPulled, label: "cards pulled" }
      : null,
    stats?.popularSetName
      ? { value: stats.popularSetName, label: "most popular set this week" }
      : null,
  ].filter(Boolean);
}

export function markMobileOnboardingComplete(storage = getStorage()) {
  if (!storage) return;
  storage.setItem(MOBILE_ONBOARDING_VERSION_KEY, String(MOBILE_ONBOARDING_VERSION));
  storage.removeItem(MOBILE_ONBOARDING_STATE_KEY);
}

function getCardIds(cardsOrIds = []) {
  return cardsOrIds.map((card) => String(card?.id ?? card ?? "").trim()).filter(Boolean);
}

export function inspectPendingMobileOnboarding(
  storage = getStorage(),
  now = Date.now()
) {
  if (!storage) return { payload: null, reason: "missing" };

  const serialized = storage.getItem(MOBILE_ONBOARDING_PENDING_KEY);
  if (!serialized) return { payload: null, reason: "missing" };

  try {
    const value = JSON.parse(serialized);
    const createdAt = Date.parse(String(value?.createdAt || ""));
    const cardIds = getCardIds(Array.isArray(value?.cardIds) ? value.cardIds : []);
    const isSkipped = value?.skipped === true;
    const isValid =
      value?.version === MOBILE_ONBOARDING_VERSION &&
      value?.completionId === MOBILE_ONBOARDING_COMPLETION_ID &&
      value?.tutorialPackEventId === MOBILE_ONBOARDING_TUTORIAL_EVENT_ID &&
      value?.destination === MOBILE_ONBOARDING_DESTINATION &&
      PENDING_MIGRATION_STATUSES.has(value?.migrationStatus) &&
      Number.isFinite(createdAt) &&
      typeof value?.setId === "string" &&
      (isSkipped || cardIds.length === 10);

    if (!isValid) return { payload: null, reason: "malformed" };
    if (now - createdAt > MOBILE_ONBOARDING_PENDING_MAX_AGE_MS) {
      return { payload: null, reason: "expired" };
    }

    return {
      payload: {
        version: MOBILE_ONBOARDING_VERSION,
        completionId: MOBILE_ONBOARDING_COMPLETION_ID,
        setId: value.setId.trim(),
        cardIds,
        tutorialPackEventId: MOBILE_ONBOARDING_TUTORIAL_EVENT_ID,
        createdAt: new Date(createdAt).toISOString(),
        destination: MOBILE_ONBOARDING_DESTINATION,
        migrationStatus: value.migrationStatus,
        skipped: isSkipped,
      },
      reason: "",
    };
  } catch {
    return { payload: null, reason: "malformed" };
  }
}

export function readPendingMobileOnboarding(storage = getStorage(), now = Date.now()) {
  return inspectPendingMobileOnboarding(storage, now).payload;
}

export function savePendingMobileOnboarding(
  { setId = "", cards = [], cardIds = [], skipped = false } = {},
  storage = getStorage(),
  now = Date.now()
) {
  if (!storage) return null;

  const normalizedCardIds = getCardIds(cardIds.length ? cardIds : cards);
  if (!skipped && (!String(setId).trim() || normalizedCardIds.length !== 10)) return null;

  const existing = readPendingMobileOnboarding(storage, now);
  if (existing) return existing;
  const payload = {
    version: MOBILE_ONBOARDING_VERSION,
    completionId: MOBILE_ONBOARDING_COMPLETION_ID,
    setId: skipped ? "" : String(setId).trim(),
    cardIds: skipped ? [] : normalizedCardIds,
    tutorialPackEventId: MOBILE_ONBOARDING_TUTORIAL_EVENT_ID,
    createdAt: new Date(now).toISOString(),
    destination: MOBILE_ONBOARDING_DESTINATION,
    migrationStatus: "pending",
    skipped,
  };

  storage.setItem(MOBILE_ONBOARDING_PENDING_KEY, JSON.stringify(payload));
  return payload;
}

export function updatePendingMobileOnboardingStatus(
  migrationStatus,
  storage = getStorage()
) {
  if (!PENDING_MIGRATION_STATUSES.has(migrationStatus) || !storage) return null;
  const pending = readPendingMobileOnboarding(storage);
  if (!pending) return null;

  const updated = { ...pending, migrationStatus };
  storage.setItem(MOBILE_ONBOARDING_PENDING_KEY, JSON.stringify(updated));
  return updated;
}

export function clearPendingMobileOnboarding(storage = getStorage()) {
  storage?.removeItem(MOBILE_ONBOARDING_PENDING_KEY);
}

export function resetMobileOnboarding(storage = getStorage()) {
  if (!storage) return;
  storage.removeItem(MOBILE_ONBOARDING_VERSION_KEY);
  storage.removeItem(MOBILE_ONBOARDING_STATE_KEY);
}

export function saveGuestTutorialPack(setId, cards, storage = getStorage()) {
  if (!storage || !setId || !Array.isArray(cards) || cards.length === 0) return;
  storage.setItem(MOBILE_ONBOARDING_GUEST_PACK_KEY, JSON.stringify({
    version: MOBILE_ONBOARDING_VERSION,
    setId,
    cardIds: cards.map((card) => String(card.id || "")),
  }));
  storage.setItem(MOBILE_ONBOARDING_GUEST_APPLIED_KEY, "1");
}

export function hasGuestTutorialBeenApplied(storage = getStorage()) {
  return storage?.getItem(MOBILE_ONBOARDING_GUEST_APPLIED_KEY) === "1";
}

export function readGuestTutorialPack(storage = getStorage()) {
  if (!storage) return { set: null, cards: [] };
  try {
    return restoreTutorialPack(JSON.parse(storage.getItem(MOBILE_ONBOARDING_GUEST_PACK_KEY) || "null"));
  } catch {
    return { set: null, cards: [] };
  }
}

export function clearGuestTutorialPack(storage = getStorage()) {
  storage?.removeItem(MOBILE_ONBOARDING_GUEST_PACK_KEY);
}

export function readMobileOnboardingState(storage = getStorage()) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(MOBILE_ONBOARDING_STATE_KEY) || "null");
    return value?.version === MOBILE_ONBOARDING_VERSION ? value : null;
  } catch {
    return null;
  }
}

export function writeMobileOnboardingState(state, storage = getStorage()) {
  if (!storage || !state) return;
  storage.setItem(MOBILE_ONBOARDING_STATE_KEY, JSON.stringify({
    ...state,
    version: MOBILE_ONBOARDING_VERSION,
    updatedAt: Date.now(),
  }));
}

export function getTutorialSets(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const newest = [...activeSets]
    .filter((set) => set.cards?.length && set.pullRateProfile && String(set.releaseDate || "") <= today)
    .sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")))[0];
  const ids = [newest?.id, "151", "prismatic-evolutions"].filter(Boolean);
  return [...new Set(ids)].map((id) => sets.find((set) => set.id === id)).filter(Boolean);
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createTutorialPack(set, deviceId = getOnboardingDeviceId()) {
  const cards = generateNormalPackOnly(set);
  const configuredPool = TUTORIAL_HIT_POOLS[set.id] || set.cards
    .filter((card) => /special illustration rare|illustration rare/i.test(String(card.rarity || "")))
    .slice(0, 4)
    .map((card) => card.id);
  const eligiblePool = configuredPool
    .map((id) => set.cards.find((card) => card.id === id))
    .filter((card) => card && isCardAllowedInPackSlot(card, 8, set));
  const alreadyHasHit = cards.some((card, index) =>
    /special illustration rare|illustration rare/i.test(String(card?.rarity || ""))
    && isCardAllowedInPackSlot(card, index, set)
  );
  if (!alreadyHasHit && eligiblePool.length && cards.length > 8) {
    cards[8] = eligiblePool[hashString(`${deviceId}:${set.id}`) % eligiblePool.length];
  }
  Object.assign(cards, { onboardingTutorial: true, isGodPack: false });
  return cards;
}

export function getTutorialShowcaseCards(set) {
  const ids = TUTORIAL_SHOWCASE_POOLS[set?.id] || [];
  const byId = new Map((set?.cards || []).map((card) => [String(card.id), card]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export function getOnboardingConveyorCards() {
  return ONBOARDING_CONVEYOR_CARD_REFS.map(([setId, cardId]) => {
    const set = sets.find((candidate) => candidate.id === setId);
    const card = set?.cards?.find((candidate) => candidate.id === cardId);
    return set && card ? { set, card } : null;
  }).filter(Boolean);
}

export function restoreTutorialPack(state) {
  const set = sets.find((candidate) => candidate.id === state?.setId);
  if (!set || !Array.isArray(state?.cardIds)) return { set: null, cards: [] };
  // Recovery is allowed to resolve a quarantined identity that an older app
  // already persisted. New tutorial generation still reads only set.cards.
  const cards = state.cardIds
    .map((id) => getSetCardById(set, id, { includeLegacy: true }))
    .filter(Boolean);
  if (cards.length !== state.cardIds.length) return { set: null, cards: [] };
  Object.assign(cards, { onboardingTutorial: true, isGodPack: false });
  return { set, cards };
}

export function isOnboardingTestMode() {
  if (!import.meta.env.DEV) return false;
  const params = new URLSearchParams(globalThis.location?.search || "");
  return globalThis.location?.pathname?.includes("/dev/onboarding") || params.get("onboardingTest") === "1";
}

export function getOnboardingDevStartStep() {
  if (!import.meta.env.DEV) return "";
  const params = new URLSearchParams(globalThis.location?.search || "");
  const step = params.get("onboardingStep") || "";
  return ["welcome", "choose-set", "summary", "collection", "pokemon", "explore", "community", "final"].includes(step)
    ? step
    : "";
}

export function getOnboardingDevScenario() {
  if (!import.meta.env.DEV) return {};
  const params = new URLSearchParams(globalThis.location?.search || "");
  return {
    prices: ["empty", "populated", "slow"].includes(params.get("prices")) ? params.get("prices") : "",
    stats: ["empty", "failure", "loading", "real"].includes(params.get("stats")) ? params.get("stats") : "",
    tourStep: ["1", "2", "3"].includes(params.get("tourStep")) ? Number(params.get("tourStep")) : 1,
    reducedMotion: params.get("reducedMotion") === "1",
    cardPreview: params.get("cardPreview") === "1",
    shortViewport: params.get("shortViewport") === "1",
    slowImages: params.get("slowImages") === "1",
    statSlide: ["packs", "cards", "popular"].includes(params.get("statSlide")) ? params.get("statSlide") : "",
  };
}

export function getDevRewardState() {
  if (!import.meta.env.DEV) return "";
  return new URLSearchParams(globalThis.location?.search || "").get("rewardState") || "";
}

export async function loadAccountOnboardingVersion(userId) {
  if (!supabase || !userId) return 0;
  const { data, error } = await supabase
    .from("user_mobile_onboarding")
    .select("version")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01") return 0;
    throw error;
  }
  return Number(data?.version || 0);
}
