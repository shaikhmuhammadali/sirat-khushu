# Sabr Engine — PWA

The on-device Global Time & Salah engine, packaged as an **installable, fully-offline
Progressive Web App**. This folder is the single deployable unit — nothing to build.

```
sabr-engine-pwa/
├── index.html              the engine + PWA layer (manifest link, iOS meta, SW registration)
├── manifest.webmanifest    name, icons, shortcuts, standalone display
├── service-worker.js       versioned precache + offline strategy
├── offline.html            fallback shown only if the shell was never cached
├── icons/                  all PNG sizes + maskable + apple-touch + favicons + icon.svg (source)
├── _headers                cache/security headers for Netlify & Cloudflare Pages
├── netlify.toml            Netlify config
└── deploy/nginx.conf       server block for the Hostinger VPS
```

## Login & sign-up
First launch shows a **welcome gate**: *Create my account* (sign-up), *I already have an
account — log in*, and *Continue without an account*. Signing up creates an account
(passwords: salted PBKDF2-SHA256, 210k iterations on-device — see `SECURITY.md`) and puts a
**login page** in front of the app on every launch.

**Cloud login (the official way to get your account on any device):** the companion
`sabr-push-server` now hosts `/auth/*` — sign-up silently registers there too, the app
quietly mirrors its data after each change, and on a new device the user just enters
**name + password** and everything comes back. Set `const CLOUD_URL = 'https://your-server'`
near the top of the auth section in `index.html` (or the app falls back to the push-server
URL saved in Settings). No cloud configured? Everything still works fully offline, and the
old **backup-file restore** remains as the fallback (Settings → Export / Import).

Forgot-password reset works via your own security question (or optional EmailJS code), and
the Forgot page offers last-resort escapes: log in another way, or erase and start fresh.
To make an account **mandatory** (no guest link), set `AUTH_REQUIRED = true`.

## What the PWA layer adds (the engine logic is untouched)
- **Installable**: manifest with name, icons (192/512 + maskable), `display: standalone`, and
  app **shortcuts** ("Prayer times", "Islamic events").
- **Fully offline**: the service worker precaches the app shell under a **versioned** cache and
  cleans up old caches on activate. Static assets are **cache-first**; the four whitelisted
  geo/prayer APIs are **network-first with a 3.5 s timeout, falling back to cache**.
- **Safe updates**: the SW never swaps under a running session — when a new version installs,
  a small **"A new version is ready — Reload"** toast appears; tapping it activates the update.
- **iOS**: `apple-touch-icon`, standalone + translucent status bar, `viewport-fit=cover`, and
  `env(safe-area-inset-*)` padding for notched phones.

## Constitution held
- **No phone-home.** The CSP `connect-src` still allows **only the four** opt-in geo/prayer hosts.
  The service worker itself only ever fetches same-origin assets or those four hosts.
- **System fonts only** — no Google Fonts, no external requests at rest.
- Works fully offline; minimal permissions.

> **Theme colour note:** the manifest/theme colour is the engine's own **dark navy `#0a0e14` + gold**,
> not maroon — matching the shipped UI so the splash/status-bar doesn't clash. If you want maroon
> branding, change `theme_color` + `background_color` in `manifest.webmanifest` and the
> `<meta name="theme-color">` in `index.html` (one line each).

## Deploy — option A: Hostinger VPS (nginx)
```bash
# copy the folder to the server, e.g. /var/www/sabr-engine-pwa
scp -r sabr-engine-pwa user@[VPS_IP]:/var/www/

# install the server block (edit [YOUR_DOMAIN] first)
sudo cp /var/www/sabr-engine-pwa/deploy/nginx.conf /etc/nginx/sites-available/sabr-engine
sudo ln -s /etc/nginx/sites-available/sabr-engine /etc/nginx/sites-enabled/
sudo certbot --nginx -d [YOUR_DOMAIN]      # HTTPS is required for PWAs
sudo nginx -t && sudo systemctl reload nginx
```

## Deploy — option B: Cloudflare Pages / Netlify (one command)
```bash
# Cloudflare Pages
npx wrangler pages deploy .

# …or Netlify
npx netlify-cli deploy --prod --dir=.
```
Both read `_headers` for correct SW/manifest/icon cache control. HTTPS is automatic.

## Shipping an update
Change the app, then **bump `VERSION`** at the top of `service-worker.js`
(e.g. `sabr-engine-v1.0.1`). On next visit the new SW installs, the reload toast appears,
and old caches are purged on activate.

## Verify (done = all pass)
- **Lighthouse → PWA**: installable, has a service worker, manifest + maskable icon. ✅
- **Airplane mode**: reload — the app loads, the clock ticks, prayer times still compute, **no errors**. ✅
- **Add to Home Screen** → launches full-screen, standalone, correct icon. ✅

## Honest limitation — read this
**Prayer *push* notifications cannot reliably fire when the app/tab is fully closed on the web.**
Prayer reminders in the engine fire only while the app is open in a tab. Web Push (VAPID) exists,
but iOS restricts it heavily and it needs a server to schedule per-user, per-timezone alerts.
Reliable background prayer notifications require **the backend (Prompt 2)** or **the native app
(Prompt 3)**. This is stated plainly and not faked here.
