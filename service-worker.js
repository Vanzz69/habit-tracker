/**
 * MOMENTUM — Service Worker v3
 * Network-first for everything local (HTML, JS, CSS).
 * Cache-first only for CDN fonts/libraries.
 * This ensures phones always get the latest code after a deploy.
 */

const CACHE_NAME    = 'momentum-v5.0.0';
const RUNTIME_CACHE = 'momentum-runtime-v5';

const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'www.gstatic.com',
];

/* ── INSTALL — skip waiting immediately ── */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

/* ── ACTIVATE — delete ALL old caches ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  // Firebase / Firestore API calls — never intercept
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('identitytoolkit')) return;

  // CDN resources (fonts, Chart.js) — cache-first, long lived
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else (your HTML, JS, CSS) — network-first
  // Phone always gets fresh code, falls back to cache only if offline
  event.respondWith(networkFirst(request));
});

/* ── STRATEGIES ── */

const networkFirst = async (request) => {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request) || await caches.match('./index.html');
    return cached || new Response('Offline — open when connected', { status: 503 });
  }
};

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
};

/* ── NOTIFICATION CLICK ── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length) { list[0].focus(); return; }
      clients.openWindow('./');
    })
  );
});
