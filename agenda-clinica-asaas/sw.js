const CACHE_NAME = "clinica-asaas-v1";
const ASSETS = ["./index.html", "./styles.css", "./data.js", "./app.js", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("/.netlify/functions/") || event.request.url.includes("/api/")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
