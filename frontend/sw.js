// Offline-Cache für die App-Dateien. Spielstände und Statistik liegen im localStorage, nicht hier.
const CACHE = 'spiele-v2';
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg',
  'js/main.js', 'js/core.js', 'js/uno.js', 'js/zehntausend.js', 'js/sterbslen.js',
  'js/stats.js', 'js/account.js', 'js/webauthn.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Netzwerk zuerst (für Updates), bei fehlender Verbindung aus dem Cache. Die Schnittstelle (/api) wird nie zwischengespeichert.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
