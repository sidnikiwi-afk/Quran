'use strict';

// ============================================================
// State
// ============================================================
const state = {
    currentPage: 1,
    totalPages: 847,
    theme: 'light',
    brightness: 1,
    keepAwake: false,
    dualPage: 'auto', // 'auto', 'on', 'off'
    bookmarks: [],
    markers: {},
    progress: { visited: [], khatms: [] }, // visited: array of page numbers read this khatm; khatms: completed-khatm timestamps
    metadata: null,
    isMenuOpen: false,
    isZoomed: false,
    zoomLevel: 1,
};

// ============================================================
// Constants
// ============================================================
const PRELOAD_RANGE = 5;
const SWIPE_THRESHOLD = 50;
const LONG_PRESS_MS = 500;
const PAGE_INDICATOR_MS = 2000;
const DEBOUNCE_SAVE_MS = 500;

// ============================================================
// DOM References (populated in init)
// ============================================================
let dom = {};

// Forward declarations for cross-referenced module-level variables
let _brightnessOverlay = null;
let _dualPageMediaQuery = null;
let _isDualActive = false;
let _editingMarker = null;
let _wakeLock = null;

// ============================================================
// Initialization
// ============================================================
async function init() {
    cacheDom();
    loadState();
    await loadMetadata();
    setTheme(state.theme);
    setupBrightness();
    renderPage(state.currentPage);
    setupNavigation();
    setupMenu();
    setupMarkers();
    setupDualPage();
    setupWakeLock();
    initAudio();
    registerServiceWorker();
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        _deferredInstallPrompt = e;
        const btn = document.getElementById('install-btn');
        if (btn) btn.removeAttribute('hidden');
    });
}
let _deferredInstallPrompt = null;

function cacheDom() {
    dom = {
        reader: document.getElementById('reader'),
        pageContainer: document.getElementById('page-container'),
        pageImg: document.getElementById('page-img'),
        pageImg2: document.getElementById('page-img-2'),
        tapLeft: document.getElementById('tap-left'),
        tapRight: document.getElementById('tap-right'),
        pageIndicator: document.getElementById('page-indicator'),
        markersLayer: document.getElementById('markers-layer'),
        ayahHighlightLayer: document.getElementById('ayah-highlight-layer'),
        hifzCoverLayer: document.getElementById('hifz-cover-layer'),
        translationPanel: document.getElementById('translation-panel'),
        audioBar: document.getElementById('audio-bar'),
        menuBtn: document.getElementById('menu-btn'),
        menuOverlay: document.getElementById('menu-overlay'),
        menuPanel: document.getElementById('menu-panel'),
        markerDialog: document.getElementById('marker-dialog'),
        markerNote: document.getElementById('marker-note'),
        markerSave: document.getElementById('marker-save'),
        markerDelete: document.getElementById('marker-delete'),
        markerCancel: document.getElementById('marker-cancel'),
    };
}

// ============================================================
// State Management
// ============================================================
function loadState() {
    try {
        const raw = localStorage.getItem('quran-state');
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.currentPage) state.currentPage = Math.max(1, Math.min(saved.currentPage, state.totalPages));
        if (saved.theme) state.theme = saved.theme;
        if (typeof saved.brightness === 'number') state.brightness = saved.brightness;
        if (typeof saved.keepAwake === 'boolean') state.keepAwake = saved.keepAwake;
        if (saved.dualPage) state.dualPage = saved.dualPage;
        if (Array.isArray(saved.bookmarks)) state.bookmarks = saved.bookmarks;
        if (saved.markers && typeof saved.markers === 'object') state.markers = saved.markers;
        if (saved.progress && Array.isArray(saved.progress.visited)) {
            state.progress = {
                visited: saved.progress.visited.filter(p => Number.isInteger(p) && p >= 1 && p <= state.totalPages),
                khatms: Array.isArray(saved.progress.khatms) ? saved.progress.khatms : [],
            };
        }
    } catch (e) {
        console.warn('Failed to load state, using defaults:', e);
    }
}

let _saveTimer = null;
function saveState() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        try {
            const data = {
                schemaVersion: 2,
                currentPage: state.currentPage,
                theme: state.theme,
                brightness: state.brightness,
                keepAwake: state.keepAwake,
                dualPage: state.dualPage,
                bookmarks: state.bookmarks,
                markers: state.markers,
                progress: state.progress,
            };
            localStorage.setItem('quran-state', JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save state:', e);
        }
    }, DEBOUNCE_SAVE_MS);
}

// ============================================================
// Metadata
// ============================================================
async function loadMetadata() {
    try {
        const res = await fetch('data/metadata.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.metadata = await res.json();
        state.totalPages = state.metadata.mushaf.totalPages || 847;
    } catch (e) {
        console.error('Failed to load metadata:', e);
        // Fallback: ensure we can still navigate
        state.metadata = { surahs: [], juz: [], mushaf: { totalPages: 847 } };
        state.totalPages = 847;
    }
}

// ============================================================
// Page Rendering
// ============================================================
function getImageUrl(page, tier = 'medium') {
    return `images/pages/${tier}/${page}.webp`;
}

let _indicatorTimer = null;

function renderPage(page, skipBlur) {
    // 1. Clamp page
    page = Math.max(1, Math.min(page, state.totalPages));
    // In dual (landscape spread) mode, anchor to the odd page so the spread is
    // (odd = right, even = left) — matching the physical 13-line mushaf. E.g. Juz 17
    // (p448) must sit on the LEFT with p447 on the right, not p448-right/p449-left.
    if (_isDualActive && page % 2 === 0) page = page - 1;
    state.currentPage = page;

    // 2. Load image (skip blur if coming from a completed swipe)
    if (skipBlur) {
        // Image already set by swipe handler — just ensure high-res
        dom.pageImg.style.filter = '';
        dom.pageImg.style.transform = '';
        const hiUrl = getImageUrl(page, 'high');
        if (dom.pageImg.src !== hiUrl) {
            dom.pageImg.src = hiUrl;
        }
    } else {
        // Normal load: thumbnail placeholder with blur
        dom.pageImg.style.filter = 'blur(10px)';
        dom.pageImg.style.transform = 'scale(1.05)';
        dom.pageImg.src = getImageUrl(page, 'thumb');
    }

    // 3. Load high-res image and swap when ready
    const medImg = new Image();
    medImg.src = getImageUrl(page, 'high');
    medImg.onload = () => {
        // Only swap if we're still on this page
        if (state.currentPage === page) {
            dom.pageImg.src = medImg.src;
            dom.pageImg.style.filter = '';
            dom.pageImg.style.transform = '';
            // Re-position markers + ayah highlight + hifz covers now that image has final dimensions
            requestAnimationFrame(() => { renderMarkers(page); repositionHighlight(); renderHifzCovers(); });
        }
    };

    // 4. Handle dual page (second image)
    if (_isDualActive && dom.pageImg2) {
        const page2 = page + 1;
        if (page2 <= state.totalPages) {
            dom.pageImg2.removeAttribute('hidden');
            dom.pageImg2.style.filter = 'blur(10px)';
            dom.pageImg2.style.transform = 'scale(1.05)';
            dom.pageImg2.src = getImageUrl(page2, 'thumb');
            const medImg2 = new Image();
            medImg2.src = getImageUrl(page2, 'medium');
            medImg2.onload = () => {
                if (state.currentPage === page) {
                    dom.pageImg2.src = medImg2.src;
                    dom.pageImg2.style.filter = '';
                    dom.pageImg2.style.transform = '';
                }
            };
        } else {
            dom.pageImg2.setAttribute('hidden', '');
        }
    } else if (dom.pageImg2) {
        dom.pageImg2.setAttribute('hidden', '');
    }

    // 5. Update page indicator
    showPageIndicator(page);

    // 6. Preload adjacent pages
    preloadAdjacent(page);

    // 8. Record reading progress + save state
    recordVisited(page);
    saveState();

    // 9. Render markers + reposition ayah highlight + hifz covers for this page
    renderMarkers(page);
    repositionHighlight();
    renderHifzCovers();
    if (dom.translationPanel && !dom.translationPanel.hidden) renderTranslationPanel();
}

// ============================================================
// Reading progress & Khatm tracker
// ============================================================
let _visitedSet = null;

function recordVisited(page) {
    if (!_visitedSet) _visitedSet = new Set(state.progress.visited);
    if (_visitedSet.has(page)) return;
    _visitedSet.add(page);
    state.progress.visited.push(page);
    updateProgressUI();
}

function progressStats() {
    const total = state.totalPages;
    const read = (_visitedSet ? _visitedSet.size : state.progress.visited.length);
    const pct = total ? Math.round((read / total) * 100) : 0;
    return { read, total, pct };
}

function updateProgressUI() {
    const bar = document.getElementById('progress-bar-fill');
    const label = document.getElementById('progress-label');
    if (!bar && !label) return; // menu not built yet
    const { read, total, pct } = progressStats();
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = `${read} / ${total} pages — ${pct}%`;
}

function resetProgress() {
    _visitedSet = new Set();
    state.progress.visited = [];
    saveState();
    updateProgressUI();
}

function completeKhatm() {
    // Archive the completed khatm and start a fresh one.
    state.progress.khatms = state.progress.khatms || [];
    state.progress.khatms.push(Date.now());
    resetProgress();
}

// ============================================================
// Ayah -> page jump (uses data/page-ayah-index.json)
// ============================================================
let _ayahIndex = null;
let _ayahIndexPromise = null;

function loadAyahIndex() {
    if (_ayahIndex) return Promise.resolve(_ayahIndex);
    if (!_ayahIndexPromise) {
        _ayahIndexPromise = fetch('data/page-ayah-index.json')
            .then(r => { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
            .then(j => { _ayahIndex = j; return j; })
            .catch(err => { _ayahIndexPromise = null; throw err; });
    }
    return _ayahIndexPromise;
}

// Resolve a surah:ayah to a page number, or null if not found.
function pageForAyah(index, surah, ayah) {
    const map = index && index.ayahToPage;
    if (!map) return null;
    return map[surah + ':' + ayah] || null;
}

// ---- Translation panel (data/translation-en.json, lazy) ----
let _translation = null, _translationPromise = null;
function loadTranslation() {
    if (_translation) return Promise.resolve(_translation);
    if (!_translationPromise) {
        _translationPromise = fetch('data/translation-en.json')
            .then(r => { if (!r.ok) throw 0; return r.json(); })
            .then(j => { _translation = j.ayahText; return _translation; })
            .catch(e => { _translationPromise = null; throw e; });
    }
    return _translationPromise;
}
function ayahsOnPage(idx, page) {
    const p = idx.pages[String(page)];
    if (!p) return [];
    const [fS, fA, lS, lA] = p;
    const out = []; let s = fS, a = fA, guard = 0;
    while (guard++ < 400) {
        out.push([s, a]);
        if (s === lS && a === lA) break;
        const nx = nextAyahPos(s, a);
        if (!nx) break;
        [s, a] = nx;
    }
    return out;
}
function openTranslationPanel() {
    if (dom.translationPanel) dom.translationPanel.removeAttribute('hidden');
    renderTranslationPanel();
}
function renderTranslationPanel() {
    const panel = dom.translationPanel;
    if (!panel || panel.hidden) return;
    const body = document.getElementById('translation-body');
    const title = document.getElementById('translation-title');
    body.textContent = 'Loading…';
    if (title) title.textContent = 'Translation — page ' + state.currentPage;
    Promise.all([loadAyahIndex(), loadTranslation()]).then(([idx, tr]) => {
        if (panel.hidden) return;
        const ayat = ayahsOnPage(idx, state.currentPage);
        body.innerHTML = '';
        if (!ayat.length) { body.textContent = 'No ayahs mapped for this page.'; return; }
        for (const [s, a] of ayat) {
            const div = document.createElement('div');
            div.className = 'tr-ayah';
            div.innerHTML = `<div class="tr-ref">${s}:${a}</div><div class="tr-text"></div>`;
            div.querySelector('.tr-text').textContent = tr[s + ':' + a] || '';
            body.appendChild(div);
        }
    }).catch(() => { body.textContent = 'Translation unavailable (offline? open it once online to cache).'; });
}

// ---- Ayah text search (data/search-index.json, lazy) ----
let _searchIndex = null, _searchPromise = null;
function loadSearchIndex() {
    if (_searchIndex) return Promise.resolve(_searchIndex);
    if (!_searchPromise) {
        _searchPromise = fetch('data/search-index.json')
            .then(r => { if (!r.ok) throw 0; return r.json(); })
            .then(j => { _searchIndex = j.ayahText; return _searchIndex; })
            .catch(e => { _searchPromise = null; throw e; });
    }
    return _searchPromise;
}
function normalizeArabic(t) {
    t = t.normalize('NFKD').replace(/[̀-ͯ\p{Mn}\p{Cf}]/gu, '');
    const map = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و', 'ة': 'ه', 'ـ': '' };
    t = t.replace(/[أإآٱىئؤةـ]/g, (c) => map[c] ?? c);
    return t.split(/\s+/).filter(Boolean).join(' ');
}
function searchAyat(index, query, limit = 40) {
    const q = normalizeArabic(query);
    if (q.length < 2) return [];
    const out = [];
    for (const key in index) {
        if (index[key].indexOf(q) !== -1) { out.push(key); if (out.length >= limit) break; }
    }
    return out;
}

// ============================================================
// Audio — Tier 1: continuous per-surah recitation (Bandar Baleelah)
// Streams from the Quran Foundation CDN (no bundling). Surah-level page-follow.
// ============================================================
const SURAH_AUDIO_BASE = 'https://download.quranicaudio.com/quran/bandar_baleela/complete/';
const EVERYAYAH_BASE = 'https://everyayah.com/data/';
// Ayahs per surah (Hafs, 6236 total) — for ayah-by-ayah sequencing.
const AYAH_COUNTS = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6];
// The 15 sajda (prostration) verses, Hafs numbering [surah, ayah].
const SAJDA_VERSES = [[7,206],[13,15],[16,50],[17,109],[19,58],[22,18],[22,77],[25,60],[27,26],[32,15],[38,24],[41,38],[53,62],[84,21],[96,19]];
// Tier 2 per-ayah reciters (everyayah.com). Bandar Baleelah is NOT on per-ayah sources.
const AYAH_RECITERS = [
    { id: 'Alafasy_128kbps', name: 'Mishary Alafasy' },
    { id: 'Husary_128kbps', name: 'Mahmoud Al-Husary' },
    { id: 'Abu_Bakr_Ash-Shaatree_128kbps', name: 'Abu Bakr Ash-Shaatree' },
    { id: 'Minshawy_Murattal_128kbps', name: 'Al-Minshawi (Murattal)' },
    { id: 'Abdurrahmaan_As-Sudais_192kbps', name: 'Abdurrahman As-Sudais' },
];
// mode: 'surah' (Tier 1, Bandar Baleelah whole-surah) | 'ayah' (Tier 2, per-ayah)
const audioState = { mode: 'surah', surah: null, ayah: null, reciter: 'Alafasy_128kbps', followPages: true, repeat: false, range: null };
let _audioEl = null;

const pad3 = (n) => String(n).padStart(3, '0');
function audioSurahUrl(n) { return SURAH_AUDIO_BASE + pad3(n) + '.mp3'; }
function ayahAudioUrl(s, a) { return EVERYAYAH_BASE + audioState.reciter + '/' + pad3(s) + pad3(a) + '.mp3'; }

function nextAyahPos(s, a) {
    if (a < AYAH_COUNTS[s - 1]) return [s, a + 1];
    if (s < 114) return [s + 1, 1];
    return null;
}
function prevAyahPos(s, a) {
    if (a > 1) return [s, a - 1];
    if (s > 1) return [s - 1, AYAH_COUNTS[s - 2]];
    return null;
}
function ayahOrd(s, a) { // global 1-based ayah ordinal, for range comparisons
    let o = 0;
    for (let i = 1; i < s; i++) o += AYAH_COUNTS[i - 1];
    return o + a;
}

function surahById(n) {
    const list = state.metadata && state.metadata.surahs;
    return list ? list.find(s => s.number === n) : null;
}

function formatTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
}

function showAudioBar(show) {
    if (!dom.audioBar) return;
    if (show) dom.audioBar.removeAttribute('hidden');
    else dom.audioBar.setAttribute('hidden', '');
}

function _playEl() {
    const p = _audioEl.play();
    if (p && p.catch) p.catch(() => updatePlayPauseIcon());
}

// --- Tier 1: whole-surah (Bandar Baleelah) ---
function playSurahAudio(n) {
    if (!_audioEl || n < 1 || n > 114) return;
    audioState.mode = 'surah';
    audioState.surah = n;
    audioState.ayah = null;
    audioState.range = null;
    _audioEl.src = audioSurahUrl(n);
    showAudioBar(true);
    updateAudioMeta();
    clearHighlight(); // no per-ayah highlight in whole-surah mode
    _playEl();
    if (audioState.followPages) {
        const s = surahById(n);
        if (s && s.startPage !== state.currentPage) goToPage(s.startPage);
    }
}

function playCurrentSurah() {
    const s = findCurrentSurah(state.currentPage);
    playSurahAudio(s ? s.number : 1);
}

// --- Tier 2: ayah-by-ayah (everyayah), with page auto-turn ---
function playAyahAudio(s, a) {
    if (!_audioEl || s < 1 || s > 114 || a < 1 || a > AYAH_COUNTS[s - 1]) return;
    audioState.mode = 'ayah';
    audioState.ayah = [s, a];
    audioState.surah = null;
    _audioEl.src = ayahAudioUrl(s, a);
    showAudioBar(true);
    updateAudioMeta();
    _playEl();
    highlightAyah(s, a);
    if (audioState.followPages) {
        loadAyahIndex().then(idx => {
            const p = idx.ayahToPage[s + ':' + a];
            if (p && p !== state.currentPage) goToPage(p);
        }).catch(() => {});
    }
}

// Start playback for the current page in the active mode.
function playCurrentInMode() {
    audioState.range = null; // fresh playback isn't a range loop
    if (audioState.mode === 'ayah') {
        loadAyahIndex().then(idx => {
            const pg = idx.pages[String(state.currentPage)];
            if (pg) playAyahAudio(pg[0], pg[1]); else playAyahAudio(1, 1);
        }).catch(() => playAyahAudio(1, 1));
    } else {
        playCurrentSurah();
    }
}

function toggleAudio() {
    if (!_audioEl) return;
    if (!audioState.surah && !audioState.ayah) { playCurrentInMode(); return; }
    if (_audioEl.paused) _playEl(); else _audioEl.pause();
}

function audioStep(delta) {
    audioState.range = null; // a manual skip cancels a Hifz range loop
    if (audioState.mode === 'ayah') {
        const cur = audioState.ayah || [1, 1];
        const nx = delta > 0 ? nextAyahPos(cur[0], cur[1]) : prevAyahPos(cur[0], cur[1]);
        if (nx) playAyahAudio(nx[0], nx[1]);
    } else {
        const next = (audioState.surah || 1) + delta;
        if (next >= 1 && next <= 114) playSurahAudio(next);
    }
}

// Called when a track ends: loop a Hifz range, repeat the ayah, or advance.
function audioEnded() {
    if (audioState.mode === 'ayah' && audioState.range && audioState.ayah) {
        const r = audioState.range, [cs, ca] = audioState.ayah;
        if (cs === r.toS && ca === r.toA) {            // reached end of range
            if (r.times > 0 && --r.remaining <= 0) { stopHifzRange(); return; }
            playAyahAudio(r.fromS, r.fromA);           // loop (infinite if times === 0)
            return;
        }
        const nx = nextAyahPos(cs, ca);
        if (nx) { playAyahAudio(nx[0], nx[1]); return; }
        stopHifzRange();
        return;
    }
    if (audioState.mode === 'ayah' && audioState.repeat && audioState.ayah) {
        playAyahAudio(audioState.ayah[0], audioState.ayah[1]);
    } else {
        audioStep(1);
    }
}

function startHifzRange(fromS, fromA, toS, toA, times) {
    if (ayahOrd(toS, toA) < ayahOrd(fromS, fromA)) { [fromS, fromA, toS, toA] = [toS, toA, fromS, fromA]; }
    audioState.mode = 'ayah';
    audioState.range = { fromS, fromA, toS, toA, times: times || 0, remaining: times || 0 };
    playAyahAudio(fromS, fromA);
}
function stopHifzRange() { audioState.range = null; }

function updatePlayPauseIcon() {
    const btn = document.getElementById('audio-playpause');
    if (!btn || !_audioEl) return;
    const playing = !_audioEl.paused && !_audioEl.ended;
    btn.innerHTML = playing ? '&#10073;&#10073;' : '&#9654;';
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function updateAudioMeta() {
    const titleEl = document.getElementById('audio-title');
    const recEl = document.getElementById('audio-reciter');
    let title = 'Recitation', artist = '';
    if (audioState.mode === 'ayah' && audioState.ayah) {
        const [s, a] = audioState.ayah;
        const surah = surahById(s);
        title = `${surah ? surah.name : 'Surah ' + s} ${s}:${a}`;
        artist = (AYAH_RECITERS.find(r => r.id === audioState.reciter) || {}).name || '';
    } else if (audioState.surah) {
        const s = surahById(audioState.surah);
        title = s ? `${s.number}. ${s.name}` : 'Surah ' + audioState.surah;
        artist = 'Bandar Baleelah';
    }
    if (titleEl) titleEl.textContent = title;
    if (recEl) recEl.textContent = artist;
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'Quran' });
    }
}

// ============================================================
// Ayah line-level highlight (follows Tier-2 audio)
// Uses data/page-lines.json (per-page line y-bands) + data/ayah-lines.json.
// ============================================================
let _lineData = null, _lineDataPromise = null, _currentHL = null;

function loadLineData() {
    if (_lineData) return Promise.resolve(_lineData);
    if (!_lineDataPromise) {
        _lineDataPromise = Promise.all([
            fetch('data/page-lines.json').then(r => { if (!r.ok) throw 0; return r.json(); }),
            fetch('data/ayah-lines.json').then(r => { if (!r.ok) throw 0; return r.json(); }),
        ]).then(([pl, al]) => {
            _lineData = { pageLines: pl.pages, ayahLines: al.ayahLines };
            return _lineData;
        }).catch(e => { _lineDataPromise = null; throw e; });
    }
    return _lineDataPromise;
}

function clearHighlight() {
    _currentHL = null;
    if (dom.ayahHighlightLayer) dom.ayahHighlightLayer.innerHTML = '';
}

function highlightAyah(s, a) {
    _currentHL = [s, a];
    loadLineData().then(d => {
        if (_currentHL && _currentHL[0] === s && _currentHL[1] === a) renderHighlight(d, s, a);
    }).catch(() => {});
}

function _imgForPage(pg) {
    if (pg === state.currentPage && !dom.pageImg.hidden) return dom.pageImg;
    if (_isDualActive && dom.pageImg2 && !dom.pageImg2.hidden && pg === state.currentPage + 1) return dom.pageImg2;
    return null;
}

function renderHighlight(d, s, a) {
    const layer = dom.ayahHighlightLayer;
    if (!layer) return;
    layer.innerHTML = '';
    const lines = d.ayahLines[s + ':' + a];
    if (!lines) return;
    const readerRect = dom.reader.getBoundingClientRect();
    const INSET = 0.045; // bias-early: pull back from edges that border another ayah
    for (const seg of lines) {
        const pg = seg[0], ln = seg[1];
        let t0 = seg[2], t1 = seg[3];
        // Only the first/last line of an ayah shares space with a neighbour (t0>0 or t1<1).
        // Inset those bordering edges inward so the highlight never bleeds past the ayah
        // (errs toward stopping a touch early rather than overshooting). Never invert.
        const cap = (t1 - t0) * 0.3;
        if (t0 > 0.001) t0 += Math.min(INSET, cap);
        if (t1 < 0.999) t1 -= Math.min(INSET, cap);
        const img = _imgForPage(pg);
        if (!img) continue;
        const boxes = d.pageLines[String(pg)];
        if (!boxes || !boxes[ln - 1]) continue;
        const [ya, yb, xL, xR] = boxes[ln - 1];
        // RTL: t runs from xR (0) to xL (1); the ayah segment covers [t0, t1].
        const xRight = xR - t0 * (xR - xL);
        const xLeft = xR - t1 * (xR - xL);
        const r = img.getBoundingClientRect();
        const strip = document.createElement('div');
        strip.className = 'ayah-hl-strip';
        strip.style.left = (r.left - readerRect.left + xLeft * r.width) + 'px';
        strip.style.width = ((xRight - xLeft) * r.width) + 'px';
        strip.style.top = (r.top - readerRect.top + ya * r.height) + 'px';
        strip.style.height = ((yb - ya) * r.height) + 'px';
        layer.appendChild(strip);
    }
}

function repositionHighlight() {
    if (_currentHL && _lineData) renderHighlight(_lineData, _currentHL[0], _currentHL[1]);
}

// ============================================================
// Hifz mode — hide/reveal lines on the current page (uses page-lines.json)
// ============================================================
let _hifzHide = false;

function toggleHifzHide(on) {
    _hifzHide = on;
    if (dom.hifzCoverLayer) {
        if (on) dom.hifzCoverLayer.removeAttribute('hidden');
        else dom.hifzCoverLayer.setAttribute('hidden', '');
    }
    renderHifzCovers();
}

function renderHifzCovers() {
    const layer = dom.hifzCoverLayer;
    if (!layer) return;
    layer.innerHTML = '';
    if (!_hifzHide) return;
    loadLineData().then(d => {
        if (!_hifzHide) return;
        const boxes = d.pageLines[String(state.currentPage)];
        if (!boxes || dom.pageImg.hidden) return;
        const r = dom.pageImg.getBoundingClientRect();
        const rr = dom.reader.getBoundingClientRect();
        layer.innerHTML = '';
        for (const [ya, yb, xL, xR] of boxes) {
            const cov = document.createElement('div');
            cov.className = 'hifz-cover';
            cov.style.left = (r.left - rr.left + xL * r.width) + 'px';
            cov.style.width = ((xR - xL) * r.width) + 'px';
            cov.style.top = (r.top - rr.top + ya * r.height) + 'px';
            cov.style.height = ((yb - ya) * r.height) + 'px';
            cov.addEventListener('click', () => cov.classList.toggle('revealed'));
            layer.appendChild(cov);
        }
    }).catch(() => {});
}

function initAudio() {
    _audioEl = document.getElementById('audio-el');
    if (!_audioEl) return;
    const seek = document.getElementById('audio-seek');
    const curEl = document.getElementById('audio-cur');
    const durEl = document.getElementById('audio-dur');

    _audioEl.addEventListener('play', updatePlayPauseIcon);
    _audioEl.addEventListener('pause', updatePlayPauseIcon);
    _audioEl.addEventListener('ended', audioEnded); // continuous play / ayah repeat
    _audioEl.addEventListener('loadedmetadata', () => {
        if (durEl) durEl.textContent = formatTime(_audioEl.duration);
    });
    _audioEl.addEventListener('timeupdate', () => {
        if (!_audioEl.duration) return;
        if (curEl) curEl.textContent = formatTime(_audioEl.currentTime);
        if (seek && !seek._dragging) seek.value = (_audioEl.currentTime / _audioEl.duration) * 100;
    });
    if (seek) {
        seek.addEventListener('input', () => { seek._dragging = true; });
        seek.addEventListener('change', () => {
            if (_audioEl.duration) _audioEl.currentTime = (seek.value / 100) * _audioEl.duration;
            seek._dragging = false;
        });
    }
    document.getElementById('audio-playpause').addEventListener('click', toggleAudio);
    document.getElementById('audio-prev').addEventListener('click', () => audioStep(-1));
    document.getElementById('audio-next').addEventListener('click', () => audioStep(1));
    document.getElementById('audio-close').addEventListener('click', () => {
        _audioEl.pause();
        showAudioBar(false);
        clearHighlight();
    });

    const trClose = document.getElementById('translation-close');
    if (trClose) trClose.addEventListener('click', () => { if (dom.translationPanel) dom.translationPanel.setAttribute('hidden', ''); });

    if ('mediaSession' in navigator) {
        const ms = navigator.mediaSession;
        ms.setActionHandler('play', () => toggleAudio());
        ms.setActionHandler('pause', () => toggleAudio());
        ms.setActionHandler('nexttrack', () => audioStep(1));
        ms.setActionHandler('previoustrack', () => audioStep(-1));
    }
}

function showPageIndicator(page) {
    if (!dom.pageIndicator) return;
    dom.pageIndicator.textContent = page;
    dom.pageIndicator.classList.add('visible');
    clearTimeout(_indicatorTimer);
    _indicatorTimer = setTimeout(() => {
        dom.pageIndicator.classList.remove('visible');
    }, PAGE_INDICATOR_MS);
}

function findCurrentJuz(page) {
    if (!state.metadata || !state.metadata.juz) return null;
    const juzArr = state.metadata.juz;
    // Binary search for the juz containing this page
    let lo = 0, hi = juzArr.length - 1;
    let result = juzArr[0];
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (juzArr[mid].startPage <= page) {
            result = juzArr[mid];
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}

function renderMarkers(page) {
    if (!dom.markersLayer) return;
    dom.markersLayer.innerHTML = '';

    // Position markers layer exactly over the image
    const imgRect = dom.pageImg.getBoundingClientRect();
    const readerRect = dom.reader.getBoundingClientRect();
    dom.markersLayer.style.left = (imgRect.left - readerRect.left) + 'px';
    dom.markersLayer.style.top = (imgRect.top - readerRect.top) + 'px';
    dom.markersLayer.style.width = imgRect.width + 'px';
    dom.markersLayer.style.height = imgRect.height + 'px';

    const pageMarkers = state.markers[page];
    if (!pageMarkers || !Array.isArray(pageMarkers)) return;
    pageMarkers.forEach((marker, index) => {
        const el = document.createElement('div');
        el.className = 'marker';
        el.style.left = marker.x + '%';
        el.style.top = marker.y + '%';
        el.dataset.page = page;
        el.dataset.index = index;
        dom.markersLayer.appendChild(el);
    });
}

function preloadAdjacent(page) {
    for (let i = 1; i <= PRELOAD_RANGE; i++) {
        if (page + i <= state.totalPages) {
            new Image().src = getImageUrl(page + i, 'high');
        }
        if (page - i >= 1) {
            new Image().src = getImageUrl(page - i, 'high');
        }
    }
}

// ============================================================
// Navigation (swipe, tap, zoom)
// ============================================================
function setupNavigation() {
    // --- Swipe state ---
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    let isSwiping = false;
    let swipeDirectionLocked = false;
    let incomingWrapper = null;
    let incomingTargetPage = 0;
    let swipeAnimating = false;

    // --- Pinch zoom state ---
    let initialPinchDist = 0;
    let currentScale = 1;
    let translateX = 0, translateY = 0;
    let isPinching = false;
    let panStartX = 0, panStartY = 0;
    let panStartTransX = 0, panStartTransY = 0;

    // --- Double-tap detection ---
    let lastTapTime = 0;

    function getDistance(t1, t2) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function applyTransform() {
        dom.pageImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentScale})`;
    }

    function resetZoom() {
        currentScale = 1;
        translateX = 0;
        translateY = 0;
        state.isZoomed = false;
        state.zoomLevel = 1;
        dom.pageImg.style.transform = '';
    }

    function cleanupSwipe() {
        if (incomingWrapper) {
            incomingWrapper.remove();
            incomingWrapper = null;
        }
        dom.pageContainer.style.transition = '';
        dom.pageContainer.style.transform = '';
        isSwiping = false;
        swipeDirectionLocked = false;
        incomingTargetPage = 0;
        swipeAnimating = false;
    }

    function createIncomingPage(targetPage) {
        if (targetPage < 1 || targetPage > state.totalPages) return;
        incomingTargetPage = targetPage;

        incomingWrapper = document.createElement('div');
        incomingWrapper.className = 'swipe-incoming';

        const img = document.createElement('img');
        img.draggable = false;
        img.alt = 'Quran page';

        // Load thumb as placeholder, then swap to high-res
        img.src = getImageUrl(targetPage, 'thumb');
        const hiImg = new Image();
        hiImg.src = getImageUrl(targetPage, 'high');
        hiImg.onload = () => {
            if (incomingWrapper) img.src = hiImg.src;
        };

        incomingWrapper.appendChild(img);
        dom.reader.insertBefore(incomingWrapper, dom.pageContainer);
    }

    // Touch events on #reader
    dom.reader.addEventListener('touchstart', (e) => {
        if (swipeAnimating) return;
        if (e.touches.length === 2) {
            isPinching = true;
            isSwiping = false;
            cleanupSwipe();
            initialPinchDist = getDistance(e.touches[0], e.touches[1]);
            return;
        }
        if (e.touches.length === 1) {
            isPinching = false;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
            isSwiping = false;
            swipeDirectionLocked = false;

            if (currentScale > 1) {
                panStartX = e.touches[0].clientX;
                panStartY = e.touches[0].clientY;
                panStartTransX = translateX;
                panStartTransY = translateY;
            }
        }
    }, { passive: true });

    dom.reader.addEventListener('touchmove', (e) => {
        if (swipeAnimating) return;
        if (e.touches.length === 2 && isPinching) {
            e.preventDefault();
            const newDist = getDistance(e.touches[0], e.touches[1]);
            let scale = (newDist / initialPinchDist) * currentScale;
            scale = Math.max(1, Math.min(scale, 4));
            dom.pageImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            state.zoomLevel = scale;
            return;
        }
        if (e.touches.length === 1) {
            if (currentScale > 1) {
                e.preventDefault();
                const dx = e.touches[0].clientX - panStartX;
                const dy = e.touches[0].clientY - panStartY;
                translateX = panStartTransX + dx;
                translateY = panStartTransY + dy;
                applyTransform();
                return;
            }

            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;

            // Lock direction on first significant movement
            if (!swipeDirectionLocked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                if (Math.abs(dy) > Math.abs(dx)) {
                    // Vertical movement — don't intercept
                    return;
                }
                swipeDirectionLocked = true;
                isSwiping = true;

                // Only do interactive swipe in single-page mode
                if (!_isDualActive) {
                    const step = 1;
                    const targetPage = dx > 0
                        ? state.currentPage + step  // swipe right = forward (like turning a book page)
                        : state.currentPage - step; // swipe left = backward

                    dom.pageContainer.style.transition = 'none';
                    createIncomingPage(targetPage);
                }
            }

            if (isSwiping) {
                e.preventDefault();

                if (_isDualActive) {
                    // Dual-page: no interactive swipe, just track for threshold
                    return;
                }

                let adjustedDx = dx;
                if (!incomingWrapper) {
                    // No valid target page — rubber band
                    adjustedDx = dx * 0.3;
                } else {
                    // Clamp: don't allow dragging past start in wrong direction
                    if (incomingTargetPage > state.currentPage) {
                        // Swiping right (forward) — only allow positive dx
                        adjustedDx = Math.max(0, dx);
                    } else {
                        // Swiping left (backward) — only allow negative dx
                        adjustedDx = Math.min(0, dx);
                    }
                }

                dom.pageContainer.style.transform = `translateX(${adjustedDx}px)`;
            }
        }
    }, { passive: false });

    dom.reader.addEventListener('touchend', (e) => {
        if (swipeAnimating) return;
        if (isPinching && e.touches.length < 2) {
            const finalScale = state.zoomLevel;
            currentScale = Math.max(1, Math.min(finalScale, 4));
            state.isZoomed = currentScale > 1;
            if (currentScale <= 1.05) resetZoom();
            applyTransform();
            isPinching = false;
            return;
        }

        if (isSwiping) {
            const rawDeltaX = e.changedTouches[0].clientX - touchStartX;

            // Dual-page mode: fall back to old threshold-based behavior
            if (_isDualActive) {
                if (Math.abs(rawDeltaX) > SWIPE_THRESHOLD) {
                    if (rawDeltaX > 0) nextPage();
                    else prevPage();
                }
                isSwiping = false;
                swipeDirectionLocked = false;
                return;
            }

            // Clamp delta same way as touchmove
            let deltaX = rawDeltaX;
            if (incomingWrapper && incomingTargetPage > state.currentPage) {
                deltaX = Math.max(0, rawDeltaX); // forward = positive only
            } else if (incomingWrapper && incomingTargetPage < state.currentPage) {
                deltaX = Math.min(0, rawDeltaX); // backward = negative only
            } else if (!incomingWrapper) {
                deltaX = rawDeltaX * 0.3;
            }

            const readerWidth = dom.reader.offsetWidth;
            const elapsed = Date.now() - touchStartTime;
            const velocity = Math.abs(deltaX) / Math.max(elapsed, 1);
            const shouldComplete = incomingWrapper &&
                incomingTargetPage >= 1 && incomingTargetPage <= state.totalPages &&
                (Math.abs(deltaX) > readerWidth * 0.25 || velocity > 0.4);

            if (shouldComplete) {
                // Animate current page off-screen, revealing incoming
                swipeAnimating = true;
                const direction = deltaX < 0 ? -1 : 1;
                dom.pageContainer.style.transition = 'transform 250ms ease-out';
                dom.pageContainer.style.transform = `translateX(${direction * readerWidth}px)`;

                const targetPage = incomingTargetPage;
                const incomingImgSrc = incomingWrapper?.querySelector('img')?.src;

                const finishSwipe = () => {
                    if (!swipeAnimating) return;
                    // Set main image to incoming image BEFORE cleanup to avoid flash
                    if (incomingImgSrc) {
                        dom.pageImg.src = incomingImgSrc;
                        dom.pageImg.style.filter = '';
                        dom.pageImg.style.transform = '';
                    }
                    cleanupSwipe();
                    renderPage(targetPage, true); // skipBlur = true
                    navigator.vibrate?.(10);
                };

                dom.pageContainer.addEventListener('transitionend', finishSwipe, { once: true });

                // Fallback timeout in case transitionend doesn't fire
                setTimeout(finishSwipe, 300);
            } else {
                // Snap back
                swipeAnimating = true;
                dom.pageContainer.style.transition = 'transform 200ms ease-out';
                dom.pageContainer.style.transform = 'translateX(0)';

                dom.pageContainer.addEventListener('transitionend', function onEnd() {
                    dom.pageContainer.removeEventListener('transitionend', onEnd);
                    cleanupSwipe();
                }, { once: true });

                setTimeout(() => {
                    if (swipeAnimating) cleanupSwipe();
                }, 250);
            }
            return;
        }

        // Double-tap detection
        const now = Date.now();
        if (now - lastTapTime < 300) {
            resetZoom();
            lastTapTime = 0;
            return;
        }
        lastTapTime = now;
    }, { passive: true });

    // --- Tap zones ---
    dom.tapLeft.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentScale > 1) return; // Don't navigate when zoomed
        nextPage(); // Left = forward in RTL
    });

    dom.tapRight.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentScale > 1) return;
        prevPage(); // Right = backward in RTL
    });

    // Middle area tap — toggle menu
    dom.reader.addEventListener('click', (e) => {
        // Only if tap is in middle 50% horizontally
        const rect = dom.reader.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = x / rect.width;
        if (pct > 0.25 && pct < 0.75) {
            if (state.isMenuOpen) {
                closeMenu();
            } else {
                openMenu();
            }
        }
    });

    // --- Keyboard support ---
    document.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'ArrowLeft':
                nextPage(); // Left = forward in RTL
                break;
            case 'ArrowRight':
                prevPage(); // Right = backward in RTL
                break;
            case 'Escape':
                closeMenu();
                break;
            case 'AudioVolumeUp':
                e.preventDefault();
                nextPage();
                break;
            case 'AudioVolumeDown':
                e.preventDefault();
                prevPage();
                break;
        }
    });
}

function goToPage(page, direction) {
    page = Math.max(1, Math.min(page, state.totalPages));
    if (page === state.currentPage) return;

    // Determine animation direction if not provided
    if (!direction) {
        direction = page > state.currentPage ? 'forward' : 'backward';
    }

    // Add slide animation
    const animClass = direction === 'forward' ? 'page-slide-left' : 'page-slide-right';
    dom.pageContainer.classList.add(animClass);
    setTimeout(() => {
        dom.pageContainer.classList.remove(animClass);
    }, 200);

    renderPage(page);
}

function nextPage() {
    const step = _isDualActive ? 2 : 1;
    if (state.currentPage + step <= state.totalPages) {
        navigator.vibrate?.(10);
        goToPage(state.currentPage + step, 'forward');
    }
}

function prevPage() {
    const step = _isDualActive ? 2 : 1;
    if (state.currentPage - step >= 1) {
        navigator.vibrate?.(10);
        goToPage(state.currentPage - step, 'backward');
    }
}

// ============================================================
// Menu
// ============================================================
function setupMenu() {
    const surahs = state.metadata?.surahs || [];
    const juzData = state.metadata?.juz || [];

    // Build menu HTML
    dom.menuPanel.innerHTML = `
        <!-- Close button -->
        <button id="menu-close-btn" aria-label="Close menu"
            style="position:sticky;top:0;right:0;float:right;width:40px;height:40px;border:none;border-radius:50%;background:var(--menu-border);color:var(--menu-text);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;margin-bottom:8px;z-index:10;">&times;</button>

        <!-- Surahs -->
        <div class="menu-section">
            <div class="menu-section-title collapsible collapsed" data-target="surah-content">Surahs <span class="collapse-arrow">&#9660;</span></div>
            <div id="surah-content" class="collapsible-content collapsed">
                <input type="text" class="menu-search" id="surah-search" placeholder="Search surah..." autocomplete="off">
                <ul class="surah-list" id="surah-list"></ul>
            </div>
        </div>

        <!-- Juz Pills -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="juz-content">Juz <span class="collapse-arrow">&#9660;</span></div>
            <div id="juz-content" class="collapsible-content">
                <div class="juz-pills" id="juz-pills"></div>
            </div>
        </div>

        <!-- Reading Progress -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="progress-content">Reading Progress <span class="collapse-arrow">&#9660;</span></div>
            <div id="progress-content" class="collapsible-content">
                <div id="progress-label" style="text-align:center;font-size:13px;color:var(--menu-text);margin-bottom:8px;"></div>
                <div style="height:8px;border-radius:4px;background:var(--menu-border);overflow:hidden;margin-bottom:12px;">
                    <div id="progress-bar-fill" style="height:100%;width:0%;background:var(--accent);transition:width .3s;"></div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="progress-resume-btn"
                        style="flex:1;padding:9px;border:1.5px solid var(--accent);border-radius:var(--btn-radius);background:transparent;color:var(--accent);font-size:13px;font-weight:600;cursor:pointer;">Resume</button>
                    <button id="progress-khatm-btn"
                        style="flex:1;padding:9px;border:none;border-radius:var(--btn-radius);background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Complete Khatm</button>
                    <button id="progress-reset-btn"
                        style="flex:1;padding:9px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:13px;cursor:pointer;">Reset</button>
                </div>
                <div id="progress-khatm-count" style="text-align:center;font-size:12px;color:#888;margin-top:8px;"></div>
            </div>
        </div>

        <!-- Page Jump -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="page-jump-content">Go to Page <span class="collapse-arrow">&#9660;</span></div>
            <div id="page-jump-content" class="collapsible-content">
                <div class="page-jump" style="display:flex;gap:8px;">
                    <input type="number" id="page-jump-input" min="1" max="${state.totalPages}"
                        placeholder="Page (1-${state.totalPages})"
                        style="flex:1;padding:10px 14px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:14px;outline:none;">
                    <button id="page-jump-btn"
                        style="padding:10px 20px;border:none;border-radius:var(--btn-radius);background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Go</button>
                </div>
            </div>
        </div>

        <!-- Go to Ayah -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="ayah-jump-content">Go to Ayah <span class="collapse-arrow">&#9660;</span></div>
            <div id="ayah-jump-content" class="collapsible-content">
                <div style="display:flex;gap:8px;">
                    <input type="number" id="ayah-jump-surah" min="1" max="114" placeholder="Surah (1-114)"
                        style="flex:1;padding:10px 14px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:14px;outline:none;">
                    <input type="number" id="ayah-jump-ayah" min="1" placeholder="Ayah"
                        style="flex:1;padding:10px 14px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:14px;outline:none;">
                    <button id="ayah-jump-btn"
                        style="padding:10px 20px;border:none;border-radius:var(--btn-radius);background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Go</button>
                </div>
                <div id="ayah-jump-msg" style="font-size:12px;color:#c0392b;margin-top:6px;min-height:14px;"></div>
            </div>
        </div>

        <!-- Search -->
        <div class="menu-section">
            <div class="menu-section-title collapsible collapsed" data-target="search-content">Search <span class="collapse-arrow">&#9660;</span></div>
            <div id="search-content" class="collapsible-content collapsed">
                <input type="text" class="menu-search" id="ayah-search-input" placeholder="Search Quran text…" autocomplete="off" dir="rtl">
                <div id="ayah-search-msg" style="font-size:12px;color:#888;margin:6px 0;min-height:14px;"></div>
                <ul class="surah-list" id="ayah-search-results"></ul>
            </div>
        </div>

        <!-- Translation -->
        <div class="menu-section">
            <div class="menu-section-title collapsible collapsed" data-target="translation-content">Translation <span class="collapse-arrow">&#9660;</span></div>
            <div id="translation-content" class="collapsible-content collapsed">
                <button id="open-translation-btn"
                    style="width:100%;padding:11px;border:none;border-radius:var(--btn-radius);background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Show this page's translation</button>
                <div style="text-align:center;font-size:12px;color:#888;margin-top:6px;">English — M. Pickthall</div>
            </div>
        </div>

        <!-- Sajda verses -->
        <div class="menu-section">
            <div class="menu-section-title collapsible collapsed" data-target="sajda-content">Sajda verses <span class="collapse-arrow">&#9660;</span></div>
            <div id="sajda-content" class="collapsible-content collapsed">
                <ul class="surah-list" id="sajda-list"></ul>
            </div>
        </div>

        <!-- Audio -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="audio-content">Audio <span class="collapse-arrow">&#9660;</span></div>
            <div id="audio-content" class="collapsible-content">
                <select id="audio-reciter-select"
                    style="width:100%;padding:9px 10px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:var(--menu-bg);color:var(--menu-text);font-size:14px;margin-bottom:10px;cursor:pointer;">
                    <option value="surah">Bandar Baleelah — whole surah</option>
                    <optgroup label="Ayah by ayah">
                        ${AYAH_RECITERS.map(r => `<option value="ayah:${r.id}">${r.name}</option>`).join('')}
                    </optgroup>
                </select>
                <button id="audio-play-current"
                    style="width:100%;padding:11px;border:none;border-radius:var(--btn-radius);background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px;">&#9654; Play recitation</button>
                <div class="setting-row">
                    <span class="setting-label">Follow pages</span>
                    <label class="toggle">
                        <input type="checkbox" id="audio-follow-toggle" ${audioState.followPages ? 'checked' : ''}>
                        <span class="toggle-track"></span>
                    </label>
                </div>
                <div class="setting-row">
                    <span class="setting-label">Repeat ayah</span>
                    <label class="toggle">
                        <input type="checkbox" id="audio-repeat-toggle" ${audioState.repeat ? 'checked' : ''}>
                        <span class="toggle-track"></span>
                    </label>
                </div>
            </div>
        </div>

        <!-- Hifz (memorization) -->
        <div class="menu-section">
            <div class="menu-section-title collapsible collapsed" data-target="hifz-content">Hifz (memorization) <span class="collapse-arrow">&#9660;</span></div>
            <div id="hifz-content" class="collapsible-content collapsed">
                <div style="font-size:12px;color:#888;margin-bottom:8px;">Loop a range (ayah-by-ayah audio).</div>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
                    <span style="font-size:13px;width:34px;">From</span>
                    <input type="number" id="hifz-from-s" min="1" max="114" placeholder="Surah" style="flex:1;min-width:0;padding:8px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:13px;">
                    <input type="number" id="hifz-from-a" min="1" placeholder="Ayah" style="flex:1;min-width:0;padding:8px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:13px;">
                </div>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
                    <span style="font-size:13px;width:34px;">To</span>
                    <input type="number" id="hifz-to-s" min="1" max="114" placeholder="Surah" style="flex:1;min-width:0;padding:8px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:13px;">
                    <input type="number" id="hifz-to-a" min="1" placeholder="Ayah" style="flex:1;min-width:0;padding:8px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:13px;">
                </div>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;width:34px;">Times</span>
                    <input type="number" id="hifz-times" min="0" placeholder="0 = ∞" style="flex:1;min-width:0;padding:8px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:13px;">
                    <button id="hifz-start" style="flex:1;padding:9px;border:none;border-radius:var(--btn-radius);background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Loop</button>
                </div>
                <div id="hifz-range-msg" style="font-size:12px;color:#c0392b;margin-bottom:10px;min-height:14px;"></div>
                <div class="setting-row">
                    <span class="setting-label">Hide lines (tap to reveal)</span>
                    <label class="toggle">
                        <input type="checkbox" id="hifz-hide-toggle">
                        <span class="toggle-track"></span>
                    </label>
                </div>
            </div>
        </div>

        <!-- Settings -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="settings-content">Settings <span class="collapse-arrow">&#9660;</span></div>
            <div id="settings-content" class="collapsible-content">

            <div class="setting-row">
                <span class="setting-label">Theme</span>
                <select id="theme-select"
                    style="padding:6px 10px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:var(--menu-bg);color:var(--menu-text);font-size:14px;outline:none;cursor:pointer;">
                    <option value="light" ${state.theme === 'light' ? 'selected' : ''}>Light</option>
                    <option value="sepia" ${state.theme === 'sepia' ? 'selected' : ''}>Sepia</option>
                    <option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>Dark</option>
                </select>
            </div>

            <div class="setting-row">
                <span class="setting-label">Dual Page</span>
                <select id="dual-page-select"
                    style="padding:6px 10px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:var(--menu-bg);color:var(--menu-text);font-size:14px;outline:none;cursor:pointer;">
                    <option value="auto" ${state.dualPage === 'auto' ? 'selected' : ''}>Auto</option>
                    <option value="on" ${state.dualPage === 'on' ? 'selected' : ''}>On</option>
                    <option value="off" ${state.dualPage === 'off' ? 'selected' : ''}>Off</option>
                </select>
            </div>

            <div class="slider-row">
                <span class="slider-icon">&#9788;</span>
                <input type="range" id="brightness-slider" min="0.3" max="1" step="0.05" value="${state.brightness}">
                <span class="slider-icon">&#9728;</span>
            </div>

            <div class="setting-row">
                <span class="setting-label">Keep Screen Awake</span>
                <label class="toggle">
                    <input type="checkbox" id="wakelock-toggle" ${state.keepAwake ? 'checked' : ''}>
                    <span class="toggle-track"></span>
                </label>
            </div>
            </div>
        </div>

        <!-- Bookmarks -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="bookmarks-content">Bookmarks <span class="collapse-arrow">&#9660;</span></div>
            <div id="bookmarks-content" class="collapsible-content">
                <button id="add-bookmark-btn"
                    style="width:100%;padding:10px;border:1.5px dashed var(--accent);border-radius:var(--btn-radius);background:transparent;color:var(--accent);font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px;">+ Add Bookmark</button>
                <ul class="bookmark-list" id="bookmark-list"></ul>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button id="data-export-btn" style="flex:1;padding:9px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:13px;cursor:pointer;">Export</button>
                    <button id="data-import-btn" style="flex:1;padding:9px;border:1.5px solid var(--menu-border);border-radius:var(--btn-radius);background:transparent;color:var(--menu-text);font-size:13px;cursor:pointer;">Import</button>
                    <input type="file" id="data-import-file" accept="application/json,.json" hidden>
                </div>
                <div id="data-io-msg" style="font-size:12px;color:#888;margin-top:6px;min-height:14px;"></div>
            </div>
        </div>

        <!-- Offline -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="offline-content">Offline <span class="collapse-arrow">&#9660;</span></div>
            <div id="offline-content" class="collapsible-content">
                <button id="download-all-btn"
                    style="width:100%;padding:12px;border:none;border-radius:var(--btn-radius);background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Download All Pages</button>
                <div id="download-progress" style="display:none;margin-top:8px;text-align:center;font-size:13px;color:#888;"></div>
                <button id="install-btn" hidden
                    style="width:100%;padding:11px;border:1.5px solid var(--accent);border-radius:var(--btn-radius);background:transparent;color:var(--accent);font-size:14px;font-weight:600;cursor:pointer;margin-top:10px;">Install app</button>
                <div id="storage-usage" style="margin-top:10px;text-align:center;font-size:12px;color:#888;"></div>
            </div>
        </div>
    `;

    // Collapsible sections
    dom.menuPanel.querySelectorAll('.collapsible').forEach(title => {
        title.addEventListener('click', () => {
            const target = document.getElementById(title.dataset.target);
            if (!target) return;
            const isOpen = !target.classList.contains('collapsed');
            target.classList.toggle('collapsed', isOpen);
            title.classList.toggle('collapsed', isOpen);
        });
    });

    // Populate surah list
    const surahListEl = document.getElementById('surah-list');
    renderSurahList(surahListEl, surahs, '');

    // Populate juz pills
    const juzPillsEl = document.getElementById('juz-pills');
    const currentJuz = findCurrentJuz(state.currentPage);
    juzData.forEach(juz => {
        const pill = document.createElement('button');
        pill.className = 'juz-pill' + (currentJuz && currentJuz.number === juz.number ? ' active' : '');
        pill.textContent = juz.number;
        pill.addEventListener('click', () => {
            goToPage(juz.startPage);
            closeMenu();
        });
        juzPillsEl.appendChild(pill);
    });

    // Search filter
    const searchInput = document.getElementById('surah-search');
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        renderSurahList(surahListEl, surahs, query);
    });

    // Page jump
    const pageJumpInput = document.getElementById('page-jump-input');
    const pageJumpBtn = document.getElementById('page-jump-btn');
    const doPageJump = () => {
        const val = parseInt(pageJumpInput.value, 10);
        if (val >= 1 && val <= state.totalPages) {
            goToPage(val);
            closeMenu();
        }
    };
    pageJumpBtn.addEventListener('click', doPageJump);
    pageJumpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doPageJump();
    });

    // Go to Ayah
    const ayahSurahInput = document.getElementById('ayah-jump-surah');
    const ayahAyahInput = document.getElementById('ayah-jump-ayah');
    const ayahJumpBtn = document.getElementById('ayah-jump-btn');
    const ayahMsg = document.getElementById('ayah-jump-msg');
    const doAyahJump = async () => {
        const surah = parseInt(ayahSurahInput.value, 10);
        const ayah = parseInt(ayahAyahInput.value, 10);
        if (!(surah >= 1 && surah <= 114) || !(ayah >= 1)) {
            ayahMsg.textContent = 'Enter a surah (1-114) and ayah number.';
            return;
        }
        ayahMsg.style.color = '#888';
        ayahMsg.textContent = 'Looking up…';
        try {
            const index = await loadAyahIndex();
            const page = pageForAyah(index, surah, ayah);
            if (page) {
                ayahMsg.textContent = '';
                goToPage(page);
                closeMenu();
            } else {
                ayahMsg.style.color = '#c0392b';
                ayahMsg.textContent = `Ayah ${surah}:${ayah} not found.`;
            }
        } catch (e) {
            ayahMsg.style.color = '#c0392b';
            ayahMsg.textContent = 'Could not load ayah index (offline?).';
        }
    };
    ayahJumpBtn.addEventListener('click', doAyahJump);
    [ayahSurahInput, ayahAyahInput].forEach(el => el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doAyahJump();
    }));

    // Translation panel
    const openTrBtn = document.getElementById('open-translation-btn');
    if (openTrBtn) openTrBtn.addEventListener('click', () => { openTranslationPanel(); closeMenu(); });

    // Sajda verses list
    const sajdaList = document.getElementById('sajda-list');
    if (sajdaList) {
        sajdaList.innerHTML = '';
        SAJDA_VERSES.forEach(([s, a]) => {
            const surah = (state.metadata.surahs || []).find(x => x.number === s);
            const li = document.createElement('li');
            li.className = 'surah-item';
            li.innerHTML = `<span class="surah-page" style="font-size:12px;color:#888;flex-shrink:0;min-width:44px;">${s}:${a}</span><span class="surah-name-en">${surah ? surah.name : 'Surah ' + s}</span>`;
            li.addEventListener('click', async () => {
                try {
                    const idx = await loadAyahIndex();
                    const pg = idx.ayahToPage[`${s}:${a}`];
                    if (pg) { goToPage(pg); closeMenu(); }
                } catch (e) {}
            });
            sajdaList.appendChild(li);
        });
    }

    // Ayah text search
    const searchInputEl = document.getElementById('ayah-search-input');
    const searchMsg = document.getElementById('ayah-search-msg');
    const searchResults = document.getElementById('ayah-search-results');
    let _searchTimer = null;
    if (searchInputEl) {
        searchInputEl.addEventListener('input', () => {
            clearTimeout(_searchTimer);
            const query = searchInputEl.value.trim();
            if (query.length < 2) { searchResults.innerHTML = ''; searchMsg.textContent = ''; return; }
            searchMsg.textContent = 'Searching…';
            _searchTimer = setTimeout(async () => {
                try {
                    const [si, idx] = await Promise.all([loadSearchIndex(), loadAyahIndex()]);
                    const hits = searchAyat(si, query);
                    searchResults.innerHTML = '';
                    if (!hits.length) { searchMsg.textContent = 'No matches.'; return; }
                    searchMsg.textContent = `${hits.length}${hits.length >= 40 ? '+' : ''} result${hits.length === 1 ? '' : 's'}`;
                    for (const key of hits) {
                        const [s, a] = key.split(':');
                        const surah = (state.metadata.surahs || []).find(x => x.number === +s);
                        const li = document.createElement('li');
                        li.className = 'surah-item';
                        li.innerHTML = `<span class="surah-page" style="font-size:12px;color:#888;flex-shrink:0;min-width:44px;">${s}:${a}</span><span class="surah-name-en">${surah ? surah.name : 'Surah ' + s}</span>`;
                        li.addEventListener('click', () => {
                            const pg = idx.ayahToPage[key];
                            if (pg) { goToPage(pg); closeMenu(); }
                        });
                        searchResults.appendChild(li);
                    }
                } catch (e) { searchMsg.style.color = '#c0392b'; searchMsg.textContent = 'Search unavailable (offline?).'; }
            }, 250);
        });
    }

    // Audio
    const recSel = document.getElementById('audio-reciter-select');
    if (recSel) {
        recSel.value = audioState.mode === 'ayah' ? 'ayah:' + audioState.reciter : 'surah';
        recSel.addEventListener('change', (e) => {
            const v = e.target.value;
            if (v === 'surah') { audioState.mode = 'surah'; clearHighlight(); }
            else { audioState.mode = 'ayah'; audioState.reciter = v.slice(5); }
        });
    }
    document.getElementById('audio-play-current').addEventListener('click', () => {
        playCurrentInMode();
        closeMenu();
    });
    document.getElementById('audio-follow-toggle').addEventListener('change', (e) => {
        audioState.followPages = e.target.checked;
    });
    const repToggle = document.getElementById('audio-repeat-toggle');
    if (repToggle) repToggle.addEventListener('change', (e) => { audioState.repeat = e.target.checked; });

    // Hifz — range loop + hide/reveal
    const hifzMsg = document.getElementById('hifz-range-msg');
    document.getElementById('hifz-start').addEventListener('click', () => {
        const fs = parseInt(document.getElementById('hifz-from-s').value, 10);
        const fa = parseInt(document.getElementById('hifz-from-a').value, 10);
        const ts = parseInt(document.getElementById('hifz-to-s').value, 10);
        const ta = parseInt(document.getElementById('hifz-to-a').value, 10);
        const times = parseInt(document.getElementById('hifz-times').value, 10) || 0;
        const valid = (s, a) => s >= 1 && s <= 114 && a >= 1 && a <= AYAH_COUNTS[s - 1];
        if (!valid(fs, fa) || !valid(ts, ta)) { hifzMsg.textContent = 'Enter valid From and To (surah:ayah).'; return; }
        hifzMsg.textContent = '';
        audioState.reciter = audioState.reciter || 'Alafasy_128kbps';
        startHifzRange(fs, fa, ts, ta, times);
        closeMenu();
    });
    const hideToggle = document.getElementById('hifz-hide-toggle');
    if (hideToggle) {
        hideToggle.checked = _hifzHide;
        hideToggle.addEventListener('change', (e) => { toggleHifzHide(e.target.checked); if (e.target.checked) closeMenu(); });
    }

    // Reading progress
    if (!_visitedSet) _visitedSet = new Set(state.progress.visited);
    updateProgressUI();
    const khatmCountEl = document.getElementById('progress-khatm-count');
    const n = (state.progress.khatms || []).length;
    if (khatmCountEl) khatmCountEl.textContent = n ? `${n} khatm${n > 1 ? 's' : ''} completed` : '';
    document.getElementById('progress-resume-btn').addEventListener('click', () => {
        goToPage(state.currentPage);
        closeMenu();
    });
    document.getElementById('progress-khatm-btn').addEventListener('click', () => {
        const { pct } = progressStats();
        const msg = pct < 100
            ? `You've read ${pct}% this khatm. Mark it complete and start a new one?`
            : 'Mark this khatm complete and start a new one? Alhamdulillah!';
        if (confirm(msg)) {
            completeKhatm();
            const c = (state.progress.khatms || []).length;
            if (khatmCountEl) khatmCountEl.textContent = c ? `${c} khatm${c > 1 ? 's' : ''} completed` : '';
        }
    });
    document.getElementById('progress-reset-btn').addEventListener('click', () => {
        if (confirm('Reset reading progress for the current khatm?')) resetProgress();
    });

    // Theme toggle
    document.getElementById('theme-select').addEventListener('change', (e) => {
        setTheme(e.target.value);
    });

    // Dual page select
    document.getElementById('dual-page-select').addEventListener('change', (e) => {
        state.dualPage = e.target.value;
        saveState();
        updateDualPageMode();
    });

    // Brightness slider
    document.getElementById('brightness-slider').addEventListener('input', (e) => {
        state.brightness = parseFloat(e.target.value);
        applyBrightness();
        saveState();
    });

    // Wake lock toggle
    document.getElementById('wakelock-toggle').addEventListener('change', (e) => {
        state.keepAwake = e.target.checked;
        if (state.keepAwake) {
            requestWakeLock();
        } else {
            releaseWakeLock();
        }
        saveState();
    });

    // Download all button
    document.getElementById('download-all-btn').addEventListener('click', () => {
        startDownloadAll();
    });

    // Install (A2HS) + storage usage
    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
        if (_deferredInstallPrompt) installBtn.removeAttribute('hidden');
        installBtn.addEventListener('click', async () => {
            if (!_deferredInstallPrompt) return;
            _deferredInstallPrompt.prompt();
            await _deferredInstallPrompt.userChoice;
            _deferredInstallPrompt = null;
            installBtn.setAttribute('hidden', '');
        });
    }
    const su = document.getElementById('storage-usage');
    if (su && navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(({ usage }) => {
            if (usage != null) su.textContent = `Offline storage used: ${(usage / 1048576).toFixed(1)} MB`;
        }).catch(() => {});
    }

    // Add bookmark button
    document.getElementById('add-bookmark-btn').addEventListener('click', () => {
        const currentSurah = findCurrentSurah(state.currentPage);
        const defaultName = currentSurah
            ? `${currentSurah.name} - p.${state.currentPage}`
            : `Page ${state.currentPage}`;
        const name = prompt('Bookmark name:', defaultName);
        if (name !== null && name.trim() !== '') {
            addBookmark(name.trim(), state.currentPage);
        }
    });

    // Backup export / import
    const ioMsg = document.getElementById('data-io-msg');
    document.getElementById('data-export-btn').addEventListener('click', () => {
        exportData();
        if (ioMsg) { ioMsg.style.color = '#888'; ioMsg.textContent = 'Exported quran-backup.json'; }
    });
    const importFile = document.getElementById('data-import-file');
    document.getElementById('data-import-btn').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => importData(String(reader.result), ioMsg);
        reader.readAsText(f);
        e.target.value = '';
    });

    // Menu close button (inside panel)
    document.getElementById('menu-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
    });

    // Menu button
    dom.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.isMenuOpen) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    // Backdrop tap closes menu
    dom.menuOverlay.addEventListener('click', (e) => {
        if (e.target === dom.menuOverlay) {
            closeMenu();
        }
    });

    // Prevent clicks inside panel from closing
    dom.menuPanel.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Swipe right on menu panel to close (but not when scrolling juz pills or surah list)
    let menuTouchStartX = 0;
    let menuTouchStartY = 0;
    let menuTouchOnScrollable = false;
    dom.menuPanel.addEventListener('touchstart', (e) => {
        menuTouchStartX = e.touches[0].clientX;
        menuTouchStartY = e.touches[0].clientY;
        // Check if touch started on a horizontally scrollable element
        menuTouchOnScrollable = !!e.target.closest('.juz-pills, .surah-list');
    }, { passive: true });
    dom.menuPanel.addEventListener('touchend', (e) => {
        if (menuTouchOnScrollable) return; // Don't close when scrolling pills
        const dx = e.changedTouches[0].clientX - menuTouchStartX;
        const dy = e.changedTouches[0].clientY - menuTouchStartY;
        // Only close if horizontal swipe right and not mostly vertical
        if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 2) closeMenu();
    }, { passive: true });
}

function renderSurahList(container, surahs, query) {
    container.innerHTML = '';
    const filtered = query
        ? surahs.filter(s =>
            s.name.toLowerCase().includes(query) ||
            s.arabicName.includes(query) ||
            String(s.number).includes(query))
        : surahs;

    filtered.forEach(s => {
        const li = document.createElement('li');
        li.className = 'surah-item';
        li.innerHTML = `
            <span class="surah-page" style="font-size:12px;color:#888;flex-shrink:0;min-width:30px;">${s.startPage}</span>
            <span class="surah-name-en">${s.name}</span>
            <span class="surah-name-ar">${s.arabicName}</span>
            <span class="surah-number">${s.number}</span>
        `;
        li.addEventListener('click', () => {
            goToPage(s.startPage);
            closeMenu();
        });
        container.appendChild(li);
    });

    if (filtered.length === 0) {
        container.innerHTML = '<li class="empty-state">No surahs found</li>';
    }
}

function findCurrentSurah(page) {
    if (!state.metadata || !state.metadata.surahs) return null;
    const surahs = state.metadata.surahs;
    let result = surahs[0];
    for (let i = 0; i < surahs.length; i++) {
        if (surahs[i].startPage <= page) {
            result = surahs[i];
        } else {
            break;
        }
    }
    return result;
}

function openMenu() {
    dom.menuOverlay.removeAttribute('hidden');
    state.isMenuOpen = true;
    renderBookmarks();
    // Update juz pill highlights
    updateJuzPillHighlight();
}

function closeMenu() {
    dom.menuOverlay.setAttribute('hidden', '');
    state.isMenuOpen = false;
}

function updateJuzPillHighlight() {
    const currentJuz = findCurrentJuz(state.currentPage);
    const pills = document.querySelectorAll('.juz-pill');
    pills.forEach((pill, i) => {
        pill.classList.toggle('active', currentJuz && currentJuz.number === i + 1);
    });
}

// ============================================================
// Display Modes
// ============================================================
function setTheme(theme) {
    state.theme = theme;
    document.body.setAttribute('data-theme', theme);
    // Update theme-color meta tag
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        const colors = { dark: '#1a1a1a', sepia: '#f4ecd8', light: '#ffffff' };
        metaThemeColor.setAttribute('content', colors[theme] || '#ffffff');
    }
    const sel = document.getElementById('theme-select');
    if (sel) sel.value = theme;
    saveState();
}

function setupBrightness() {
    // Create brightness overlay if not already in DOM
    _brightnessOverlay = document.getElementById('brightness-overlay');
    if (!_brightnessOverlay) {
        _brightnessOverlay = document.createElement('div');
        _brightnessOverlay.id = 'brightness-overlay';
        document.body.appendChild(_brightnessOverlay);
    }
    applyBrightness();
}

function applyBrightness() {
    if (_brightnessOverlay) {
        _brightnessOverlay.style.opacity = 1 - state.brightness;
    }
}

function setupDualPage() {
    _dualPageMediaQuery = window.matchMedia('(orientation: landscape)');
    _dualPageMediaQuery.addEventListener('change', updateDualPageMode);
    window.addEventListener('resize', () => {
        updateDualPageMode();
        // Re-position markers + ayah highlight + hifz covers on resize
        renderMarkers(state.currentPage);
        repositionHighlight();
        renderHifzCovers();
    });
    updateDualPageMode();
}

function updateDualPageMode() {
    const isLandscape = _dualPageMediaQuery ? _dualPageMediaQuery.matches : false;
    let shouldDual = false;

    if (state.dualPage === 'auto') {
        shouldDual = isLandscape;
    } else if (state.dualPage === 'on') {
        shouldDual = true;
    } else {
        shouldDual = false;
    }

    if (shouldDual !== _isDualActive) {
        _isDualActive = shouldDual;
        if (shouldDual) {
            document.body.classList.add('dual-page');
            dom.pageImg2.removeAttribute('hidden');
        } else {
            document.body.classList.remove('dual-page');
            dom.pageImg2.setAttribute('hidden', '');
        }
        // Re-render to load second page
        renderPage(state.currentPage);
    }
}

// ============================================================
// Bookmarks
// ============================================================
function addBookmark(name, page) {
    state.bookmarks.push({ name, page });
    saveState();
    renderBookmarks();
}

function deleteBookmark(index) {
    state.bookmarks.splice(index, 1);
    saveState();
    renderBookmarks();
}

// ------------------------------------------------------------
// Backup: export / import (bookmarks + markers + progress), with merge
// ------------------------------------------------------------
function exportData() {
    const blob = new Blob([JSON.stringify({
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        bookmarks: state.bookmarks,
        markers: state.markers,
        progress: state.progress,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quran-backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importData(text, msgEl) {
    let data;
    try { data = JSON.parse(text); } catch (e) { if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = 'Invalid backup file.'; } return; }
    if (!data || typeof data !== 'object') { if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = 'Unrecognised backup.'; } return; }
    let added = 0;
    // Bookmarks — merge, dedupe by name+page
    if (Array.isArray(data.bookmarks)) {
        const seen = new Set(state.bookmarks.map(b => b.name + '|' + b.page));
        for (const b of data.bookmarks) {
            if (!b || typeof b.page !== 'number') continue;
            const key = (b.name || '') + '|' + b.page;
            if (!seen.has(key)) { state.bookmarks.push({ name: b.name || ('Page ' + b.page), page: b.page }); seen.add(key); added++; }
        }
    }
    // Markers — merge per page, dedupe by x/y/note
    if (data.markers && typeof data.markers === 'object') {
        for (const pg of Object.keys(data.markers)) {
            if (!Array.isArray(data.markers[pg])) continue;
            const cur = state.markers[pg] || (state.markers[pg] = []);
            const seen = new Set(cur.map(m => `${m.x}|${m.y}|${m.note || ''}`));
            for (const m of data.markers[pg]) {
                const k = `${m.x}|${m.y}|${m.note || ''}`;
                if (!seen.has(k)) { cur.push(m); seen.add(k); added++; }
            }
        }
    }
    // Progress — union visited pages, keep max khatm history
    if (data.progress && Array.isArray(data.progress.visited)) {
        const set = new Set(state.progress.visited);
        for (const p of data.progress.visited) if (Number.isInteger(p)) set.add(p);
        state.progress.visited = [...set].sort((a, b) => a - b);
        _visitedSet = new Set(state.progress.visited);
        if (Array.isArray(data.progress.khatms) && data.progress.khatms.length > (state.progress.khatms || []).length) {
            state.progress.khatms = data.progress.khatms;
        }
    }
    saveState();
    renderBookmarks();
    updateProgressUI();
    if (msgEl) { msgEl.style.color = '#1a6b4a'; msgEl.textContent = `Imported — ${added} new item${added === 1 ? '' : 's'} merged.`; }
}

function renderBookmarks() {
    const list = document.getElementById('bookmark-list');
    if (!list) return;
    list.innerHTML = '';

    if (state.bookmarks.length === 0) {
        list.innerHTML = '<li class="empty-state">No bookmarks yet</li>';
        return;
    }

    state.bookmarks.forEach((bm, i) => {
        const li = document.createElement('li');
        li.className = 'bookmark-item';
        li.innerHTML = `
            <div class="bookmark-info">
                <div class="bookmark-name">${bm.name}</div>
                <div class="bookmark-page">Page ${bm.page}</div>
            </div>
            <button class="bookmark-delete" data-index="${i}">&times;</button>
        `;
        // Tap on info to go to page
        li.querySelector('.bookmark-info').addEventListener('click', () => {
            goToPage(bm.page);
            closeMenu();
        });
        // Delete button
        li.querySelector('.bookmark-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteBookmark(i);
        });
        list.appendChild(li);
    });
}

// ============================================================
// Markers
// ============================================================
function setupMarkers() {
    // Long-press detection on page container
    let longPressTimer = null;
    let startX = 0, startY = 0;
    let moved = false;

    dom.reader.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        // Don't trigger on UI elements (menu btn, tap zones, markers)
        const target = e.target;
        if (target.closest('#menu-btn, #menu-overlay, #marker-dialog, .marker')) return;

        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        moved = false;

        longPressTimer = setTimeout(() => {
            if (moved) return;
            // Calculate position relative to the page image
            const imgRect = dom.pageImg.getBoundingClientRect();
            const x = ((startX - imgRect.left) / imgRect.width) * 100;
            const y = ((startY - imgRect.top) / imgRect.height) * 100;

            // Only if inside the image bounds
            if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
                navigator.vibrate?.(30);
                openMarkerDialog(null, x, y);
            }
        }, LONG_PRESS_MS);
    }, { passive: true });

    dom.reader.addEventListener('touchmove', (e) => {
        if (!longPressTimer) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
            moved = true;
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: true });

    dom.reader.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }, { passive: true });

    // Marker taps (existing markers)
    dom.markersLayer.addEventListener('click', (e) => {
        const markerEl = e.target.closest('.marker');
        if (!markerEl) return;
        e.stopPropagation();
        const page = parseInt(markerEl.dataset.page, 10);
        const index = parseInt(markerEl.dataset.index, 10);
        const marker = state.markers[page]?.[index];
        if (marker) {
            openMarkerDialog({ page, index }, marker.x, marker.y, marker.note);
        }
    });

    // Dialog buttons
    dom.markerSave.addEventListener('click', () => {
        const note = dom.markerNote.value.trim();
        if (_editingMarker && _editingMarker.index !== null && _editingMarker.index !== undefined && _editingMarker.existing) {
            // Editing existing marker
            state.markers[_editingMarker.page][_editingMarker.index].note = note;
        } else if (_editingMarker) {
            // New marker
            const page = _editingMarker.page;
            if (!state.markers[page]) state.markers[page] = [];
            state.markers[page].push({ x: _editingMarker.x, y: _editingMarker.y, note });
        }
        saveState();
        renderMarkers(state.currentPage);
        closeMarkerDialog();
    });

    dom.markerDelete.addEventListener('click', () => {
        if (_editingMarker && _editingMarker.existing) {
            const page = _editingMarker.page;
            state.markers[page].splice(_editingMarker.index, 1);
            if (state.markers[page].length === 0) delete state.markers[page];
            saveState();
            renderMarkers(state.currentPage);
        }
        closeMarkerDialog();
    });

    dom.markerCancel.addEventListener('click', () => {
        closeMarkerDialog();
    });
}

function openMarkerDialog(existing, x, y, note) {
    if (existing) {
        _editingMarker = { page: existing.page, index: existing.index, x, y, existing: true };
        dom.markerNote.value = note || '';
        dom.markerDelete.style.display = '';
    } else {
        _editingMarker = { page: state.currentPage, index: null, x, y, existing: false };
        dom.markerNote.value = '';
        dom.markerDelete.style.display = 'none';
    }
    dom.markerDialog.removeAttribute('hidden');
    dom.markerNote.focus();
}

function closeMarkerDialog() {
    dom.markerDialog.setAttribute('hidden', '');
    _editingMarker = null;
    dom.markerNote.value = '';
}

// ============================================================
// Wake Lock
// ============================================================
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            _wakeLock = await navigator.wakeLock.request('screen');
            _wakeLock.addEventListener('release', () => { _wakeLock = null; });
        } catch (e) {
            // User denied or not supported
        }
    }
}

async function releaseWakeLock() {
    if (_wakeLock) {
        await _wakeLock.release();
        _wakeLock = null;
    }
}

function setupWakeLock() {
    if (state.keepAwake) {
        requestWakeLock();
    }

    // Re-acquire on visibility change (iOS releases when backgrounded)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state.keepAwake) {
            requestWakeLock();
        }
    });
}

// ============================================================
// Service Worker
// ============================================================
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        // Auto-update: when a new service worker takes control, reload once so the
        // latest app.js / metadata.json / styles are picked up without a manual cache
        // clear. The reader restores its current page from saved state, so the reload
        // is seamless. Skip the reload on first-ever install (no prior controller).
        const hadController = !!navigator.serviceWorker.controller;
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing || !hadController) return;
            refreshing = true;
            window.location.reload();
        });

        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('SW registered:', reg.scope);
                // Proactively check for a new version: now, hourly, and whenever the
                // app is brought back to the foreground (key for installed PWAs).
                reg.update();
                setInterval(() => reg.update(), 60 * 60 * 1000);
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') reg.update();
                });
            })
            .catch(err => {
                console.warn('SW registration failed:', err);
            });

        // Listen for download progress messages from SW
        navigator.serviceWorker.addEventListener('message', (e) => {
            if (e.data.type === 'downloadProgress') {
                updateDownloadProgress(e.data.downloaded, e.data.total);
            } else if (e.data.type === 'downloadComplete') {
                updateDownloadComplete(e.data.downloaded, e.data.total, e.data.errors);
            }
        });
    }
}

function startDownloadAll() {
    if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'downloadAll',
            totalPages: state.totalPages,
            tier: 'high'
        });
        // Update button to show progress
        const btn = document.getElementById('download-all-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Downloading... 0%';
        }
    }
}

function updateDownloadProgress(downloaded, total) {
    const pct = Math.round((downloaded / total) * 100);
    const btn = document.getElementById('download-all-btn');
    if (btn) {
        btn.textContent = `Downloading... ${pct}% (${downloaded}/${total})`;
    }
}

function updateDownloadComplete(downloaded, total, errors) {
    const btn = document.getElementById('download-all-btn');
    if (btn) {
        btn.disabled = false;
        if (errors > 0) {
            btn.textContent = `Done (${errors} errors). Tap to retry.`;
        } else {
            btn.textContent = '\u2713 All pages downloaded for offline';
        }
    }
}

// ============================================================
// Boot
// ============================================================
document.addEventListener('DOMContentLoaded', init);
