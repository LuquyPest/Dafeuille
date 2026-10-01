const CACHE = "dafeuille-srv-1";
const CORE = ["/", "/index.html", "/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  // jamais de cache pour l'API, et on laisse le navigateur gérer nativement le cross-origine
  // (un script chargé avec `integrity` ne doit pas être réémis via un fetch() du service worker :
  // la vérification SRI échoue silencieusement sur certains navigateurs quand elle passe par le SW)
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/") || u.origin !== location.origin) return;
  if (e.request.mode === "navigate") { e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put("/index.html", c)); return r; }).catch(() => caches.match("/index.html"))); return; }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok && u.origin === location.origin) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })));
});
