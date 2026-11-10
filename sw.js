// Daily Tracker service worker: cache-first app shell, versioned cache.
// Bump VERSION whenever any app file changes so clients get the update.
const VERSION = '1.0.0';
const CACHE = `daily-tracker-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/actions.js',
  './js/ctx.js',
  './js/dates.js',
  './js/forms.js',
  './js/icons.js',
  './js/logic.js',
  './js/notify.js',
  './js/onboarding.js',
  './js/parse.js',
  './js/pwa.js',
  './js/store.js',
  './js/theme.js',
  './js/ui.js',
  './js/views/calendar.js',
  './js/views/habitDetail.js',
  './js/views/habits.js',
  './js/views/settings.js',
  './js/views/stats.js',
  './js/views/today.js',
  './js/views/widgets.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
  // No skipWaiting here: the page shows an "Update available" toast and
  // activates the new worker when the user taps Reload.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('daily-tracker-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // App shell: serve cached index.html (works offline), fall back to network.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      try { return await fetch(req); } catch { return Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  })());
});
