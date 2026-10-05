// v2 : interface React. Le changement de nom de cache purge l'ancienne interface des appareils.
const CACHE = "dafeuille-srv-2";
const CORE = ["/", "/theme.js", "/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png"];
// Installation : fichiers de base + bundle de l'app (repéré dans la page), pour fonctionner hors ligne dès la 1re visite
self.addEventListener("install", e => { e.waitUntil((async () => {
  const c = await caches.open(CACHE); await c.addAll(CORE);
  try { const html = await (await c.match("/")).text(); const assets = [...new Set(html.match(/\/assets\/[\w.-]+\.(?:js|css)/g) || [])]; await c.addAll(assets); } catch {}
  await self.skipWaiting();
})()); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  // jamais de cache pour l'API ni les fichiers privés ; le cross-origine (polices) est laissé au navigateur
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/") || u.origin !== location.origin) return;
  if (e.request.mode === "navigate") {
    // Réseau d'abord ; hors ligne, la page de l'app (elle démarre sur l'instantané local du foyer)
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put("/", c)); } return r; }).catch(() => caches.match("/")));
    return;
  }
  // Fichiers hachés (/assets/…) immuables : cache d'abord ; le reste : réseau d'abord, cache en secours
  if (u.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { if (r.ok && !u.pathname.startsWith("/uploads/")) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
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
