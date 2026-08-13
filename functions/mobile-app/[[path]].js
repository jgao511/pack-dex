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

function withNoindex(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, follow");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "X-Robots-Tag": "noindex, follow",
      },
    });
  }

  const pathname = new URL(context.request.url).pathname;
  if (isStaticAssetPath(pathname)) {
    if (typeof context.next === "function") return withNoindex(await context.next());
    return new Response(method === "HEAD" ? null : "Not Found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex, follow" },
    });
  }

  if (typeof context.next === "function") {
    const assetResponse = await context.next();
    if (assetResponse.status !== 404) return withNoindex(assetResponse);
  }

  const entryUrl = new URL(context.request.url);
  entryUrl.pathname = "/mobile-app/";
  entryUrl.search = "";

  const entryRequest = new Request(entryUrl, {
    method,
    headers: context.request.headers,
  });
  const entryResponse = await context.env.ASSETS.fetch(entryRequest);
  const headers = new Headers(entryResponse.headers);
  headers.set("X-PackDex-Entry", "mobile-app-fallback");
  headers.set("X-Robots-Tag", "noindex, follow");
  headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");

  return new Response(method === "HEAD" ? null : entryResponse.body, {
    status: entryResponse.status,
    statusText: entryResponse.statusText,
    headers,
  });
}
