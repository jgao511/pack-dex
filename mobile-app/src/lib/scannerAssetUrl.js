export function resolveScannerAssetUrl(path, { baseUrl = "./", origin = globalThis.location?.origin || "https://pack-dex.local/" } = {}) {
  return new URL(`scanner-ai/${path}`, new URL(baseUrl, origin)).href;
}
