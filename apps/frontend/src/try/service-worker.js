/* global self, caches, CACHE_VERSION, ASSET_URLS */
// Wait for open editor tabs to close before activating a new build. Their
// lazy export modules must keep using the matching cache for the whole session.
const cachePrefix = "cliparr-try-";
const cacheName = `${cachePrefix}${CACHE_VERSION}`;
self.addEventListener("message", (event) => {
  if (event.data === "cliparr-build") {
    event.ports[0]?.postMessage(CACHE_VERSION, []);
  }
});
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
  const scope = new URL(self.registration.scope);
  const key =
    request.mode === "navigate" && url.pathname.startsWith(scope.pathname)
      ? scope.pathname
      : url.pathname;
  if (!ASSET_URLS.includes(key)) {
    return;
  }
  event.respondWith(
    caches
      .open(cacheName)
      .then(async (cache) => (await cache.match(key)) ?? fetch(request)),
  );
});
