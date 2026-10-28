// Offline-Cache für die App-Dateien. Spielstände und Statistik liegen im localStorage, nicht hier.
const CACHE = 'spiele-v3';
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg',
  'js/main.js', 'js/core.js', 'js/uno.js', 'js/zehntausend.js', 'js/sterbslen.js',
  'js/stats.js', 'js/account.js', 'js/live.js', 'js/webauthn.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Bei schlechtem Empfang nicht ewig warten: nach so vielen ms gilt die gespeicherte Version.
const TIMEOUT = 2500;
// War das Netz einmal zu langsam, kommen die Dateien eine Weile direkt aus dem Cache.
// Sonst würde jede Datei der Kette (Seite → main.js → Spiele …) nochmals warten.
const SLOW_FOR = 30000;
let slowUntil = 0;

/**
 * Netzwerk zuerst (für Updates). Ohne Verbindung oder wenn das Netz zu lange braucht, aus dem Cache;
 * die Antwort aus dem Netz aktualisiert den Cache dann im Hintergrund.
 */
async function respond(e) {
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  const net = fetch(e.request).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  if (Date.now() < slowUntil) return (await cached()) || net;
  const first = await Promise.race([net.catch(() => null), new Promise(r => setTimeout(r, TIMEOUT, 'slow'))]);
  if (first && first !== 'slow') return first;
  if (first === 'slow') slowUntil = Date.now() + SLOW_FOR;
  return (await cached()) || net;
}

// Die Schnittstelle (/api) wird nie zwischengespeichert.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(respond(e));
});
