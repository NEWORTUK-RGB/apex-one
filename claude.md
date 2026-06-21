# APEX ONE — Developer Guide

## What this is

APEX ONE is a mobile-first, offline-capable Progressive Web App (PWA) for enterprise operations management. It covers CRM, warehouse, production/OEE, e-learning academy, workforce, compliance, and AI copilot — delivered as a single static HTML file with zero npm dependencies.

**Hosted on:** Netlify static hosting  
**Stack:** Vanilla JS + CSS (no framework, no build step) · localStorage · Anthropic Claude API · Service Worker

---

## Repository layout

```
index.html                    Main application (all CSS, JS, and HTML)
sw.js                         Service Worker (offline caching)
manifest.webmanifest          PWA manifest
netlify.toml                  Netlify config (headers, redirects, edge functions)
robots.txt                    Disallow all crawlers
icons/                        PWA icons (192, 512, maskable, apple-touch)
tools/
  make_icons.py               Regenerate PWA icons (stdlib only, no PIL)
  gen_csp_hash.py             Compute SHA-256 hashes for CSP hardening
  version_sw.py               Stamp SW cache version from content hash
netlify/
  edge-functions/
    copilot.js                Optional: server-side Claude API proxy
```

---

## Development workflow

No build step required. Edit `index.html` directly and open in a browser.

For local HTTPS (needed for Service Worker):
```bash
npx serve . --ssl-cert cert.pem --ssl-key key.pem
# or use: npx http-server -S -p 8080
```

---

## Architecture overview

### State management

All application data lives in a single `state` object, serialised to `localStorage['apexone_m2']`.

- **Save:** `save()` — debounced 300ms write via `_flushSave()`
- **Load:** `load()` — called at `init()`, validates with `verifyState()`
- **Caps:** `CAPS` object hard-limits each collection to prevent storage overflow
- **Prune:** `pruneShifts()` removes shift data older than 180 days

### Router

Hash-based SPA routing. `navigate(page)` sets `location.hash`, which triggers `hashchange`, which re-renders the page via `PAGES[page]()`.

### Security

- PIN lock: 4-digit, PBKDF2 (150k iterations, random salt), brute-force lockout
- Input: `sanitize()` strips XSS vectors; `esc()` HTML-encodes all output
- API key: stored in `localStorage['apexone_api']` — user-provided, never logged
- Frame embedding: blocked via JS and `X-Frame-Options: DENY`

### AI Copilot

Direct browser → Anthropic API call using the user's own key.

**To switch to server-side proxy (recommended for production):**
1. Set `ANTHROPIC_API_KEY` in Netlify → Site Configuration → Environment variables
2. The `netlify/edge-functions/copilot.js` is already deployed and registered
3. In `index.html`, change the fetch URL in `sendCopilot()` from:
   `https://api.anthropic.com/v1/messages` → `/api/copilot`
4. Remove the `x-api-key` header and `anthropic-dangerous-direct-browser-access` header from the fetch
5. Remove the API key input from the settings page (the key lives server-side)

---

## Security hardening checklist

### Replace `unsafe-inline` in CSP

Every time the inline script block in `index.html` changes, recompute its hash:

```bash
python3 tools/gen_csp_hash.py
```

Copy the output hash and replace `'unsafe-inline'` with it in:
- `netlify.toml` → `Content-Security-Policy` → `script-src`
- `index.html:8` → `<meta http-equiv="Content-Security-Policy">` → `script-src`

### Stamp Service Worker version before deploy

```bash
python3 tools/version_sw.py
```

This updates the SW cache version string to include a content hash of `index.html`, ensuring all cached users receive updates.

---

## Netlify environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Optional | Server-side copilot proxy (edge function) |

Set via: Netlify dashboard → Site → Configuration → Environment variables

---

## Adding a new module / page

1. Add an entry to `MODULES` array with `{id, l, i, s}` (id, label, icon, section)
2. Add `PAGES.<id> = function() { $('view').innerHTML = ...; }` 
3. If the module has data, add its collection key to `state`, `CAPS`, and `verifyState()`
4. Optionally add a form config to `FORMS`
5. Add seed data to `SEED` for demo purposes

---

## Backup format (v2)

```json
{
  "version": 2,
  "app": "APEX ONE",
  "exportedAt": "2026-06-15T12:00:00.000Z",
  "exportedBy": "Manager",
  "data": { ...state object... }
}
```

Legacy backups (raw state object without wrapper) are still supported by `importData()`.

---

## Rollback strategy

If a bad deploy reaches production:

1. **Netlify instant rollback** — go to Netlify dashboard → Deploys → click any prior deploy → "Publish deploy". Takes ~10 seconds and requires no git action.

2. **Git revert** — for reverting a specific commit without force-push:
   ```bash
   git revert <commit-sha>
   git push origin main
   ```
   Netlify auto-deploys the revert commit.

3. **User data safety** — all user data lives in `localStorage` on the device, not the server. A bad deploy cannot corrupt existing user data; rolling back the app shell is sufficient.

4. **Service Worker** — after rollback, users on the old SW version will auto-update within one page reload because `python3 tools/version_sw.py` stamps a new cache key on every build. No manual SW clearing is needed.

---

## Known limitations & roadmap

| Limitation | Impact | Resolution |
|---|---|---|
| localStorage only (~5MB) | Data lost if browser storage is cleared | Migrate to IndexedDB; add optional cloud sync |
| Single device | No multi-device or multi-user | Add Supabase backend for cloud persistence |
| `script-src 'unsafe-inline'` | Weakens XSS protection | Use `gen_csp_hash.py` and replace with hash |
| Client-side rate limiting | Bypassable by page reload | Use edge function proxy (`/api/copilot`) |
| No automated tests | Regressions caught manually | Add Playwright E2E tests for critical paths |
