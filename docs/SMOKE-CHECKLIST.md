# Pre-deploy smoke checklist

Automated: `cd dev && npm install && npm run smoke` (headless-Chrome screenshots +
asserts; see `dev/`). Manual passes below for things the harness can't cover
(real audio, touch, iOS PWA).

## Automated (dev/smoke.js)
- [ ] Ayah highlight draws strips (7:40, 2:255).
- [ ] Landscape dual spread parity: right 447 / left 448 at Juz 17.
- [ ] Surah jump renders (Al-Mulk → 786).

## Manual (real device / browser)
- [ ] Page turn: swipe + tap zones, portrait & landscape (dual spread pairs correctly).
- [ ] Menu nav: Surah list, Juz grid, Go-to-Page, Go-to-Ayah, Search, Sajda list.
- [ ] Audio Tier 1 (Bandar Baleelah whole-surah) plays + auto-advances; lock-screen controls.
- [ ] Audio Tier 2 (ayah reciter) plays ayah-by-ayah, page auto-turns, highlight follows, Repeat ayah loops.
- [ ] Hifz: range loop (From/To/Times); Hide-lines covers + tap reveals.
- [ ] Themes: Light / Sepia / Dark all legible on real scans.
- [ ] Bookmarks: add, Export downloads JSON, Import merges (no dupes).
- [ ] Reading Progress: % climbs as you read; Resume / Complete-Khatm / Reset.
- [ ] Offline: after a load, airplane-mode still serves pages + nav (SW). Install button on Android.

## Error / offline states (graceful, non-crashing — verify they don't break)
- Corrupt `quran-state` in localStorage → app loads with defaults (try/catch in `loadState`).
- Data JSON fetch fails (offline, first use) → search/highlight/jump show a soft message, no crash (loaders catch).
- Audio CDN unreachable → playback fails silently (`.catch`), UI stays usable.
- Stale service worker → auto-update reloads once on new deploy (see `registerServiceWorker`).

## Reminder
Bump `CACHE_NAME` in `app/sw.js` on **every** change to app.js/css/index.html/data,
or clients keep the stale cache.
