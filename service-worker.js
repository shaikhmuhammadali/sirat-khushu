/* ═══════════════════════════════════════════════════════════════════════════
   Sirat Khushu — Service Worker
   • Precache the (single-file, self-contained) app shell with a VERSIONED cache.
   • cache-first for static assets; network-first (short timeout → cache) for the
     four whitelisted geo/prayer APIs; offline fallback for navigations.
   • NEW (v3.84.0): offline Qur'an recitation — reciter audio from the two
     allow-listed CDNs is cached on first play so a heard ayah recites offline;
     Navigation Preload for faster first paint; stale-while-revalidate for static.
   • Never phones home: this worker only ever fetches same-origin assets, one of
     the four opt-in API hosts, or the three allow-listed reciter-audio CDNs —
     nothing else, upholding the app's constitution and matching the page CSP.
   • A new version WAITS on install; the page prompts the user to Reload (opt-in) instead of force-reloading,
     so a running session is never swapped out underneath the user.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const VERSION = 'sabr-engine-v3.185.0';         // ← bump to ship an update (clients auto-drop the old cache)
const SHELL   = VERSION + '-shell';
const RUNTIME = VERSION + '-runtime';
// Reciter audio (offline recitation) is bounded + FIFO. Its name is DELIBERATELY version-independent so a
// VERSION bump never wipes ayat the user already heard — recitation audio is immutable, so there is nothing
// to invalidate, and the FIFO cap (200) keeps it bounded. Bump the -vN suffix only if the URL/bitrate scheme
// ever changes. (The activate purge below explicitly exempts this cache.)
const AUDIO   = 'sabr-engine-audio-v1';

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
  'cdn.islamic.network',
  'audio.qurancdn.com'
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
  './img/hadith-frame.jpg',
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
  // NOTE: no unconditional skipWaiting() here. A new version now WAITS until the user opts in via the
  // "A new version is ready — Reload" toast (which posts SKIP_WAITING, handled below), so a background
  // update never force-reloads the page and discards in-progress state (unsaved journal / open Prayer Lock).
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Purge every OLD versioned cache (shell/runtime/audio of prior versions) but KEEP the persistent,
    // version-independent reciter-audio cache — otherwise each update silently wiped offline recitation.
    await Promise.all(keys.filter(k => k !== AUDIO && !k.startsWith(VERSION)).map(k => caches.delete(k)));
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

// Background-cache the WHOLE reciter-audio file (a separate, non-range fetch keyed by bare URL) so a
// heard ayah recites fully OFFLINE later. Playback itself never waits on this. Tries a CORS full 200
// first (everyayah sends ACAO:*), then an opaque no-CORS full for CDNs that don't. The FIFO cap keeps
// it bounded. Swallows the QuotaExceededError opaque-audio padding can raise. No-op if already cached.
async function warmAudio(href){
  try {
    const c = await caches.open(AUDIO);
    if (await c.match(href)) return;                                   // full file already cached
    let full;
    try { full = await fetch(href); }                                 // CORS full 200
    catch (e) { full = await fetch(href, { mode: 'no-cors' }); }       // opaque full for non-CORS CDNs
    if (full && (full.status === 200 || full.type === 'opaque')){
      await putCapped(AUDIO, new Request(href), full.clone(), 200);
    }
  } catch (e) {}
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

  // 1b) reciter audio (cross-origin, ALLOW-LISTED). Policy is split by connectivity (see the ONLINE/OFFLINE
  //     branches below): ONLINE we hand the request entirely to the browser's native media stack and merely
  //     warm the full-file cache in the background (a SW-mediated cross-origin/opaque/range media response
  //     is a known Android-WebView playback hazard); OFFLINE we serve cache-first so a previously-heard ayah
  //     recites with ZERO network. Recitation audio is immutable, so the cached copy never goes stale. We
  //     deliberately do NOT cache 206 (partial/range) responses — caches.put() rejects them — only full 200s
  //     and opaque (no-CORS) media responses; a range request offline still matches the cached full file by URL.
  if (AUDIO_HOSTS.has(url.hostname)){
    const online = !(self.navigator && self.navigator.onLine === false);
    // ── ONLINE → hand the request ENTIRELY to the browser's native media stack (do NOT respondWith). ──
    // A service-worker-mediated cross-origin / opaque / range media response is a known way to break
    // <audio> playback in the Android System WebView (it stalls, or never fires 'canplay'). By simply
    // returning — never calling respondWith — the media element fetches the ayah itself over the
    // network exactly as it would with no service worker at all: bulletproof on the WebView, identical
    // on the desktop. We still warm the full-file cache in the background so it recites offline later.
    // This is the core reason recitation now "just plays". (Online we always go to network; the tiny
    // cost of not serving a cached replay is worth guaranteed playback.)
    if (online){ event.waitUntil(warmAudio(url.href)); return; }
    // ── OFFLINE → cache-first: a heard-once ayah recites forever (a range request still matches the
    //    cached full file by URL). Nothing heard yet → a clean error the client explains kindly. ──
    event.respondWith((async () => {
      const cached = (await caches.match(url.href)) || (await caches.match(req));
      return cached || Response.error();
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
        // Offline navigation: prefer the cached app shell (fully functional offline); only if the shell was
        // never cached (e.g. a brand-new install that went offline mid-first-load) fall back to the minimal
        // offline.html, which is now precached so this branch can actually reach it.
        return (await caches.match('./index.html')) || (await caches.match('./')) || (await caches.match('./offline.html')) || Response.error();
      }
    })());
    return;
  }

  // 3b) LARGE, BYTE-IMMUTABLE, version-scoped assets (the 2.9MB Qur'an JSON, the Hafs font, the hadith
  //     frame image, bundled voice/salawat audio) → CACHE-FIRST with NO background revalidation. These do
  //     not change for the life of a VERSION, and the activate purge already drops the whole SHELL cache on
  //     a version bump — so stale-while-revalidate re-downloads several megabytes every session for nothing.
  //     This is the single largest client-bandwidth / CDN-egress lever in the app. Serve the cached copy
  //     instantly; hit the network ONLY on a genuine cache miss (first ever load, or a fresh version).
  if (/\/(data|fonts|img)\/|\/audio\/.+\.mp3$/.test(url.pathname)){
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok){ const c = await caches.open(SHELL); c.put(req, res.clone()); }
        return res;
      } catch (e) { return Response.error(); }
    })());
    return;
  }

  // 4) other same-origin static (icons, manifest) → STALE-WHILE-REVALIDATE:
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
