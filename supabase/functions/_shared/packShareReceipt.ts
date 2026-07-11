const RECEIPT_VERSION = 1;
const RECEIPT_TTL_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type PackShareReceiptPayload = {
  v: number;
  userId: string;
  openingId: string;
  setId: string;
  cardIds: string[];
  bestPullCardId: string;
  issuedAt: number;
  expiresAt: number;
};

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getSecret() {
  const secret = Deno.env.get("PACK_SHARE_SIGNING_SECRET") || "";
  if (secret.length < 32) throw new Error("PACK_SHARE_SIGNING_SECRET must contain at least 32 characters.");
  return secret;
}

async function getKey() {
  return crypto.subtle.importKey("raw", encoder.encode(getSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function encodePayload(payload: PackShareReceiptPayload) {
  return base64UrlEncode(encoder.encode(JSON.stringify(payload)));
}

export async function issuePackShareReceipt(userId: string, setId: string, cardIds: string[]) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: PackShareReceiptPayload = {
    v: RECEIPT_VERSION,
    userId,
    openingId: crypto.randomUUID(),
    setId,
    cardIds,
    bestPullCardId: cardIds.at(-1) || "",
    issuedAt,
    expiresAt: issuedAt + RECEIPT_TTL_SECONDS,
  };
  const encoded = encodePayload(payload);
  const signature = await crypto.subtle.sign("HMAC", await getKey(), encoder.encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyPackShareReceipt(receipt: string) {
  const [encoded, signature, extra] = String(receipt || "").split(".");
  if (!encoded || !signature || extra) throw new Error("This share receipt is invalid.");

  const valid = await crypto.subtle.verify("HMAC", await getKey(), base64UrlDecode(signature), encoder.encode(encoded));
  if (!valid) throw new Error("This share receipt is invalid.");

  const payload = JSON.parse(decoder.decode(base64UrlDecode(encoded))) as PackShareReceiptPayload;
  if (payload.v !== RECEIPT_VERSION) throw new Error("This share receipt version is unsupported.");
  if (!payload.userId || !payload.openingId || !payload.setId || !Array.isArray(payload.cardIds) || !payload.cardIds.length) {
    throw new Error("This share receipt is invalid.");
  }
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error("This share receipt has expired.");
  }
  return payload;
}
