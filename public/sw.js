/* Replaced by scripts/build-sw.mjs during every production build. */
const VERSION = "__CACHE_VERSION__";
const FILES = /*__PRECACHE__*/ ["./", "./index.html"];
const SCOPE = self.registration.scope;
const PREFIX = `nihonshi-${new URL(SCOPE).pathname}-`;
const CACHE = PREFIX + VERSION;
const SHELL = new URL("index.html", SCOPE).href;
const urls = FILES.map((path) => new URL(path, SCOPE).href);

self.addEventListener("install", (event) => {
  // A failed download aborts the entire update. The previous app stays usable.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(urls)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(SCOPE)) return;
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) return response;
        } catch {
          /* Offline: use the complete installed app version. */
        }
        return (
          (await (await caches.open(CACHE)).match(SHELL)) || Response.error()
        );
      })(),
    );
    return;
  }
  // Versioned precache never gets rewritten with a partial newer application.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      return fetch(request);
    })(),
  );
});
