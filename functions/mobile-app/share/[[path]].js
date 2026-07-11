export async function onRequest(context) {
  const method = context.request.method.toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
      },
    });
  }

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = "/mobile-app/";
  assetUrl.search = "";

  const assetRequest = new Request(assetUrl.toString(), {
    method,
    headers: context.request.headers,
  });
  const assetResponse = await context.env.ASSETS.fetch(assetRequest);
  const headers = new Headers(assetResponse.headers);

  headers.set("X-PackDex-Entry", "mobile-share");
  headers.set("Cache-Control", "no-cache");

  return new Response(method === "HEAD" ? null : assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}
