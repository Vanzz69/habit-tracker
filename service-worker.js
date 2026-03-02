/**
 * MOMENTUM — Service Worker v2
 * Network-first for HTML (always get fresh page),
 * Cache-first for static assets (CSS, JS, icons).
 */

const CACHE_NAME    = 'momentum-v2.0.0';
const RUNTIME_CACHE = 'momentum-runtime-v2';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
];

/* ── INSTALL ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  // CDN: stale-while-revalidate
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // HTML navigation: NETWORK FIRST so the page is always fresh
  // This ensures DateUtils.today() always runs with the real current date
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(networkFirst(request));
    return;
  }

  // JS / CSS / images: cache-first (these don't change day to day)
  event.respondWith(cacheFirst(request));
});

/* ── STRATEGIES ── */

const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback
    const cached = await caches.match('./index.html');
    return cached || new Response('Offline', { status: 503 });
  }
};

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
};

const staleWhileRevalidate = async (request) => {
  const cache  = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
};
