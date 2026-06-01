# CLAUDE.md — Quran PWA reader

13-line Quran reader (SA Waterval Islamic Institute / Taj Company edition) as an
offline-first PWA. Vanilla JS, no framework, no build step.

- **Live:** https://sidnikiwi-afk.github.io/Quran/
- **Repo:** `sidnikiwi-afk/Quran` (public)
- **Deploy:** GitHub Pages via `.github/workflows/deploy.yml` — auto-deploys the
  `app/` folder on every push to `master` (~1 min). Verify a run with
  `gh run list --limit 1`.

## Layout
```
app/
  index.html            # shell
  css/styles.css
  js/app.js             # all app logic (~1400 lines, single file)
  sw.js                 # service worker (versioned cache + auto-update)
  manifest.json
  data/
    metadata.json       # mushaf info, surahs[], juz[] (startPage = IMAGE number)
    page-ayah-index.json# ayah<->page index (see below)
  images/pages/{thumb,medium,high}/<n>.webp   # 847 page images per tier
```

## Page numbering (important)
- The app navigates by **image number** 1–847. `getImageUrl()` uses the page
  number directly as the file name (`images/pages/<tier>/<page>.webp`).
- The **printed** Arabic page number on each scan = **image number + 1** (the
  cover is image 1). So image 28 shows printed "٢٩". Don't conflate the two.
- `metadata.json` `juz[].startPage` and `surahs[].startPage` are **image
  numbers**. The QUL ayah-index `page` values are also image numbers (offset 0).

## Data: ayah <-> page index (`data/page-ayah-index.json`)
- Built 2026-05-31 from **QUL (Quranic Universal Library, qul.tarteel.ai)**:
  Indopak 13-line **Taj Company** layout (resource 313) joined with the QUL
  **Indopak word script** (resource 55, 83,668 words).
- **Validated exact match** to our scan (offset 0), confirmed at ayah level:
  `2:142→28, 2:253→56, 17:1→392, 21:1→448, 67:1→786, 78:1→818, 1:1→1, 2:1→2`.
- Format: `pages{ "<page>": [firstSurah, firstAyah, lastSurah, lastAyah] }` and
  `ayahToPage{ "<surah>:<ayah>": <page> }` (page where the ayah begins).
- Used by **Go to Ayah** (Surah:Ayah jump). Loaded lazily; also in the SW shell
  for offline use. Unblocks audio auto-turn, search, translation panel.
- **`data/page-lines.json`** — per-line **text bounding boxes**
  `[yTop,yBottom,xLeft,xRight]` (image fractions), from projection profiles
  (center-tiled y; column-detected x ≈ 0.07–0.91). **`data/ayah-lines.json`** —
  `ayah "S:A" -> [[page,line,t0,t1],...]` where `t0,t1` are RTL fractions along
  the line (0=right edge, 1=left); middle lines are `[0,1]`, the first/last line
  shared with a neighbour ayah is trimmed to that ayah's word span (word-count
  proportional — exact word x-boxes aren't extractable from the scans). Power the
  line-level highlight overlay; same boxes feed Hifz hide/reveal.
- QUL data licence/attribution still TODO before any public re-distribution.
- A free QUL account (sidni.kiwi@gmail.com) was created to download the gated
  datasets; download path pattern: `/resources/<type>/<hash>/download` → zip → DB.

## Visual smoke test (`dev/`)
Before a deploy, screenshot the **real** running app in headless Chrome:
`cd dev && npm install && npm run smoke`. It serves `app/` locally, drives the
installed Chrome (puppeteer-core), invokes the app's own functions, screenshots
key states into `dev/screenshots/`, and asserts invariants (e.g. landscape dual
spread = right 447 / left 448 at Juz 17). Not deployed. Add scenarios in
`dev/smoke.js`. (Python overlay-on-image checks are still handy for validating
the line-band/index *data* without a browser.)

## Service worker discipline (read before editing assets)
- `sw.js` has `CACHE_NAME = 'quran-vN'`. **Bump N on every change to app.js /
  css / index.html / data files**, or clients keep serving the stale cache.
  History so far reached `quran-v7`.
- `SHELL_FILES` is precached on install; app shell is network-first, page images
  are cache-first. Auto-update is wired in `registerServiceWorker()`: it calls
  `reg.update()` on load / hourly / on focus and reloads once when a new SW takes
  control (guarded so it doesn't reload on first install). Saved `currentPage`
  makes the reload seamless.

## State / storage
- All persisted state is one localStorage key `quran-state`
  (`loadState`/`saveState`). `schemaVersion: 2`. Keep types **JSON-safe** (e.g.
  `progress.visited` is an array, not a Set).
- Holds: currentPage, theme, brightness, keepAwake, dualPage, bookmarks[],
  markers{}, progress{visited[], khatms[]}.

## Features (current)
Already present: page swipe/tap nav, surah list, juz pills, **Go to Page**, dark
mode (CSS invert on page images) + brightness + keep-awake, dual-page, bookmarks,
page markers/notes, **Download all pages** (offline).
Added in the 2026-05-31 upgrade pass:
- **Reading Progress & Khatm tracker** — visited %, bar, Resume / Complete-Khatm
  / Reset (menu “Reading Progress”).
- **Go to Ayah** — Surah:Ayah jump via the ayah-index.
- **Audio** — one mini-player with two modes, switched by a reciter selector in
  the Audio menu:
  - **Tier 1 (whole surah, Bandar Baleelah)** — streams from the QF CDN
    `download.quranicaudio.com/quran/bandar_baleela/complete/<SSS>.mp3`
    (CORS + range/seek). NOT bundled (local `Bandar Baleelah/` quarter files are
    ~750MB, too heavy for Pages).
  - **Tier 2 (ayah-by-ayah)** — streams per-ayah from everyayah.com
    `everyayah.com/data/<reciter>/<SSSAAA>.mp3` (Alafasy/Husary/Ash-Shaatree/
    Minshawi/Sudais — Baleelah isn't on per-ayah sources). Continuous ayah
    advance via `AYAH_COUNTS`, **page auto-turn** via `page-ayah-index.json`
    (follow-pages toggle), per-ayah label, MediaSession, **Repeat-ayah** loop.
  Key fns: `initAudio()`, `playSurahAudio()`, `playAyahAudio()`,
  `audioStep()`/`audioEnded()` (mode-aware). Streaming only, no bulk cache.
  Page-level index gives ayah sequencing + auto-turn but NOT on-image ayah
  highlight (no x/y geometry) — out of scope.
- **Ayah highlight** — line-level strips follow Tier-2 audio (`renderHighlight`),
  using `page-lines.json` (per-line boxes) + `ayah-lines.json` (RTL fractional
  segments). Shared-line edges are **inset (bias-early)** so it never bleeds into
  the neighbour ayah. Intra-line cut is approximate (justified text; no word
  x-boxes) — exact line membership, approximate horizontal trim.
- **Hifz mode** (menu section) — (1) **Repeat range**: From/To surah:ayah + Times
  (0 = ∞) loops the ayah range via Tier-2 audio; (2) **Hide lines**: opaque covers
  over each line (`#hifz-cover-layer`, page-lines bands), tap a line to reveal.
  Keys: `startHifzRange()`, `audioEnded()` range branch, `renderHifzCovers()`.

## More shipped features (2026-06-01 batch)
- **Backup** (Bookmarks menu): Export → `quran-backup.json`; Import → merges
  bookmarks/markers/progress (dedupe, never overwrite). `exportData`/`importData`.
- **Ayah text search** (Search menu): normalized-Arabic substring over
  `data/search-index.json` (lazy) → jump via index. `normalizeArabic`/`searchAyat`.
- **Sajda verses** menu: 15 standard Hafs sajda verses (`SAJDA_VERSES`) → jump.
- **Themes**: Light / Sepia / Dark (`setTheme`; sepia = warm palette + sepia
  filter, no invert).
- **Install + storage**: A2HS prompt (`beforeinstallprompt`) + `navigator.storage`
  usage readout in the Offline menu.
- **Translation panel** (`data/translation-en.json`, Pickthall, public domain):
  bottom sheet of the current page's ayahs; `openTranslationPanel`.
- Deferred (noted on cards): cloud sync, ruku/hizb marker lists, daily goals/
  streaks, smart SW precache-window/low-data, tafsir + tap-on-image overlay.
- Licensing catalogue: `docs/SOURCES.md`. Pre-deploy checks: `docs/SMOKE-CHECKLIST.md`.

## Upgrade roadmap
Tracked on the Hermes kanban board **`quran`** (http://127.0.0.1:9119/kanban →
"Quran"). Cards refined by Claude Code + a Codex scoping review. Agreed build
order lives as a comment on the "[Foundation] storage schema" card. Remaining
big items: Audio (multi-reciter, phased; Bandar Baleelah quarter-Juz files are in
`Bandar Baleelah/`, everyayah per-ayah for precise mode), bookmark export/import,
ayah text search, Hifz mode, translation panel (needs licence clearance).

## Gotchas
- **Dual-page (landscape) spread parity:** spreads must be (odd = right, even =
  left) to match the physical mushaf. `renderPage` anchors to the odd page in
  dual mode (`if (_isDualActive && page % 2 === 0) page = page - 1`). Don't pair
  `(currentPage, currentPage+1)` blindly or even-start juz/surahs land wrong.
- Ayah highlight is **line-level** (full-width line strips), not word boxes —
  honest to the data (no per-ayah x/y on scans). Highlight follows Tier-2 audio.
- Don't auto-dark the **page image** from `prefers-color-scheme`; invert is
  opt-in and needs visual QA on real scans (Codex flag).
- Page-level index does NOT give on-image ayah **regions** (x/y) — no tap-on-ayah
  highlight without separate geometry data.
- Commit/push only when asked; this is a personal project with few users.
