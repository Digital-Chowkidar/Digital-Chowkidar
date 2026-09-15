const CACHE = "digital-chowkidar-v12";
const STATIC = ["./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Never serve the application shell from the service-worker cache.
  // This prevents an old index.html from hiding a newly deployed build.
  if (url.origin === self.location.origin && (url.pathname === "/" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/sw.js"))) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
});
