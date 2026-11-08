/* KYNOVA service worker.
 *
 * What it does: it keeps the static files of the app (scripts, styles, fonts, icons) so the app opens fast and installs, and it shows an
 * offline page when there is no connection.
 *
 * What it never does: it never stores a page, an API answer or anything that belongs to a signed-in person. Navigations always go to the
 * network; only when the network fails does the offline page appear. Requests to /api, to the sign-in screens and anything that is not a
 * plain GET are left alone, so no business data and no session can ever end up in this cache.
 */
const VERSION = "kynova-v2";
const STATIC_CACHE = VERSION + "-static";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icon.svg", "/apple-icon.png"];
const NEVER_CACHE = ["/api/", "/login", "/auth", "/spike"];
const STATIC_PATH = /^\/_next\/static\//;
const STATIC_FILE = /\.(?:svg|png|ico|webp|woff2?|css|js)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.indexOf(VERSION) !== 0).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname === prefix || url.pathname.indexOf(prefix) === 0)) return;

  // A page: always from the network. If there is no connection, the offline page. Nothing is stored.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // A static file: from the cache at once, and refreshed in the background.
  if (STATIC_PATH.test(url.pathname) || STATIC_FILE.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const refresh = fetch(request)
            .then((response) => {
              if (response && response.ok && response.type === "basic") cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || refresh;
        }),
      ),
    );
  }
});
