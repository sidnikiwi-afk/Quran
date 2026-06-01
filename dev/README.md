# dev/ — visual smoke test

Headless-Chrome screenshots of the **real** running app (not a Python replica),
for eyeballing key states before a deploy. This folder is **not** deployed —
GitHub Pages only publishes `app/`.

## Run
```bash
cd dev
npm install          # installs puppeteer-core (uses your existing Chrome)
npm run smoke
```
Screenshots land in `dev/screenshots/` (gitignored). The script also prints
PASS/FAIL checks and exits non-zero on failure.

If Chrome isn't auto-found:
```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run smoke
```

## What it captures (`smoke.js`)
1. `1-highlight-7_40.png` — portrait, ayah-by-ayah highlight of Al-A'raf 7:40.
2. `2-highlight-2_255.png` — Ayat al-Kursi (multi-line).
3. `3-dual-juz17.png` — landscape dual spread at Juz 17; **asserts right=447 / left=448**.
4. `4-surah-mulk.png` — surah jump (Al-Mulk → p786).

It serves `../app` on an ephemeral localhost port, drives Chrome muted, and calls
the app's own functions (`playAyahAudio`, `goToPage`) directly — no audio/gesture
needed. Add scenarios by copying a block in `smoke.js`.

## Limits
No real audio, no touch gestures, no iOS-PWA specifics — test those on a device.
