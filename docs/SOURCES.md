# Data & audio sources — licensing / attribution

Catalogue of every external dataset and media source the app uses, so licensing
can be cleared **before any public redistribution / promotion**. Status as of
2026-06-01.

| Asset | Source | Used for | Licence status |
|---|---|---|---|
| Page scans (`app/images/pages/*`) | 13-line Taj Company / Waterval Islamic Institute mushaf | the reader pages | **Confirm provenance / reuse rights** before public promotion (scanned print). |
| `app/data/metadata.json` (surah/juz starts) | Hand-verified against the page scans + QUL | navigation | Factual page indices (not copyrightable as data); fine. |
| `app/data/page-ayah-index.json` | QUL Indopak 13-line **Taj Company** layout (resource 313) + Indopak word script (resource 55) | Surah:Ayah jump, audio auto-turn, highlight | **QUL (qul.tarteel.ai) terms — confirm exact licence (Tarteel publishes data openly; verify attribution requirement).** |
| `app/data/page-lines.json`, `ayah-lines.json` | Derived: QUL line↔word data + our projection-profile line detection | line-level highlight, Hifz hide/reveal | Derived from QUL (see above) + our own CV; same QUL caveat. |
| `app/data/search-index.json` | QUL Indopak word **text** (resource 55), diacritic-stripped | ayah text search | QUL text — Quran text itself is not copyrightable; the *digitisation* is QUL's — confirm attribution. |
| Audio — Tier 1 (whole surah) | `download.quranicaudio.com/quran/bandar_baleela/complete/` (Quran Foundation CDN), reciter **Bandar Baleelah** | continuous recitation | Streamed (not bundled). Confirm QF CDN hotlink/use terms. |
| Audio — Tier 2 (ayah-by-ayah) | `everyayah.com/data/<reciter>/` (Alafasy, Husary, Ash-Shaatree, Minshawi, Sudais) | per-ayah playback | Streamed (not bundled). Confirm everyayah hotlink terms. |
| (planned) Translation | Pickthall / Yusuf Ali (public domain, pre-1940s) via Tanzil | translation panel | Public-domain translations are the safe default; avoid licence-restricted ones (e.g. Saheeh International). |

## Attribution to add to the UI before public launch
- "Mushaf layout & word data: Quranic Universal Library (qul.tarteel.ai)."
- "Audio: quranicaudio.com (Quran Foundation) / everyayah.com."
- Page-scan credit per the print edition's terms.

## Open items (gate public promotion, not personal use)
1. Confirm QUL data licence + required attribution string.
2. Confirm audio-CDN hotlinking is acceptable (or self-host / cache-on-play).
3. Confirm page-scan reuse rights.
