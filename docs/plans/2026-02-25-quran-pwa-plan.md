# Quran 13-Line PWA Implementation Plan

> **Status:** v1.0 COMPLETE and deployed. All phases implemented.

**Goal:** Build an offline-capable PWA for reading the South African 13-line Quran on iPhone with swipe navigation, bookmarks, mistake markers, and dual-page landscape mode.

**Architecture:** Static PWA with vanilla JS. Page images extracted from Internet Archive PDF, converted to three-tier WebP (thumb + medium + high-res). All state in localStorage. Service worker for offline caching. No build step — just HTML/CSS/JS served from GitHub Pages.

**Tech Stack:** Vanilla JS, Service Worker API, CSS transforms, Wake Lock API, GitHub Pages

**Design doc:** `docs/plans/2026-02-25-quran-pwa-design.md`

---

## Implementation Status

All phases are complete. Below is the summary of what was built.

| Phase | Tasks | Status |
|-------|-------|--------|
| 1: Asset Pipeline | PDF extraction, 3-tier WebP conversion, metadata | DONE |
| 2: PWA Shell | HTML/CSS/JS structure, manifest | DONE |
| 3: Core Reading | Page display, swipe, tap, pinch zoom | DONE |
| 4: Menu & Features | Menu, bookmarks, markers, dark mode, dual page, brightness, wake lock | DONE |
| 5: Offline & PWA | Service worker, download-all, installable | DONE |
| 6: Deploy | GitHub Pages via GitHub Actions | DONE |
| 7: Polish & QA | Bug fixes, tested on iPhone | DONE |

## Bug Fixes (Post-v1.0)

1. Markers misaligned — dynamic positioning over actual image rect
2. Browser translation prompt — `translate="no"` meta tags
3. Menu fills screen on small phones — 85vw cap, close button, swipe-to-close
4. Surah list fills menu in landscape — collapsible sections
5. Surah list not collapsed by default — starts collapsed
6. Markers shift on page revisit — re-render after medium loads
7. Top of page unresponsive for markers — listener on `#reader` not `#page-container`
8. Dual page order wrong — `row` not `row-reverse` (RTL already reverses)

## Post-v1.0 Enhancements

- **High-res lossless images as default** — re-extracted at 600 DPI from source PDF, converted to lossless WebP at full 2985x3900 native resolution. ~106KB per page, 90MB total (paradoxically smaller than lossy compression for Arabic text). Committed to git and deployed via GitHub Pages. Medium tier no longer used.

## Attempted but Reverted

- **Smooth interactive page swiping** (3-slot swipe track) — broke layout due to RTL direction conflicts with 300%-wide translateX positioning. `<html dir="rtl">` causes translateX to position from the right edge. Reverted to CSS animation transitions.

## Remaining Future Work

- Smooth interactive page swiping (needs RTL-safe implementation — previous attempt with 3-slot swipe track failed due to dir="rtl" conflicts)
- Audio recitation playback (Bandar Baleelah MP3s already in repo)
- Real-time recitation tracking with mistake detection (Tarteel-style)
- Translation overlay
- Verify remaining interpolated surah/juz page numbers (61 of 114 surahs, 27 of 30 juz)
- Remove legacy medium tier images (no longer used, still in git)
