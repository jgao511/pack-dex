const PAYLOAD_VERSION = 1;
const MAX_CARDS = 20;
const MAX_ID_LENGTH = 180;

function encodeUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeUtf8(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function isBoundedId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

export function encodeSharePullPayload({ setId, cardIds, bestPullIndex }) {
  if (!isBoundedId(setId) || !Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > MAX_CARDS) {
    throw new Error("Invalid pull share data.");
  }
  if (!cardIds.every(isBoundedId) || !Number.isInteger(bestPullIndex) || bestPullIndex < 0 || bestPullIndex >= cardIds.length) {
    throw new Error("Invalid pull share data.");
  }

  return `v${PAYLOAD_VERSION}.${encodeUtf8(JSON.stringify({ v: PAYLOAD_VERSION, s: setId, c: cardIds, b: bestPullIndex }))}`;
}

export function decodeSharePullPayload(token) {
  try {
    const match = String(token || "").match(/^v(\d+)\.([A-Za-z0-9_-]+)$/);
    if (!match || Number(match[1]) !== PAYLOAD_VERSION) return null;
    const payload = JSON.parse(decodeUtf8(match[2]));
    if (payload?.v !== PAYLOAD_VERSION || !isBoundedId(payload.s)) return null;
    if (!Array.isArray(payload.c) || payload.c.length < 1 || payload.c.length > MAX_CARDS || !payload.c.every(isBoundedId)) return null;
    if (!Number.isInteger(payload.b) || payload.b < 0 || payload.b >= payload.c.length) return null;
    return { version: payload.v, setId: payload.s, cardIds: payload.c, bestPullIndex: payload.b };
  } catch {
    return null;
  }
}
