// Daily Tracker service worker: cache-first app shell, versioned cache.
// Bump VERSION whenever any app file changes so clients get the update.
const VERSION = '1.6.0';
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
  './js/profiles.js',
  './js/pwa.js',
  './js/reminders.js',
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
  './js/views/workouts.js',
  './js/workoutForm.js',
  './js/itemMenu.js',
  './js/push.js',
  './js/pushConfig.js',
  './js/workouts.js',
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
    // Tell every open tab a new version is live, so tabs running older code reload.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'APP_UPDATED', version: VERSION }));
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

// ---------- Notifications ----------
/** Only URLs inside this app (relative to the SW scope) are ever opened. */
function appUrl(url) {
  try {
    const u = new URL(url || './', self.registration.scope);
    return u.origin === self.location.origin && u.href.startsWith(self.registration.scope) ? u.href : self.registration.scope;
  } catch { return self.registration.scope; }
}

/** A reminder sent by the push server (see server/): { title, body, url, tag }. */
function onPush(event) {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  const opts = { body: String(d.body || ''), data: { url: appUrl(d.url) }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  if (d.tag) opts.tag = String(d.tag); // same tag as an in-app reminder for the same occurrence: no duplicates
  return self.registration.showNotification(String(d.title || 'Daily Tracker'), opts);
}
self.addEventListener('push', (event) => { event.waitUntil(onPush(event)); });

/** Focus an open window (and show the reminder's day there), or open the app at its URL. */
async function onNotificationClick(event) {
  event.notification.close();
  const url = appUrl(event.notification.data && event.notification.data.url);
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = all.find((c) => c.url.startsWith(self.registration.scope)) || all[0];
  if (client && 'focus' in client) {
    client.postMessage({ type: 'OPEN_URL', url });
    return client.focus();
  }
  return self.clients.openWindow(url);
}
self.addEventListener('notificationclick', (event) => { event.waitUntil(onNotificationClick(event)); });
