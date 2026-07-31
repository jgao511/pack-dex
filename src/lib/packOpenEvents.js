function makeFallbackId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function ensurePackOpenClientEventId(cards, setId = "") {
  if (!cards || typeof cards !== "object") return "";

  if (!cards.packOpenClientEventId) {
    Object.defineProperty(cards, "packOpenClientEventId", {
      value: `pack-open:${setId || "unknown"}:${makeFallbackId()}`,
      enumerable: false,
      configurable: true,
    });
  }

  return cards.packOpenClientEventId;
}
