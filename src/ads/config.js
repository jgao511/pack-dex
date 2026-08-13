export const ADSENSE_PUBLISHER_CLIENT = "ca-pub-4828542760410446";

export const AD_PLACEMENTS = Object.freeze({
  SET_RAIL: "setRail",
  SET_INLINE: "setInline",
  CONTENT: "content",
  MOBILE_INLINE: "mobileInline",
});

export const AD_PLACEMENT_DEFINITIONS = Object.freeze({
  [AD_PLACEMENTS.SET_RAIL]: Object.freeze({
    envKey: "VITE_ADSENSE_SET_RAIL_SLOT",
    audience: "desktop",
    minViewportWidth: 1280,
  }),
  [AD_PLACEMENTS.SET_INLINE]: Object.freeze({
    envKey: "VITE_ADSENSE_SET_INLINE_SLOT",
    audience: "desktop",
    minViewportWidth: 768,
  }),
  [AD_PLACEMENTS.CONTENT]: Object.freeze({
    envKey: "VITE_ADSENSE_CONTENT_SLOT",
    audience: "all",
  }),
  [AD_PLACEMENTS.MOBILE_INLINE]: Object.freeze({
    envKey: "VITE_ADSENSE_MOBILE_INLINE_SLOT",
    audience: "mobile",
    maxViewportWidth: 767,
  }),
});

const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function readBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(normalized)) return true;
  if (BOOLEAN_FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

export function isValidAdSenseClient(value) {
  return /^ca-pub-\d{16}$/.test(String(value ?? "").trim());
}

export function normalizeAdSenseClient(value) {
  const normalized = String(value ?? "").trim();
  return isValidAdSenseClient(normalized) ? normalized : "";
}

export function isValidAdSlotId(value) {
  return /^\d{6,20}$/.test(String(value ?? "").trim());
}

export function normalizeAdSlotId(value) {
  const normalized = String(value ?? "").trim();
  return isValidAdSlotId(normalized) ? normalized : "";
}

export function createAdSenseConfig(env = {}) {
  const requestedClient = String(env.VITE_ADSENSE_CLIENT ?? "").trim();
  const client = normalizeAdSenseClient(requestedClient || ADSENSE_PUBLISHER_CLIENT);
  const mode = String(env.MODE ?? "development").trim().toLowerCase();
  const isDevelopment = readBoolean(env.DEV, mode !== "production");
  const slots = {};

  for (const [placement, definition] of Object.entries(AD_PLACEMENT_DEFINITIONS)) {
    slots[placement] = normalizeAdSlotId(env[definition.envKey]);
  }

  const frozenSlots = Object.freeze(slots);

  return Object.freeze({
    client,
    enabled: readBoolean(env.VITE_ADSENSE_ENABLED, true),
    isDevelopment,
    allowRequestsInDevelopment: readBoolean(env.VITE_ADSENSE_ENABLE_IN_DEV, false),
    slots: frozenSlots,
    hasConfiguredSlot: Object.values(frozenSlots).some(Boolean),
  });
}

export function getAdSlotId(config, placement) {
  if (!Object.prototype.hasOwnProperty.call(AD_PLACEMENT_DEFINITIONS, placement)) return "";
  return normalizeAdSlotId(config?.slots?.[placement]);
}

export function isPlacementViewportEligible(placement, viewportWidth) {
  const definition = AD_PLACEMENT_DEFINITIONS[placement];
  if (!definition) return false;
  if (!Number.isFinite(viewportWidth)) return definition.audience === "all";
  if (Number.isFinite(definition.minViewportWidth) && viewportWidth < definition.minViewportWidth) {
    return false;
  }
  if (Number.isFinite(definition.maxViewportWidth) && viewportWidth > definition.maxViewportWidth) {
    return false;
  }
  return true;
}

const viteEnv = import.meta.env ?? {};

export const adsenseConfig = createAdSenseConfig(viteEnv);
