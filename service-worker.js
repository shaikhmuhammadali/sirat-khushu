/* ═══════════════════════════════════════════════════════════════════════════
   Sirat Khushu — Service Worker
   • Precache the (single-file, self-contained) app shell with a VERSIONED cache.
   • cache-first for static assets; network-first (short timeout → cache) for the
     four whitelisted geo/prayer APIs; offline fallback for navigations.
   • Never phones home: this worker only ever fetches same-origin assets or one of
     the four opt-in API hosts — nothing else, upholding the app's constitution.
   • Calls skipWaiting on install so a new version activates immediately (never stuck),
     so a running session is never swapped out underneath the user.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const VERSION = 'sabr-engine-v3.76.0';          // ← bump to ship an update
const SHELL   = VERSION + '-shell';
const RUNTIME = VERSION + '-runtime';

const API_HOSTS = new Set([
  'geocoding-api.open-meteo.com',
  'nominatim.openstreetmap.org',
  'api.aladhan.com',
  'api.bigdatacloud.net'
]);

const PRECACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon.ico',
  './audio/salawat.mp3',
  './audio/alhamdulillah.mp3',
  './audio/assalamualaikum.mp3',
  './fonts/Hafs.otf'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(async c => {
    // Cache each shell asset independently and NON-FATALLY. A single missing/404 asset
    // (e.g. an optional font not shipped on this deploy) must never reject install — otherwise
    // the whole worker fails to install, existing users get stuck on the old cached shell, and
    // fresh visitors get no worker at all. The core (./ and ./index.html) is fetched first and
    // IS required; everything else is best-effort.
    await c.add('./');
    await c.add('./index.html');
    await Promise.all(PRECACHE.map(u => c.add(u).catch(e => console.warn('[sw] skip precache', u, e && e.message))));
    // the full 114-surah Qur'an (large, optional) — cache it so it works offline from install.
    try { await c.add('./data/quran.json'); } catch (e) { /* deployed without data/quran.json — non-fatal */ }
  }));
  self.skipWaiting();   // activate immediately so a stale old version can never get stuck
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// the page sends this when the user taps "Reload" on the update prompt
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── web push: show the reminder the server sent, and focus the app when tapped ──
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: '\u0635\u0650\u0631\u064e\u0627\u0637 \u00b7 Sirat Khushu', body: (event.data && event.data.text()) || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || '\u0635\u0650\u0631\u064e\u0627\u0637 \u00b7 Sirat Khushu', {
    body: data.body || '', tag: data.tag || 'sabr', renotify: true,
    icon: './icons/icon-192.png', badge: './icons/favicon-32.png', dir: 'auto'
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { try { await c.focus(); return; } catch (e) {} } }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});

function withTimeout(promise, ms){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// Bounded runtime cache. Geocoding/search URLs are high-cardinality (one entry per
// typed query and per GPS jitter), so cap RUNTIME (FIFO) to stop it growing without
// limit — an unbounded cache could push the origin to its storage quota and get the
// whole origin (including the offline SHELL precache) evicted.
async function putCapped(cacheName, req, res, max){
  const c = await caches.open(cacheName);
  await c.put(req, res);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // never cache mutations
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 1) whitelisted geo/prayer APIs → network-first, short timeout, fall back to cache
  if (API_HOSTS.has(url.hostname)){
    event.respondWith((async () => {
      try {
        const res = await withTimeout(fetch(req), 3500);
        if (res && res.ok){ event.waitUntil(putCapped(RUNTIME, req, res.clone(), 40)); }
        return res;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || new Response(JSON.stringify({ error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // 2) only same-origin beyond this point — foreign hosts are left untouched
  if (url.origin !== self.location.origin) return;


  // 3) navigations → NETWORK-FIRST so a freshly deployed app shows up immediately on reload;
  //    fall back to the cached shell (then the offline page) only when the network is unavailable.
  if (req.mode === 'navigate'){
    event.respondWith((async () => {
      try {
        const res = await withTimeout(fetch(req), 4500);
        if (res && res.ok){ event.waitUntil((async () => { const c = await caches.open(SHELL); await c.put('./index.html', res.clone()); })()); }
        return res;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || (await caches.match('./offline.html')) || Response.error();
      }
    })());
    return;
  }

  // 4) other same-origin static (icons, manifest) → cache-first, then network (and cache it)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok){ const c = await caches.open(SHELL); c.put(req, res.clone()); }
      return res;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
