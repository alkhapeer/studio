/* =========================================================
   Trend Studio — Service Worker
   Strategy:
     • Precache core shell on install
     • Cache-first for static assets (icons, CSS, fonts)
     • Network-first for HTML pages (so updates arrive fast)
     • Offline fallback to index.html for navigations
   ========================================================= */

const VERSION    = 'v1.0.0';
const CACHE_NAME = `trend-studio-${VERSION}`;

/* Core shell — always cached on install */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

/* Optional assets — cached on first successful fetch */
const RUNTIME_ASSETS = [
  './TrendStudio.html',
  './trends_maker.html',
  './user-guide.html',
  './trendUserGuide.html',
  './fields-guide.html',
  './product-pitch.html',
  './fields-guide-ar.html',
  './product-pitch-ar.html'
   
];

/* =========================================================
   Install — precache the core shell
   ========================================================= */
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Cache core assets (failures are tolerated so one 404 doesn't break install)
      await Promise.all(
        CORE_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Skipped:', url, err.message))
        )
      );

      // Pre-warm optional pages in the background
      Promise.all(
        RUNTIME_ASSETS.map(url =>
          cache.add(url).catch(() => {})
        )
      );

      self.skipWaiting();
    })()
  );
});

/* =========================================================
   Activate — clean old caches
   ========================================================= */
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k.startsWith('trend-studio-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* =========================================================
   Fetch — smart routing
   ========================================================= */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin (analytics, fonts CDN, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip range requests (video/audio streaming)
  if (req.headers.has('range')) return;

  /* ---------- HTML pages: network-first ---------- */
  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(networkFirst(req));
    return;
  }

  /* ---------- Static assets: cache-first ---------- */
  event.respondWith(cacheFirst(req));
});

/* =========================================================
   Strategies
   ========================================================= */
async function cacheFirst(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });

  if (cached) {
    // Refresh in background (stale-while-revalidate)
    fetch(req)
      .then(res => { if (res && res.ok) cache.put(req, res.clone()); })
      .catch(() => {});
    return cached;
  }

  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Nothing to fall back to for non-HTML — return a minimal response
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    // Offline — try the cache
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    // Fall back to the app shell
    const shell = await cache.match('./index.html');
    if (shell) return shell;

    return new Response(
      '<h1>Offline</h1><p>Trend Studio is not available right now. Please reconnect and reload.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* =========================================================
   Messages — allow the page to trigger an immediate update
   ========================================================= */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
