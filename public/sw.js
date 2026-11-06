// Service Worker: App-Shell offline verfügbar machen, API-Antworten als Offline-Fallback zwischenspeichern.
// Bei jeder Veröffentlichung VERSION erhöhen, damit Clients die neuen Dateien laden.
const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const API_CACHE = 'api-v1';

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/charts.js',
  '/js/lib/calc.js',
  '/js/lib/parse.js',
  '/js/views/auth.js',
  '/js/views/setup.js',
  '/js/views/today.js',
  '/js/views/sheets.js',
  '/js/views/foods.js',
  '/js/views/weight.js',
  '/js/views/stats.js',
  '/js/views/profile.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-api-cache') event.waitUntil(caches.delete(API_CACHE));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/account/export') return;
    event.respondWith(networkFirstApi(req));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match('/index.html')) || Response.error()),
    );
    return;
  }
  event.respondWith(staleWhileRevalidate(event, req));
});

async function networkFirstApi(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (res.status === 200) cache.put(req, res.clone());
    else if (res.status === 401) cache.keys().then((keys) => keys.forEach((k) => cache.delete(k)));
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Offline', '1');
      return new Response(await cached.blob(), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: 'Du bist offline.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'X-Offline': '1' },
    });
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) || Response.error();
}
