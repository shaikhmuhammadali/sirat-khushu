/* ═══════════════════════════════════════════════════════════════════════════
   Sirat Khushu — Service Worker
   • Precache the (single-file, self-contained) app shell with a VERSIONED cache.
   • cache-first for static assets; network-first (short timeout → cache) for the
     four whitelisted geo/prayer APIs; offline fallback for navigations.
   • NEW (v3.84.0): offline Qur'an recitation — reciter audio from the two
     allow-listed CDNs is cached on first play so a heard ayah recites offline;
     Navigation Preload for faster first paint; stale-while-revalidate for static.
   • Never phones home: this worker only ever fetches same-origin assets, one of
     the four opt-in API hosts, or the two allow-listed reciter-audio CDNs —
     nothing else, upholding the app's constitution and matching the page CSP.
   • Calls skipWaiting on install so a new version activates immediately (never stuck),
     so a running session is never swapped out underneath the user.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const VERSION = 'sabr-engine-v3.118.0';         // ← bump to ship an update (clients auto-drop the old cache)
const SHELL   = VERSION + '-shell';
const RUNTIME = VERSION + '-runtime';
const AUDIO   = VERSION + '-audio';             // reciter audio (offline recitation), bounded + FIFO

const API_HOSTS = new Set([
  'geocoding-api.open-meteo.com',
  'nominatim.openstreetmap.org',
  'api.aladhan.com',
  'api.bigdatacloud.net'
]);

// Reciter-audio CDNs — MUST stay in lock-step with the page CSP `media-src` allow-list.
// These are the ONLY cross-origin hosts this worker will cache. Nothing else is touched.
const AUDIO_HOSTS = new Set([
  'everyayah.com',
  'cdn.islamic.network'
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
    // Core recitation: Al-Fatiha (7 ayat) in the DEFAULT reciter (ar.alafasy) so the very FIRST Recite
    // tap works OFFLINE even before anything has been heard online. Best-effort, never fatal.
    try {
      const a = await caches.open(AUDIO);
      for (const n of ['1','2','3','4','5','6','7']){
        const u = 'https://cdn.islamic.network/quran/audio/128/ar.alafasy/' + n + '.mp3';
        try {
          let full; try { full = await fetch(u); } catch (e) { full = await fetch(u, { mode: 'no-cors' }); }
          if (full && (full.status === 200 || full.type === 'opaque')) await a.put(new Request(u), full.clone());
        } catch (e) {}
      }
    } catch (e) {}
  }));
  self.skipWaiting();   // activate immediately so a stale old version can never get stuck
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    // Navigation Preload: let the browser start the page request in parallel with this worker
    // booting, so a network-first navigation isn't blocked on SW startup. Feature-detected —
    // silently skipped where unsupported.
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
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
  catch (e) { data = { title: 'صِرَاط · Sirat Khushu', body: (event.data && event.data.text()) || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'صِرَاط · Sirat Khushu', {
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

// Bounded runtime cache (FIFO). Geocoding/search URLs are high-cardinality (one entry per
// typed query and per GPS jitter) and reciter audio accumulates one file per heard ayah, so
// cap each cache to stop it growing without limit — an unbounded cache could push the origin
// to its storage quota and get the whole origin (including the offline SHELL precache) evicted.
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

  // 1b) reciter audio (cross-origin, ALLOW-LISTED) → CACHE-FIRST: a previously-heard ayah is stored as a
  //     full file (keyed by bare URL) and served instantly — instant replay, ZERO network, and fully
  //     OFFLINE. Recitation audio is immutable, so cache-first has no staleness downside. On a cache
  //     MISS we hit the network and background-cache the full file. We deliberately do NOT cache 206
  //     (partial/range) responses — caches.put() rejects them — only full 200s and opaque (no-CORS)
  //     media responses; a range request offline still matches the cached full file by URL.
  if (AUDIO_HOSTS.has(url.hostname)){
    event.respondWith((async () => {
      try {
        const hit = await caches.match(url.href);
        if (hit) return hit;                          // instant, offline-safe replay of a heard ayah
        const res = await fetch(req);
        // Cache the WHOLE file (a separate non-range fetch keyed by URL) so a previously-heard ayah
        // recites fully OFFLINE. The media element's own request is usually a partial Range response —
        // not replayable, and caches.put() rejects a 206. This is BACKGROUND only: playback still gets
        // the live `res` immediately, so online recitation is never affected. The inner try/catch also
        // swallows the QuotaExceededError that opaque-audio padding can raise (previously an unhandled
        // rejection on every play).
        event.waitUntil((async () => {
          try {
            const c = await caches.open(AUDIO);
            if (await c.match(url.href)) return;                            // full file already cached
            let full;
            try { full = await fetch(url.href); }                          // CORS full 200 (everyayah sends ACAO:*)
            catch (e) { full = await fetch(url.href, { mode: 'no-cors' }); } // opaque full for non-CORS CDNs
            if (full && (full.status === 200 || full.type === 'opaque')){
              await putCapped(AUDIO, new Request(url.href), full.clone(), 200);
            }
          } catch (e) {}
        })());
        return res;
      } catch (e) {
        const cached = (await caches.match(url.href)) || (await caches.match(req));
        return cached || Response.error();
      }
    })());
    return;
  }

  // 2) only same-origin beyond this point — any other foreign host is left untouched
  if (url.origin !== self.location.origin) return;


  // 3) navigations → NETWORK-FIRST so a freshly deployed app shows up immediately on reload;
  //    use the Navigation Preload response when present (faster). Fall back to the cached shell
  //    (then the offline page) only when the network is unavailable.
  if (req.mode === 'navigate'){
    event.respondWith((async () => {
      try {
        let res = null;
        try { res = event.preloadResponse ? await event.preloadResponse : null; } catch (e) { res = null; }
        if (!res) res = await withTimeout(fetch(req), 4500);
        // Clone SYNCHRONOUSLY, before returning res. If we cloned inside the async IIFE (after
        // `await caches.open`), `return res` would already have handed the body to respondWith and
        // locked it, so res.clone() would throw and the SHELL refresh would silently never run —
        // leaving offline users on a stale shell after content-only (no-VERSION-bump) deploys.
        if (res && res.ok){ const copy = res.clone(); event.waitUntil((async () => { const c = await caches.open(SHELL); await c.put('./index.html', copy); })()); }
        return res;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || (await caches.match('./offline.html')) || Response.error();
      }
    })());
    return;
  }

  // 4) other same-origin static (icons, manifest, fonts, local audio) → STALE-WHILE-REVALIDATE:
  //    serve the cached copy instantly if present, and refresh it in the background so a changed
  //    asset self-heals without waiting for a full VERSION bump. No cache yet → go to network.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached){
      event.waitUntil((async () => {
        try { const res = await fetch(req); if (res && res.ok){ const c = await caches.open(SHELL); await c.put(req, res.clone()); } } catch (e) {}
      })());
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok){ const c = await caches.open(SHELL); c.put(req, res.clone()); }
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
