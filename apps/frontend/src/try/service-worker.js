/* global self, caches, CACHE_VERSION, ASSET_URLS */
const cachePrefix = "cliparr-try-";
const cacheName = `${cachePrefix}${CACHE_VERSION}`;
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll(
          ASSET_URLS.map((url) => new Request(url, { cache: "reload" })),
        ),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(cachePrefix) && name !== cacheName) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  const key = url.pathname;
  if (!ASSET_URLS.includes(key)) {
    return;
  }
  event.respondWith(
    caches
      .open(cacheName)
      .then(async (cache) => (await cache.match(key)) ?? fetch(request)),
  );
});
