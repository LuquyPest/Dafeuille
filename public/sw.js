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
  if (e.request.mode === "navigate") {
    // Une page de secours par interface : /beta (React) ou l'ancienne.
    const key = u.pathname.startsWith("/beta") ? "/beta/" : "/index.html";
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(key, c)); return r; }).catch(() => caches.match(key)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok && u.origin === location.origin) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })));
});

/* Notifications push : rien n'est affiché si l'app est déjà visible sur cet appareil (elle montre l'info elle-même). */
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = {body:e.data && e.data.text()}; }
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({type:"window", includeUncontrolled:true});
    if (cs.some(c => c.visibilityState === "visible")) return;
    await self.registration.showNotification(d.title || "DAFeuille", {body:d.body || "", icon:"/icon-192.png", badge:"/icon-192.png", tag:d.tag, renotify:!!d.tag, data:{url:d.url || "/"}});
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({type:"window", includeUncontrolled:true});
    const c = cs.find(x => x.url.startsWith(self.location.origin));
    if (c) { await c.focus(); return c.navigate ? c.navigate(url).catch(() => {}) : null; }
    return self.clients.openWindow(url);
  })());
});
