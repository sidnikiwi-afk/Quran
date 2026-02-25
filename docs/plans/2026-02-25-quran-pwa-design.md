# Quran 13-Line PWA — Design Document

## Overview
A Progressive Web App for reading the South African 13-line Quran (Waterval Islamic Institute edition) on iPhone. Installable from browser, works offline, no App Store required.

**Live URL:** https://sidnikiwi-afk.github.io/Quran/
**Repo:** https://github.com/sidnikiwi-afk/Quran (public)

## Page Images Source
- PDF from Internet Archive: https://archive.org/details/13LineQuran
- 424 landscape PDF pages, each containing 2 mushaf pages side by side (RTL order)
- Extracted and split into 847 individual mushaf pages
- Converted to 3-tier WebP:
  - **Thumb** (~3KB each, 3.3MB total) — blur placeholder
  - **Medium** (~92KB each, 78MB total) — default view, committed to git
  - **High** (~194KB each, 164MB total) — zoom view, gitignored (available locally)

## Navigation
- **Swipe left/right** to turn pages (RTL: swipe left = forward)
- **Tap left/right edges** (25% zones) to go forward/back
- **Tap middle** (50%) to toggle menu
- **Pinch to zoom** — loads high-res tier above 1.5x, clamp 1x-4x
- **Pan** when zoomed (single finger drag)
- **Double-tap** to reset zoom
- **Haptic feedback** on page turn (`navigator.vibrate(10)`)
- **Keyboard**: ArrowLeft = next (RTL), ArrowRight = prev, Escape = close menu
- **Auto-resume** — remembers last page on open
- **Page transitions** — slideLeft/slideRight 200ms CSS animations

## Menu Overlay
- Slides in from right, backdrop blur
- **Close button (X)** at top of panel (sticky)
- **Swipe right** on panel to dismiss (>80px threshold)
- **Tap backdrop** to dismiss
- All sections are **collapsible** (tap title to toggle, arrow indicator rotates)
- **Surahs** (starts collapsed) — searchable list of 114 surahs with Arabic + English names and page numbers
- **Juz pills** — horizontal scrollable row of 30, current juz highlighted
- **Go to Page** — number input + Go button
- **Settings:**
  - Dark/Light mode toggle
  - Dual Page: Auto/On/Off selector
  - Brightness slider (0.3 to 1.0, in-app overlay)
  - Keep Screen Awake toggle (Wake Lock API)
- **Bookmarks** — add named bookmarks (default name includes current surah), tap to jump, delete with X
- **Offline** — Download All Pages button with progress indicator

## Display Modes
- **Light mode** — cream `#f5f0e8` background
- **Dark mode** — dark `#1a1a1a` background, page images inverted with `filter: invert(0.85) hue-rotate(180deg) sepia(0.15)`
- **Single page** — portrait (default)
- **Dual page** — landscape auto-detect or manual toggle, `flex-direction: row` (not row-reverse, since HTML `dir=rtl` already reverses), each page 50% width
- **Brightness** — black overlay with variable opacity
- All preferences persisted in localStorage

## Mistake Markers
- **Long-press** (500ms) on the page to place a marker
- Long-press listener on `#reader` (not `#page-container`) to avoid UI elements blocking
- Excludes taps on `#menu-btn`, `#menu-overlay`, `#marker-dialog`, `.marker`
- Position calculated as % of image dimensions (responsive)
- Markers layer dynamically positioned over actual image rect using `getBoundingClientRect()`
- Re-renders after medium image loads (via `requestAnimationFrame`) to prevent shifting
- Red circle dots with white border
- Tap existing marker to edit note or delete
- Markers persist per page in localStorage

## Visual Polish
- **Juz tab** on right edge — shows current juz in Arabic, positioned vertically by juz number (10%-90% range), auto-hides after 3s
- **Page indicator** — bottom center pill with backdrop blur, auto-hides after 2s
- **Progressive loading** — thumb with blur(10px) + scale(1.05), swap to medium on load
- **Page transitions** — slideLeft/slideRight 200ms CSS animations
- **Menu** — smooth slide-in 300ms, backdrop blur, capped at 85vw on small screens

## Performance
- **On-demand loading** — current page +/- 5 preloaded
- **Download all for offline** — service worker batches of 10, progress reporting via postMessage
- **3-tier WebP** — thumb for instant placeholder, medium for reading, high for zoom
- **Cache-first** for images, network-first for app shell
- **Vanilla JS** — no frameworks, ~1100 lines total
- **GPU-accelerated** — `will-change: transform` on page container

## Technical Stack
- Vanilla JS (~1100 lines)
- CSS (~850 lines)
- Service Worker (cache-first images, network-first shell, download-all)
- localStorage for all state
- GitHub Pages (deployed via GitHub Actions from `/app` directory)
- PWA manifest — installable on home screen

## Project Structure
```
Quran/
├── app/
│   ├── index.html          # Main HTML shell
│   ├── manifest.json        # PWA manifest
│   ├── sw.js               # Service worker
│   ├── css/styles.css       # All styles (~850 lines)
│   ├── js/app.js           # All logic (~1100 lines)
│   ├── data/metadata.json   # Surah/juz page mappings
│   ├── icons/              # App icons (192, 512)
│   └── images/pages/
│       ├── thumb/          # 847 WebP ~3KB each
│       ├── medium/         # 847 WebP ~92KB each (in git)
│       └── high/           # 847 WebP ~194KB each (gitignored)
├── scripts/
│   └── extract-pages.sh    # PDF to WebP extraction script
├── assets/source/          # Source PDF (gitignored)
├── Bandar Baleelah/        # Audio recitations (120 MP3s)
├── docs/plans/             # Design and implementation docs
└── .github/workflows/
    └── deploy.yml          # GitHub Actions Pages deployment
```

## Data Model (localStorage key: `quran-state`)
```json
{
  "currentPage": 42,
  "theme": "light",
  "brightness": 0.8,
  "keepAwake": true,
  "dualPage": "auto",
  "bookmarks": [
    { "name": "Hifdh spot", "page": 150 },
    { "name": "Morning wird", "page": 502 }
  ],
  "markers": {
    "150": [
      { "x": 45.2, "y": 32.1, "note": "Always miss this word" }
    ]
  }
}
```

## Metadata
- 847 total pages (mushaf pages 2-848, cover excluded)
- 114 surahs — 53 verified against actual page images, 61 interpolated (within 1-3 pages)
- 30 juz — 3 verified, 27 interpolated
- Page mappings specific to 13-line SA mushaf (different from 15-line Madinah)

## Known Limitations
- Medium tier images (1000px wide) appear slightly blurry on 3x Retina iPhone displays
- High-res images exist locally but are gitignored (164MB too large for reliable GitHub Pages serving)
- Page transitions use CSS animation (instant swap with slide effect) rather than interactive finger-following swipe

## Bug Fixes Applied
1. **Markers misaligned** — markers layer now dynamically positioned over actual image rect using `getBoundingClientRect()`
2. **Browser translation prompt** — added `translate="no"` and `<meta name="google" content="notranslate">`
3. **Menu fills screen on small phones** — capped at `max-width: 85vw`, added close button and swipe-to-close
4. **Surah list fills menu in landscape** — all menu sections made collapsible
5. **Surah list not collapsed by default** — starts with `collapsed` class
6. **Markers shift on page revisit** — re-renders markers via `requestAnimationFrame` after medium image loads
7. **Top of page unresponsive for markers** — long-press listener moved from `#page-container` to `#reader`
8. **Dual page order wrong** — changed from `row-reverse` to `row` (HTML `dir=rtl` already reverses)

## Future Additions
- Smooth interactive page swiping (page follows finger, next page visible during swipe)
- Higher resolution default images (serve high-res via CDN or optimized hosting)
- Audio recitation playback (Bandar Baleelah files already in repo)
- Real-time recitation tracking with mistake detection (Tarteel-style)
- Translation overlay
- Verify remaining interpolated surah/juz page numbers
