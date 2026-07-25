# Sabr Engine — Security Posture

*Honest mapping of the Security Blueprint to what a client-side, offline-first app can actually do.*

## The security model (read this first)

Sabr Engine is a **single-file, client-side Progressive Web App**. There is **no backend, no server, no database, no API of its own, and no native binary**. Everything — your name, location, prayer logs, journal, bookmarks, settings — lives in **your own browser's `localStorage`, on your device only.** Nothing is ever uploaded.

This changes the threat model completely. Most classic web risks (server breach, SQL injection, API auth, DDoS, admin-panel takeover) **do not apply, because there is no server to attack.** The privacy is structural: there is no central store to leak. The flip side: any "lock" is enforced by code running on the user's own device, so it is a **casual-privacy barrier, not defence against a determined attacker who already has your unlocked device and developer tools.** We are honest about that below.

---

## What IS implemented (the parts that genuinely apply)

| Control | Status | How |
|---|---|---|
| **Password hashing** | ✅ **Salted PBKDF2-SHA256, 210,000 iterations** | Native Web Crypto (`crypto.subtle.deriveBits`). Per-account 16-byte random salt (`crypto.getRandomValues`). Never plaintext, never a single hash. Old accounts stay verifiable and can be re-set. |
| **Brute-force lockout** | ✅ Exponential backoff | After 5 failed unlock/security-answer attempts, the screen locks for 30s, then doubles each time up to 15 min. A correct password is blocked while the cooldown is active. |
| **Transport security** | ✅ HTTPS + HSTS (2 yrs, preload) | Served over TLS by the host; HTTP redirects to HTTPS. |
| **Clickjacking** | ✅ `frame-ancestors 'none'` (CSP) + `X-Frame-Options: DENY` | The app cannot be embedded in an iframe. |
| **MIME sniffing** | ✅ `X-Content-Type-Options: nosniff` | |
| **Referrer / cross-origin leakage** | ✅ `Referrer-Policy: no-referrer`, `COOP`, `CORP` same-origin | |
| **Device permissions** | ✅ Least-privilege `Permissions-Policy` | Only `geolocation` + motion sensors (for qibla) are allowed to `self`; camera, microphone, payment, USB are denied outright. |
| **Content-Security-Policy** | ✅ `default-src 'none'` allow-list | Only 5 opt-in hosts (4 geo/prayer APIs + `'self'`) may be contacted. No inline eval, no foreign scripts, no trackers. This is our "API firewall". |
| **XSS** | ✅ All user/content input HTML-escaped | Username, security question, journal, location names, search queries — every value rendered via `innerHTML` passes through `esc()`. |
| **No hardcoded secrets** | ✅ None shipped | The only API key is *your own* optional EmailJS key, stored in *your* localStorage — never a secret baked into the app. |
| **Dependency risk** | ✅ Zero dependencies | One self-contained HTML file. No `npm`, no CDN, no supply chain to compromise. |
| **Data ownership (GDPR-style)** | ✅ Full export + import + full delete | Settings → "Export my data", "Import a backup" and "Delete everything". Your data is yours; nothing to request from us because we never hold it. Importing your backup on a new device also moves your account there (hashes + salt travel with it, never the password itself). |
| **Login is optional** | ✅ | First launch shows a welcome gate with **Sign up / Log in / Continue without an account**. Signing up puts a login page in front of the app on every launch; guests can use everything, and the choice is remembered. Set `AUTH_REQUIRED = true` in `index.html` to make an account mandatory. |
| **Cloud login (opt-in)** | ✅ scrypt-hashed, token sessions | When a `sabr-push-server` URL is configured, sign-up also registers on **your own server** (`/auth/*`): passwords are scrypt-hashed with per-user salts, and sessions are random 256-bit tokens stored hashed. **Your password and security answer never leave the device** — the synced blob strips those hashes, and a restored device rebuilds its local lock hash from the password you just typed, so a server leak can't expose anyone's password. Sync is guarded by a per-account **revision**: a stale device is told there's a conflict instead of silently overwriting newer data, and the app lets you pick which copy to keep. A password change **revokes every other device's session**. Honest trade-off: with cloud login on, your data blob (settings, logs, journal — not your password) sits on the server you deployed. Leave `CLOUD_URL` empty for the original device-only model. |
| **Password minimum** | ✅ 6+ characters | Enforced at sign-up and password reset. |
| **Password recovery** | ✅ email code (cross-device) | **Email-only**: the user types their email, the server finds the account by that email (case-insensitive) and mails a 6-digit code — **15-min expiry, 6-try cap, per-account 60-second send cooldown** (so a known address can't be inbox-bombed), and the code is stored only as a SHA-256 hash and compared with `timingSafeEqual`. Enter it and set a new password (`/auth/forgot-email` + `/auth/reset-email`, needs SMTP configured on your server). `forgot-email` always answers the same way, so it can't be used to probe which emails are registered. Any reset **signs out all other devices**. (The older security-question routes were removed to close a username-enumeration hole.) |
| **Stay signed in** | ✅ log in once | After the first login you stay signed in on that device across launches — no password on every open. An explicit **Log out** (or the optional "ask every launch" toggle for shared devices) brings the login back. The password is only ever kept as a salted PBKDF2 hash. |

---

## Blueprint mapping — what does NOT apply, and why

These require a backend/server/mobile-binary that Sabr Engine deliberately does not have. They would only become relevant if the app grows a server:

- **§2 JWT/refresh tokens, OAuth, device binding, SMS/email OTP** → no accounts server; the "account" is a local device lock.
- **§3 Code obfuscation, root/jailbreak detection, cert pinning, Keychain/Keystore, tamper detection, screenshot blocking** → these are native-mobile-binary controls; this is a web PWA with no binary to reverse-engineer. (Screenshot blocking has no web API.)
- **§4 Rate limiting, CORS, WAF, DDoS, parameterized queries** → no server or database of ours to protect. (The CSP allow-list is the client-side analog of a firewall.)
- **§5 AES-256 at rest, backups, retention/anonymization** → no server database. On-device data can optionally be encrypted at rest — see below.
- **§6 Infrastructure, secrets vault, IAM, containers** → no infrastructure.
- **§7 Centralized logging, anomaly detection, incident response** → nothing is logged anywhere; there is no telemetry to monitor.
- **§8 Admin panel** → there is no admin panel.
- **§9 Pen-test, bug bounty** → the attack surface is the static files + the on-device lock; an OWASP client-side review is the meaningful audit here.

---

## Honest limitations

- **The passcode lock is casual privacy, not hard security.** It runs on your device. Anyone with your unlocked device and browser developer tools can read `localStorage` or clear the lock counter. It stops a family member from casually opening the app; it does **not** stop a forensic attacker. Real at-rest protection would require encrypting the data with a key derived from your passcode (possible — see next), or full-disk encryption on your device (recommended: enable your phone's lock screen).
- **Optional next step — encryption at rest for lock users:** we can encrypt the entire on-device store with an AES-GCM key derived (PBKDF2) from your passcode, so the raw data is unreadable without it. Trade-off: if you forget *both* your passcode and your security answer, the data is unrecoverable (that is what real encryption means). Not enabled by default to avoid accidental data loss; available on request.
- **Password reset is email-only** (a code mailed to the address on the account). It trades a little security for recoverability by design. The flip side: recovery depends on your server's SMTP being configured and on the account's email being reachable — there is no offline/security-question fallback anymore.

## Reality check (from the blueprint, and we agree)

No app is "unhackable." For a *client-side* app the goal is different from a server app: since there is **no central data to breach**, the win is **collecting almost nothing, keeping it on-device, shipping no secrets, and locking down the browser's own attack surface** (CSP, headers, escaping, strong local hashing). That is defense-in-depth appropriate to what this app actually is.
