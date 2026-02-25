# Quran 13-Line PWA — Design Document

## Overview
A Progressive Web App for reading the South African 13-line Quran (Waterval Islamic Institute edition) on iPhone. Installable from browser, works offline, no App Store required.

## Page Images Source
- PDF from Internet Archive: https://archive.org/details/13LineQuran
- Extract individual page images from PDF
- Convert to WebP format for 50-70% size reduction
- Two tiers: medium quality (~100KB, default view) and high quality (~300KB, for zoom)

## Navigation
- **Swipe left/right** to turn pages
- **Tap right/left edges** of page to go forward/back
- **Right-to-left** page direction (Arabic reading)
- **Pinch to zoom** on any page (loads high-res tier)
- **Auto-resume** — remembers last page on open

## Menu Overlay
- Subtle toggle button (top-right corner)
- **Juz list** (1-30) — tap to jump
- **Surah list** (1-114) with Arabic names — searchable/filterable
- **Page number input** — jump to any page
- **Named bookmarks** — save multiple with custom names (e.g. "Hifdh spot", "Morning wird")
- **Dual page toggle** — on/off
- **Dark/Light mode toggle**
- **Brightness slider** — in-app override of system brightness
- **Keep screen awake toggle**
- Menu dismisses on selection or tap outside

## Display Modes
- **Light mode** — cream/beige background (mushaf feel)
- **Dark mode** — dark background, adjusted page images
- **Single page** — portrait orientation (default)
- **Dual page** — landscape auto-detect OR manual toggle from menu. Two pages side by side, right page first (mushaf order)
- All preferences persisted in localStorage

## Mistake Markers
- **Long-press** on a spot on the page to drop a marker
- Marker appears as a small coloured dot/circle
- Tap marker to add an optional note or delete it
- Markers saved per page, persist across sessions
- Visible in zoomed view
- For hifdh revision — mark recurring mistake spots

## Visual Polish
- **Juz/Surah colour tabs** on page edge — subtle coloured indicators showing current position
- **Haptic feedback** on page turn — tiny vibration for tactile feel
- **Progressive image loading** — blurred thumbnail first, then full resolution

## Performance Strategy
- **On-demand loading** — load current page ± 5 adjacent pages
- **"Download all for offline"** option in menu (WiFi recommended)
- **WebP images** — two tiers (medium for browsing, high-res for zoom)
- **Service worker** caches loaded pages for offline access
- **CSS `will-change`** on page transitions for GPU-accelerated swiping
- **Vanilla JS** — no framework bloat, fast launch, low memory

## Technical Stack
- Vanilla JS (or Preact ~3KB if needed)
- Service Worker for offline/caching
- localStorage for preferences, bookmarks, markers
- Hosted on GitHub Pages (free)
- PWA manifest for home screen install

## Data Model (localStorage)
```json
{
  "lastPage": 42,
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
      { "x": 0.45, "y": 0.32, "note": "Always miss this word" }
    ]
  }
}
```

## Future Additions (not v1)
- Audio recitation playback (Bandar Baleelah files already available)
- Real-time recitation tracking with mistake detection (Tarteel-style)
- Translation overlay

## Source
- Mushaf PDF: https://archive.org/details/13LineQuran
- Quran metadata (surah/juz page mappings): to be sourced from open APIs
