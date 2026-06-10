const viteEnv = import.meta.env || {};

export const ASSET_BASE_URL = viteEnv.VITE_ASSET_BASE_URL || "https://assets.pack-dex.com";
export const SET_ASSET_BASE_URL = viteEnv.VITE_SET_ASSET_BASE_URL || `${ASSET_BASE_URL}/sets`;

function isAbsoluteUrl(path) {
  return /^https?:\/\//i.test(String(path || ""));
}

export function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function normalizeAssetPath(path) {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function normalizeSetAssetPath(path) {
  let normalized = normalizeAssetPath(path);

  normalized = normalized.replace(/^assets\/sets\//i, "");
  normalized = normalized.replace(/^sets\//i, "");

  return normalized;
}

function normalizeRootAssetPath(path) {
  let normalized = normalizeAssetPath(path);

  normalized = normalized.replace(/^assets\//i, "");

  return normalized;
}

export function getAssetUrl(path) {
  if (!path) return "";
  if (isAbsoluteUrl(path)) return path;

  return joinUrl(ASSET_BASE_URL, normalizeRootAssetPath(path));
}

export function getSetAssetUrl(path) {
  if (!path) return "";
  if (isAbsoluteUrl(path)) return path;

  return joinUrl(SET_ASSET_BASE_URL, normalizeSetAssetPath(path));
}

export function getCardImageUrl(card = {}) {
  const explicitPath = card.imagePath || card.imageUrl || card.image_url || card.image;

  if (explicitPath) {
    return getSetAssetUrl(explicitPath);
  }

  const setFolder = card.setFolder || card.setId || card.setCode || card.set;
  const fileName = card.fileName || card.imageFileName || card.filename;

  if (!setFolder || !fileName) {
    return "";
  }

  return getSetAssetUrl(`${setFolder}/cards/${fileName}`);
}

export function getSetLogoUrl(set = {}) {
  const setFolder = set.setFolder || set.id || set.code || set.setCode;

  if (!setFolder) {
    return "";
  }

  return `/set-logos/${normalizeAssetPath(setFolder)}.png`;
}

export function getSetPackArtUrl(set = {}) {
  const explicitPath = set.packArtPath || set.packArt;

  if (explicitPath) {
    return getSetAssetUrl(explicitPath);
  }

  const setFolder = set.setFolder || set.id || set.code || set.setCode;

  if (!setFolder) {
    return "";
  }

  return getSetAssetUrl(`${setFolder}/pack.png`);
}

export function getSoundUrl(fileName) {
  return getAssetUrl(`sounds/${fileName}`);
}

export const CARD_BACK_URL = "/card-back.png";

export function getCardBackUrl() {
  return CARD_BACK_URL;
}

export function getPokeballLoadingUrl() {
  return getAssetUrl("pokeball-loading-transparent.png");
}
