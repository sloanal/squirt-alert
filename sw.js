'use strict';

const CACHE = 'reserve-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const META = 'reserve-meta';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== META).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first so updates land quickly; fall back to cache offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});

// The page tells us which alerts are coming up: [{ key, at, title, body }].
async function readSchedule() {
  const res = await (await caches.open(META)).match('schedule');
  return res ? res.json() : { alerts: [] };
}
async function writeSchedule(s) {
  await (await caches.open(META)).put('schedule', new Response(JSON.stringify(s)));
}

self.addEventListener('message', (e) => {
  if (e.data?.type === 'schedule') e.waitUntil(writeSchedule({ alerts: e.data.alerts || [] }));
});

// Periodic background sync (installed PWAs on Chromium): show the latest alert that has come due.
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'reserve-check') return;
  e.waitUntil((async () => {
    const { alerts = [] } = await readSchedule();
    const now = Date.now();
    const due = alerts.filter((a) => a.at <= now).sort((a, b) => b.at - a.at);
    if (!due.length) return;
    await self.registration.showNotification(due[0].title, {
      body: due[0].body,
      tag: 'reserve',
      icon: 'icon-192.png',
    });
    await writeSchedule({ alerts: alerts.filter((a) => a.at > now) });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all[0]) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});
