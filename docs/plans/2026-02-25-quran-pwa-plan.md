# Quran 13-Line PWA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an offline-capable PWA for reading the South African 13-line Quran on iPhone with swipe navigation, bookmarks, mistake markers, and dual-page landscape mode.

**Architecture:** Static PWA with vanilla JS. Page images extracted from Internet Archive PDF, converted to two-tier WebP (medium + high-res). All state in localStorage. Service worker for offline caching. No build step — just HTML/CSS/JS served from GitHub Pages.

**Tech Stack:** Vanilla JS, Service Worker API, CSS transforms, Wake Lock API, GitHub Pages

**Design doc:** `docs/plans/2026-02-25-quran-pwa-design.md`

---

## Phase 1: Asset Pipeline (PDF → Page Images)

### Task 1: Install image processing tools

**Step 1: Install poppler and cwebp via Homebrew**

```bash
brew install poppler webp
```

Poppler gives us `pdftoppm` (PDF → PNG). `cwebp` converts PNG → WebP.

**Step 2: Install Python PDF library as fallback**

```bash
pip install PyMuPDF
```

**Step 3: Verify tools**

```bash
pdftoppm -v
cwebp -version
python3 -c "import fitz; print(fitz.__doc__)"
```

Expected: version numbers printed for all three.

---

### Task 2: Download the mushaf PDF

**Step 1: Download from Internet Archive**

The PDF is at: `https://archive.org/details/13LineQuran`

```bash
cd "/Users/saeed/Library/CloudStorage/GoogleDrive-sidni.kiwi@gmail.com/My Drive/Work/Quran"
mkdir -p assets/source
# Download the PDF (check the exact download URL from the Archive page)
curl -L "https://archive.org/download/13LineQuran/13LineQuran.pdf" -o assets/source/13LineQuran.pdf
```

**Step 2: Inspect the PDF**

```bash
pdfinfo assets/source/13LineQuran.pdf
```

Expected: Shows page count (~848 pages), page dimensions, etc. Note the exact page count — we need this for the app metadata.

**Step 3: Verify a sample page**

```bash
pdftoppm -png -f 1 -l 1 -r 300 assets/source/13LineQuran.pdf assets/source/test-page
open assets/source/test-page-1.png
```

Expected: Opens first page as a clear PNG image. Verify it's the correct mushaf and readable.

---

### Task 3: Extract all pages and convert to WebP

**Files:**
- Create: `scripts/extract-pages.sh`

**Step 1: Write the extraction script**

```bash
#!/bin/bash
# Extract all pages from mushaf PDF and convert to two-tier WebP
set -e

PDF="assets/source/13LineQuran.pdf"
PAGES_MED="app/images/pages/medium"
PAGES_HIGH="app/images/pages/high"
PAGES_THUMB="app/images/pages/thumb"
TMP="assets/source/tmp-pages"

mkdir -p "$PAGES_MED" "$PAGES_HIGH" "$PAGES_THUMB" "$TMP"

# Get page count
PAGE_COUNT=$(pdfinfo "$PDF" | grep "Pages:" | awk '{print $2}')
echo "Extracting $PAGE_COUNT pages..."

# Extract all pages as PNG at 300 DPI (high quality source)
pdftoppm -png -r 300 "$PDF" "$TMP/page"

# Convert each page to WebP at three tiers
for png in "$TMP"/page-*.png; do
    # Extract page number from filename (page-001.png -> 1)
    num=$(echo "$png" | grep -o '[0-9]*' | tail -1)
    # Remove leading zeros
    num=$((10#$num))

    echo "Processing page $num..."

    # High quality (~300KB) - for zoom
    cwebp -q 85 -resize 1800 0 "$png" -o "$PAGES_HIGH/$num.webp"

    # Medium quality (~100KB) - default view
    cwebp -q 70 -resize 1000 0 "$png" -o "$PAGES_MED/$num.webp"

    # Thumbnail (~5KB) - for progressive loading blur
    cwebp -q 30 -resize 100 0 "$png" -o "$PAGES_THUMB/$num.webp"
done

echo "Done! Pages extracted to app/images/pages/"
echo "Medium: $(ls $PAGES_MED | wc -l) files, $(du -sh $PAGES_MED | awk '{print $1}')"
echo "High: $(ls $PAGES_HIGH | wc -l) files, $(du -sh $PAGES_HIGH | awk '{print $1}')"
echo "Thumb: $(ls $PAGES_THUMB | wc -l) files, $(du -sh $PAGES_THUMB | awk '{print $1}')"

# Cleanup temp PNGs
rm -rf "$TMP"
```

**Step 2: Run the extraction**

```bash
chmod +x scripts/extract-pages.sh
./scripts/extract-pages.sh
```

Expected: All pages extracted. Medium tier ~80-150MB total, high tier ~200-350MB, thumbs ~5MB.

**Step 3: Spot-check several pages**

```bash
open app/images/pages/medium/1.webp    # First page
open app/images/pages/medium/100.webp  # Middle
open app/images/pages/medium/400.webp  # Further in
```

Expected: All pages clear and readable. Arabic text crisp.

**Step 4: Commit**

```bash
git add scripts/extract-pages.sh
git commit -m "feat: add page extraction script (PDF to WebP)"
```

Note: Do NOT commit the images to git. Add to `.gitignore`:
```
app/images/pages/
assets/source/
```

---

### Task 4: Create Quran metadata (surah/juz page mappings)

**Files:**
- Create: `app/data/metadata.json`

**Step 1: Research page mappings**

We need a JSON file mapping each surah and juz to its starting page number in the South African 13-line mushaf. This is specific to this print — different from the Madinah mushaf.

Search for existing mappings or manually verify against the extracted page images. The Internet Archive version notes say pages are oriented right-to-left as in the physical copy.

**Step 2: Create metadata.json**

```json
{
  "totalPages": 848,
  "pageDirection": "rtl",
  "surahs": [
    { "number": 1, "name": "Al-Fatihah", "nameArabic": "الفاتحة", "page": 1 },
    { "number": 2, "name": "Al-Baqarah", "nameArabic": "البقرة", "page": 2 },
    ...all 114 surahs with correct page numbers for this mushaf...
  ],
  "juz": [
    { "number": 1, "name": "Alif Lam Mim", "nameArabic": "الم", "page": 1 },
    { "number": 2, "name": "Sayaqool", "nameArabic": "سيقول", "page": 22 },
    ...all 30 juz with correct page numbers for this mushaf...
  ]
}
```

**Important:** Page numbers MUST be verified against the actual extracted images. Open page images and check surah/juz boundaries match. The 13-line mushaf has different page numbers than the 15-line Madinah mushaf.

**Step 3: Verify at least 5 surah start pages against images**

```bash
# Check Al-Fatihah, Al-Baqarah, Yasin, Al-Mulk, An-Nas
# Open each page and verify the surah starts there
```

**Step 4: Commit**

```bash
git add app/data/metadata.json
git commit -m "feat: add surah and juz page mappings for SA 13-line mushaf"
```

---

## Phase 2: Core PWA Shell

### Task 5: Project scaffolding

**Files:**
- Create: `app/index.html`
- Create: `app/css/styles.css`
- Create: `app/js/app.js`
- Create: `app/manifest.json`
- Create: `.gitignore` (update)

**Step 1: Create directory structure**

```bash
mkdir -p app/{css,js,data,images/pages/{medium,high,thumb},icons}
```

**Step 2: Create index.html**

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#f5f0e8">
    <title>Quran 13-Line</title>
    <link rel="manifest" href="manifest.json">
    <link rel="apple-touch-icon" href="icons/icon-192.png">
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <!-- Page viewer -->
    <div id="reader">
        <div id="page-container">
            <img id="page-img" src="" alt="Quran page" draggable="false">
            <!-- Dual page mode: second image -->
            <img id="page-img-2" src="" alt="Quran page" draggable="false" hidden>
        </div>

        <!-- Tap zones for navigation -->
        <div id="tap-left" class="tap-zone"></div>
        <div id="tap-right" class="tap-zone"></div>

        <!-- Page number indicator -->
        <div id="page-indicator"></div>

        <!-- Juz/Surah colour tab -->
        <div id="juz-tab"></div>

        <!-- Mistake markers layer -->
        <div id="markers-layer"></div>
    </div>

    <!-- Menu button -->
    <button id="menu-btn" aria-label="Menu">&#9776;</button>

    <!-- Menu overlay -->
    <div id="menu-overlay" hidden>
        <div id="menu-panel">
            <!-- Populated by JS -->
        </div>
    </div>

    <!-- Marker edit dialog -->
    <div id="marker-dialog" hidden>
        <div id="marker-dialog-inner">
            <textarea id="marker-note" placeholder="Add a note (optional)"></textarea>
            <div id="marker-actions">
                <button id="marker-save">Save</button>
                <button id="marker-delete">Delete</button>
                <button id="marker-cancel">Cancel</button>
            </div>
        </div>
    </div>

    <script src="js/app.js"></script>
</body>
</html>
```

**Step 3: Create manifest.json**

```json
{
    "name": "Quran 13-Line",
    "short_name": "Quran",
    "description": "South African 13-line Quran reader",
    "start_url": "/",
    "display": "standalone",
    "orientation": "any",
    "background_color": "#f5f0e8",
    "theme_color": "#f5f0e8",
    "icons": [
        { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
        { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
    ]
}
```

**Step 4: Create initial CSS (styles.css)**

Set up the full-screen reader layout, dark/light theme variables, tap zones, page transitions. Key points:
- `* { margin: 0; padding: 0; box-sizing: border-box; }`
- `body, html { height: 100%; overflow: hidden; }` — no scrolling, full screen
- CSS custom properties for theming: `--bg-color`, `--page-shadow`, etc.
- `.tap-zone` — transparent overlays on left/right 20% of screen
- `#page-img` — `max-width: 100%; max-height: 100vh; object-fit: contain;`
- `will-change: transform` on page container for GPU acceleration
- `@media (orientation: landscape)` — dual page layout rules
- Dark mode: `filter: invert(1) hue-rotate(180deg)` on page images (inverts while preserving colour)

**Step 5: Create initial app.js (empty shell with module structure)**

```javascript
// State
const state = {
    currentPage: 1,
    totalPages: 848,
    theme: 'light',
    brightness: 1,
    keepAwake: false,
    dualPage: 'auto', // 'auto', 'on', 'off'
    bookmarks: [],
    markers: {},
    metadata: null
};

// Initialize
async function init() {
    loadState();
    await loadMetadata();
    renderPage(state.currentPage);
    setupNavigation();
    setupMenu();
    setupMarkers();
    registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', init);
```

**Step 6: Update .gitignore**

```
desktop.ini
app/images/pages/
assets/source/
node_modules/
```

**Step 7: Commit**

```bash
git add app/index.html app/manifest.json app/css/styles.css app/js/app.js .gitignore
git commit -m "feat: PWA shell — HTML structure, CSS layout, JS skeleton"
```

---

## Phase 3: Core Reading Experience

### Task 6: Page rendering and state management

**Files:**
- Modify: `app/js/app.js`

Implement:
- `loadState()` — read all preferences from localStorage
- `saveState()` — persist to localStorage (debounced, 500ms)
- `loadMetadata()` — fetch `data/metadata.json`
- `renderPage(pageNum)` — load medium WebP image into `#page-img`, show thumbnail first as blur placeholder, then swap to medium when loaded. Update page indicator. Handle dual page mode (load two consecutive pages). Update juz/surah tab indicator.
- `getImageUrl(pageNum, tier)` — returns `images/pages/{tier}/{pageNum}.webp`
- `preloadAdjacent(pageNum)` — preload ±5 pages into browser cache via `new Image()`

Key detail: Pages are RTL. "Next" means lower page number in the physical mushaf. Verify against the actual PDF page ordering.

**Step 1: Implement state management (loadState, saveState)**
**Step 2: Implement loadMetadata**
**Step 3: Implement renderPage with progressive loading (thumb → medium)**
**Step 4: Implement preloadAdjacent**
**Step 5: Test — open in browser, verify page loads and displays**
**Step 6: Commit**

---

### Task 7: Swipe and tap navigation

**Files:**
- Modify: `app/js/app.js`

Implement touch gesture handling:
- **Swipe detection** — track `touchstart`, `touchmove`, `touchend`. Threshold: 50px horizontal movement. Swipe left = next page (RTL), swipe right = previous page.
- **Tap zones** — tap on left 25% = previous, right 25% = next. Middle 50% = toggle menu.
- **Haptic feedback** — `navigator.vibrate(10)` on page turn (short pulse).
- **Page transition animation** — CSS transform slide left/right, 200ms ease-out.
- **Boundary handling** — don't go below page 1 or above totalPages.

**Step 1: Implement swipe detection with touch events**
**Step 2: Implement tap zone handlers**
**Step 3: Add CSS page transition animation**
**Step 4: Add haptic feedback**
**Step 5: Test on phone — swipe and tap both directions, verify RTL direction**
**Step 6: Commit**

---

### Task 8: Pinch to zoom

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/css/styles.css`

Implement:
- Track two-finger pinch gesture (touch events with 2 touches)
- Scale the page image using CSS `transform: scale(x)`
- When zoom > 1.5x, swap medium image for high-res image
- Allow panning when zoomed (translate transform)
- Double-tap to reset zoom to 1x
- Clamp zoom between 1x and 4x

**Step 1: Implement pinch zoom with touch events**
**Step 2: Implement pan when zoomed**
**Step 3: Implement high-res swap on zoom threshold**
**Step 4: Implement double-tap to reset**
**Step 5: Test on phone**
**Step 6: Commit**

---

## Phase 4: Menu and Features

### Task 9: Menu overlay

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/css/styles.css`

Build the menu panel with sections:

```
[Search/filter input                    ]
[Surah list — scrollable, tap to jump   ]
[Juz list — horizontal pills            ]
[Page: [___] Go                         ]
[─── Settings ───                       ]
[Theme: Light / Dark         toggle     ]
[Dual Page: Auto/On/Off     3-way       ]
[Brightness: ═══════●═══    slider      ]
[Keep Screen Awake          toggle      ]
[─── Bookmarks ───                      ]
[+ Add bookmark                         ]
[  Hifdh spot — p.150         ✕         ]
[  Morning wird — p.502       ✕         ]
[─── Offline ───                        ]
[Download all pages for offline  btn    ]
```

- Menu slides in from right (RTL-friendly)
- Backdrop blur on overlay
- Tap outside or swipe right to dismiss
- Search input filters surah list in real-time
- All toggles update state immediately and call saveState()

**Step 1: Build menu HTML structure in JS (createElement or template literal)**
**Step 2: Style the menu panel (slide-in animation, backdrop blur)**
**Step 3: Implement surah list with search filter**
**Step 4: Implement juz list as horizontal scrollable pills**
**Step 5: Implement page number jump**
**Step 6: Implement theme toggle**
**Step 7: Implement dual page toggle**
**Step 8: Test all menu items**
**Step 9: Commit**

---

### Task 10: Dark mode and brightness

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/css/styles.css`

Implement:
- **Dark mode** — toggle CSS class on body. Page images use `filter: invert(0.85) hue-rotate(180deg) sepia(0.15)` which inverts while keeping a warm tone.
- **Light mode** — cream `#f5f0e8` background.
- **Brightness slider** — CSS `filter: brightness(value)` on the page container. Range 0.3 to 1.0.
- **Persist** both in localStorage.

**Step 1: Implement theme CSS variables and dark mode filter**
**Step 2: Implement brightness overlay**
**Step 3: Wire up to menu toggles**
**Step 4: Test both modes, verify readability**
**Step 5: Commit**

---

### Task 11: Dual page mode

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/css/styles.css`

Implement:
- **Auto mode** — listen to `orientationchange` and `resize`. When landscape: show two pages side by side. Portrait: single page.
- **Manual override** — "on" forces dual always, "off" forces single always.
- **Layout** — in dual mode, `#page-container` becomes `display: flex; flex-direction: row-reverse` (RTL — right page is current, left page is next).
- **Navigation** — in dual mode, swipe advances by 2 pages.
- **Responsive sizing** — each page takes 50% width, maintain aspect ratio.

**Step 1: Implement orientation detection**
**Step 2: Implement dual page CSS layout**
**Step 3: Update renderPage for dual mode**
**Step 4: Update navigation to advance by 2 in dual mode**
**Step 5: Test in landscape on phone**
**Step 6: Commit**

---

### Task 12: Bookmarks

**Files:**
- Modify: `app/js/app.js`

Implement:
- **Add bookmark** — from menu, saves current page with a user-provided name (prompt or inline input).
- **List bookmarks** — shown in menu, tap to jump to page.
- **Delete bookmark** — tap ✕ button next to bookmark.
- **Auto-bookmark** — `lastPage` always saved automatically (separate from named bookmarks).
- Stored in `state.bookmarks` array, persisted in localStorage.

**Step 1: Implement add bookmark with name input**
**Step 2: Implement bookmark list rendering in menu**
**Step 3: Implement jump to bookmark**
**Step 4: Implement delete bookmark**
**Step 5: Test full bookmark flow**
**Step 6: Commit**

---

### Task 13: Mistake markers

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/css/styles.css`

Implement:
- **Long-press detection** — 500ms hold on the page image. Get position as % of image width/height (so markers stay correct regardless of screen size).
- **Place marker** — small coloured circle (semi-transparent red, ~20px) at the pressed position. Positioned absolutely over the page image using % coordinates.
- **Marker dialog** — on placing or tapping existing marker, show dialog with: note textarea, save button, delete button.
- **Render markers** — on each page load, check `state.markers[pageNum]` and render all markers for that page.
- **Zoom support** — markers scale with the page image when zoomed.
- Stored in `state.markers` object keyed by page number.

**Step 1: Implement long-press detection with position calculation**
**Step 2: Implement marker rendering on page**
**Step 3: Implement marker dialog (add note, delete)**
**Step 4: Implement marker persistence in localStorage**
**Step 5: Ensure markers scale correctly with zoom**
**Step 6: Test full marker flow**
**Step 7: Commit**

---

### Task 14: Keep screen awake

**Files:**
- Modify: `app/js/app.js`

Implement using the Wake Lock API:
```javascript
let wakeLock = null;

async function toggleWakeLock(enable) {
    if (enable && 'wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
    } else if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
    }
}
```

- Re-acquire wake lock on `visibilitychange` (iOS releases it when app goes to background).
- Fallback: if Wake Lock API not supported, use a hidden video loop trick.

**Step 1: Implement wake lock with re-acquisition**
**Step 2: Wire to menu toggle**
**Step 3: Test on iPhone**
**Step 4: Commit**

---

### Task 15: Juz/Surah colour tabs

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/css/styles.css`

Implement:
- Small coloured tab on the right edge of the screen showing current juz number.
- Position varies vertically based on which juz (juz 1 at top, juz 30 at bottom).
- Colour cycles through a set of 6 muted colours.
- Shows juz number in Arabic numerals.
- Auto-hides after 3 seconds, reappears on page turn.

**Step 1: Implement tab positioning based on current juz**
**Step 2: Style the tab (colours, typography)**
**Step 3: Implement auto-hide with fade**
**Step 4: Test across different juz**
**Step 5: Commit**

---

### Task 16: Page number indicator

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/css/styles.css`

Implement:
- Small page number at bottom centre of screen.
- Shows on page turn, fades out after 2 seconds.
- Format: `٤٢` (Arabic numerals) or `42` — user preference or just Arabic to match mushaf style.

**Step 1: Implement indicator with fade animation**
**Step 2: Update on page turn**
**Step 3: Commit**

---

## Phase 5: Offline and PWA

### Task 17: Service worker

**Files:**
- Create: `app/sw.js`

Implement:
- **Install** — cache app shell (HTML, CSS, JS, metadata.json, icons).
- **Fetch strategy** — cache-first for images, network-first for app shell (so updates propagate).
- **On-demand caching** — when a page image is fetched, cache it for offline.
- **Download all** — when user taps "Download all for offline", fetch all medium-tier images sequentially and cache them. Show progress in the menu.

```javascript
const CACHE_NAME = 'quran-v1';
const SHELL_FILES = [
    '/', '/index.html', '/css/styles.css', '/js/app.js',
    '/data/metadata.json', '/manifest.json'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL_FILES)));
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
            // Cache images on-the-fly
            if (e.request.url.includes('/images/pages/')) {
                const clone = resp.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
            }
            return resp;
        }))
    );
});

// Message handler for "download all"
self.addEventListener('message', e => {
    if (e.data.type === 'downloadAll') {
        // Fetch all medium pages and cache them, post progress back
    }
});
```

**Step 1: Implement service worker with shell caching**
**Step 2: Implement cache-first fetch for images**
**Step 3: Implement "download all" with progress reporting**
**Step 4: Register service worker in app.js**
**Step 5: Test offline — enable airplane mode, verify pages load**
**Step 6: Commit**

---

### Task 18: PWA icons and splash

**Files:**
- Create: `app/icons/icon-192.png`
- Create: `app/icons/icon-512.png`

Generate app icons — a clean, minimal design. Could use the first page of the mushaf as the icon, or a simple geometric Islamic pattern. Need 192x192 and 512x512 PNG.

**Step 1: Generate icons**
**Step 2: Add apple-touch-icon meta tags for iOS splash screens**
**Step 3: Test "Add to Home Screen" on iPhone**
**Step 4: Commit**

---

## Phase 6: Deploy

### Task 19: GitHub Pages deployment

**Step 1: Decide on image hosting**

The page images (~150-350MB) are too large for GitHub Pages (1GB limit, but slow). Options:
- **GitHub Pages** — host app shell + images (works if total under 1GB)
- **GitHub Pages for shell + CDN for images** — use a free CDN or object storage for images
- **Cloudflare Pages** — generous free tier, better for large assets

Recommendation: Start with GitHub Pages. If images are under ~200MB total (medium tier only — high-res loaded on-demand from same host), it fits.

**Step 2: Configure GitHub Pages**

```bash
# Ensure the app/ directory is the publish source
# Or move contents to root for simpler GitHub Pages setup
```

**Step 3: Push to GitHub**

The repo already exists at `sidnikiwi-afk/Quran`. Push the `app/` directory.

**Step 4: Enable GitHub Pages in repo settings**

Settings → Pages → Source: Deploy from branch → Select branch and `/app` folder.

**Step 5: Test the live URL**

Visit `https://sidnikiwi-afk.github.io/Quran/` and test:
- Page loads
- Swipe works
- Add to home screen works
- Offline works after caching

**Step 6: Commit any deployment fixes**

---

## Phase 7: Polish and QA

### Task 20: End-to-end testing on iPhone

Test checklist:
- [ ] App loads and shows first page
- [ ] Swipe left/right turns pages correctly (RTL)
- [ ] Tap edges turns pages
- [ ] Haptic feedback on page turn
- [ ] Pinch to zoom works, high-res loads
- [ ] Double-tap resets zoom
- [ ] Menu opens/closes
- [ ] Surah search and jump works
- [ ] Juz jump works
- [ ] Page number jump works
- [ ] Dark mode toggle
- [ ] Brightness slider
- [ ] Dual page in landscape
- [ ] Dual page manual toggle
- [ ] Add/delete named bookmarks
- [ ] Resume from last page on reopen
- [ ] Long-press to place mistake marker
- [ ] Add note to marker
- [ ] Delete marker
- [ ] Markers persist after close/reopen
- [ ] Keep screen awake toggle
- [ ] Juz colour tab shows and auto-hides
- [ ] Page number shows and auto-hides
- [ ] Download all for offline
- [ ] Works in airplane mode after download
- [ ] Add to Home Screen — launches full screen
- [ ] Progressive loading (blur → sharp)

Fix any issues found.

**Final commit:**

```bash
git add -A
git commit -m "feat: Quran 13-line PWA v1.0 — complete reading experience"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Asset Pipeline | 1-4 | Page images extracted and converted |
| 2: PWA Shell | 5 | Basic HTML/CSS/JS structure |
| 3: Core Reading | 6-8 | Page display, swipe, tap, zoom |
| 4: Menu & Features | 9-16 | Full menu, bookmarks, markers, dark mode, dual page |
| 5: Offline & PWA | 17-18 | Service worker, offline support, installable |
| 6: Deploy | 19 | Live on GitHub Pages |
| 7: Polish & QA | 20 | Tested and verified on iPhone |
