const PACKDEX_SW_VERSION = "pack-atomic-v2-20260731";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith("packdex-"))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({
      type: "PACKDEX_SW_ACTIVATED",
      version: PACKDEX_SW_VERSION,
    }));
  })());
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "PACKDEX_SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
