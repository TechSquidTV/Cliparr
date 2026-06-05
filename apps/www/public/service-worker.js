const CACHE_PREFIX = "cliparr-pwa";
const CACHE_VERSION = "v1";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}-assets-${CACHE_VERSION}`;
const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/pwa-maskable-512.png",
  "/logo-light.svg",
];

function isCliparrCache(cacheName) {
  return cacheName.startsWith(`${CACHE_PREFIX}-`);
}

function isCurrentCache(cacheName) {
  return cacheName === SHELL_CACHE || cacheName === ASSET_CACHE;
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiRequest(url) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    request.headers.get("accept")?.includes("text/html")
  );
}

function isCacheableAssetRequest(request, url) {
  if (!isSameOrigin(url) || isApiRequest(url)) {
    return false;
  }

  if (url.pathname.startsWith("/assets/")) {
    return true;
  }

  return ["font", "image", "manifest", "script", "style"].includes(
    request.destination,
  );
}

async function cacheAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(APP_SHELL_URLS);
}

async function deleteOldCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter(
        (cacheName) => isCliparrCache(cacheName) && !isCurrentCache(cacheName),
      )
      .map((cacheName) => caches.delete(cacheName)),
  );
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put("/index.html", response.clone());
    }
    return response;
  } catch {
    return (
      (await cache.match("/index.html")) ||
      (await cache.match("/")) ||
      Response.error()
    );
  }
}

async function staleWhileRevalidateAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cachedResponse = await cache.match(request);
  const networkResponsePromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {});

  return cachedResponse || (await networkResponsePromise) || Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().catch(() => {}));
  globalThis.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    deleteOldCaches()
      .catch(() => {})
      .then(() => globalThis.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url) || isApiRequest(url)) {
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCacheableAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidateAsset(request));
  }
});
