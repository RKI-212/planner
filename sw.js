// Сначала сеть (чтобы правки приходили сразу). Если сети нет или она еле живая
// (ответа нет за 2.5 с) — сразу отдаём сохранённую копию, а свежую версию докачиваем в фоне.
const CACHE = "semestr-v10";
const FILES = ["./", "./index.html", "./data.js", "./core.js", "./life.js", "./app.js", "./sp-base.webp", "./sp-la.webp", "./sp-lb.webp", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return; // Яндекс и прочее — напрямую
  const net = fetch(e.request, { cache: "no-store" }).then(r => {
    if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(e.request, { ignoreSearch: true })
      .then(r => r || caches.match("./index.html"));
    const timer = setTimeout(() => fromCache().then(r => { if (r && !done) { done = true; resolve(r); } }), 2500);
    net.then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } })
       .catch(() => fromCache().then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r || Response.error()); } }));
  }));
});
