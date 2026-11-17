// Caches the app shell on the first visit so the page opens without a network. Same-origin GETs only.
// The build id and the file list below are filled in by build.mjs.
const CACHE = "dopadam-ios-__BUILD__";
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("dopadam-ios-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).catch(() =>
          // Offline and not cached: any page of this app is the same shell.
          request.mode === "navigate" ? caches.match("./") : Response.error(),
        ),
    ),
  );
});
