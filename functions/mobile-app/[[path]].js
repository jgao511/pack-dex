const MOBILE_ENTRY_PATH = "/mobile-app/";
const STATIC_PREFIXES = [
  "/mobile-app/assets/",
  "/mobile-app/scanner-ai/",
  "/mobile-app/set-logos/",
];

function isStaticAssetPath(pathname) {
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const lastSegment = pathname.split("/").pop() || "";
  return lastSegment.includes(".");
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  const assetResponse = await context.next();

  if (
    assetResponse.status !== 404 ||
    (method !== "GET" && method !== "HEAD") ||
    isStaticAssetPath(new URL(context.request.url).pathname)
  ) {
    return assetResponse;
  }

  const entryUrl = new URL(context.request.url);
  entryUrl.pathname = MOBILE_ENTRY_PATH;
  entryUrl.search = "";

  const entryRequest = new Request(entryUrl, {
    method,
    headers: context.request.headers,
  });
  const entryResponse = await context.env.ASSETS.fetch(entryRequest);
  const headers = new Headers(entryResponse.headers);
  headers.set("X-PackDex-Entry", "mobile-app-fallback");
  headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");

  return new Response(method === "HEAD" ? null : entryResponse.body, {
    status: entryResponse.status,
    statusText: entryResponse.statusText,
    headers,
  });
}
