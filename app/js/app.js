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
const JUZ_TAB_MS = 3000;
const DEBOUNCE_SAVE_MS = 500;

// ============================================================
// DOM References (populated in init)
// ============================================================
let dom = {};

// ============================================================
// Initialization
// ============================================================
async function init() {
    cacheDom();
    loadState();
    await loadMetadata();
    renderPage(state.currentPage);
    setupNavigation();
    setupMenu();
    setupMarkers();
    setupDualPage();
    setupBrightness();
    setupWakeLock();
    registerServiceWorker();
}

function cacheDom() {
    dom = {
        reader: document.getElementById('reader'),
        pageContainer: document.getElementById('page-container'),
        pageImg: document.getElementById('page-img'),
        pageImg2: document.getElementById('page-img-2'),
        tapLeft: document.getElementById('tap-left'),
        tapRight: document.getElementById('tap-right'),
        pageIndicator: document.getElementById('page-indicator'),
        juzTab: document.getElementById('juz-tab'),
        markersLayer: document.getElementById('markers-layer'),
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
                currentPage: state.currentPage,
                theme: state.theme,
                brightness: state.brightness,
                keepAwake: state.keepAwake,
                dualPage: state.dualPage,
                bookmarks: state.bookmarks,
                markers: state.markers,
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
let _juzTabTimer = null;

function renderPage(page) {
    // 1. Clamp page
    page = Math.max(1, Math.min(page, state.totalPages));
    state.currentPage = page;

    // 2. Load thumbnail as blurred placeholder
    dom.pageImg.style.filter = 'blur(10px)';
    dom.pageImg.style.transform = 'scale(1.05)';
    dom.pageImg.src = getImageUrl(page, 'thumb');

    // 3. Load medium image and swap when ready
    const medImg = new Image();
    medImg.src = getImageUrl(page, 'medium');
    medImg.onload = () => {
        // Only swap if we're still on this page
        if (state.currentPage === page) {
            dom.pageImg.src = medImg.src;
            dom.pageImg.style.filter = '';
            dom.pageImg.style.transform = '';
        }
    };

    // 4. Update page indicator
    showPageIndicator(page);

    // 5. Update juz tab
    showJuzTab(page);

    // 6. Preload adjacent pages
    preloadAdjacent(page);

    // 7. Save state
    saveState();

    // 8. Render markers for this page
    renderMarkers(page);
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

function showJuzTab(page) {
    if (!dom.juzTab) return;
    const juz = findCurrentJuz(page);
    if (!juz) return;
    dom.juzTab.textContent = '\u062c\u0632\u0621 ' + juz.number;
    // Position vertically based on juz number (1-30)
    const pct = ((juz.number - 1) / 29) * 80 + 10; // 10%-90% range
    dom.juzTab.style.top = pct + '%';
    dom.juzTab.classList.add('visible');
    clearTimeout(_juzTabTimer);
    _juzTabTimer = setTimeout(() => {
        dom.juzTab.classList.remove('visible');
    }, JUZ_TAB_MS);
}

function renderMarkers(page) {
    if (!dom.markersLayer) return;
    dom.markersLayer.innerHTML = '';
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
            new Image().src = getImageUrl(page + i, 'medium');
        }
        if (page - i >= 1) {
            new Image().src = getImageUrl(page - i, 'medium');
        }
    }
}

// ============================================================
// Navigation (swipe, tap, zoom)
// ============================================================
function setupNavigation() {
    // --- Swipe detection ---
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    let isSwiping = false;

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
        // Swap back to medium if on high
        const medUrl = getImageUrl(state.currentPage, 'medium');
        if (dom.pageImg.src.includes('/high/')) {
            dom.pageImg.src = medUrl;
        }
    }

    // Touch events on #reader for swipe
    dom.reader.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch start
            isPinching = true;
            isSwiping = false;
            initialPinchDist = getDistance(e.touches[0], e.touches[1]);
            return;
        }
        if (e.touches.length === 1) {
            isPinching = false;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
            isSwiping = false;

            // Pan start when zoomed
            if (currentScale > 1) {
                panStartX = e.touches[0].clientX;
                panStartY = e.touches[0].clientY;
                panStartTransX = translateX;
                panStartTransY = translateY;
            }
        }
    }, { passive: true });

    dom.reader.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && isPinching) {
            // Pinch zoom
            e.preventDefault();
            const newDist = getDistance(e.touches[0], e.touches[1]);
            let scale = (newDist / initialPinchDist) * currentScale;
            scale = Math.max(1, Math.min(scale, 4));
            dom.pageImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            state.zoomLevel = scale;
            return;
        }
        if (e.touches.length === 1) {
            // Pan when zoomed
            if (currentScale > 1) {
                e.preventDefault();
                const dx = e.touches[0].clientX - panStartX;
                const dy = e.touches[0].clientY - panStartY;
                translateX = panStartTransX + dx;
                translateY = panStartTransY + dy;
                applyTransform();
                return;
            }
            // Swipe detection
            const dx = e.touches[0].clientX - touchStartX;
            if (Math.abs(dx) > 10) {
                isSwiping = true;
                e.preventDefault();
            }
        }
    }, { passive: false });

    dom.reader.addEventListener('touchend', (e) => {
        if (isPinching && e.touches.length < 2) {
            // Pinch ended — finalize scale
            const finalScale = state.zoomLevel;
            currentScale = Math.max(1, Math.min(finalScale, 4));
            state.isZoomed = currentScale > 1;

            // Swap to high-res if zoomed enough
            if (currentScale > 1.5) {
                const highUrl = getImageUrl(state.currentPage, 'high');
                if (!dom.pageImg.src.includes('/high/')) {
                    dom.pageImg.src = highUrl;
                }
            } else if (currentScale <= 1.05) {
                resetZoom();
            }
            applyTransform();
            isPinching = false;
            return;
        }

        if (isSwiping) {
            const deltaX = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
                if (deltaX < 0) {
                    // Swipe left = next page (RTL forward)
                    nextPage();
                } else {
                    // Swipe right = previous page (RTL back)
                    prevPage();
                }
            }
            isSwiping = false;
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
    const step = (state.dualPage === 'on') ? 2 : 1;
    if (state.currentPage + step <= state.totalPages) {
        navigator.vibrate?.(10);
        goToPage(state.currentPage + step, 'forward');
    }
}

function prevPage() {
    const step = (state.dualPage === 'on') ? 2 : 1;
    if (state.currentPage - step >= 1) {
        navigator.vibrate?.(10);
        goToPage(state.currentPage - step, 'backward');
    }
}

// ============================================================
// Menu
// ============================================================
function setupMenu() {
    // TODO: Task 7
}

function openMenu() {
    // TODO: Task 7
}

function closeMenu() {
    // TODO: Task 7
}

// ============================================================
// Display Modes
// ============================================================
function setTheme(theme) {
    // TODO: Task 8
}

function setupBrightness() {
    // TODO: Task 8
}

function setupDualPage() {
    // TODO: Task 8
}

// ============================================================
// Bookmarks
// ============================================================
function addBookmark(name, page) {
    // TODO: Task 9
}

function deleteBookmark(index) {
    // TODO: Task 9
}

// ============================================================
// Markers
// ============================================================
function setupMarkers() {
    // TODO: Task 9
}

// ============================================================
// Wake Lock
// ============================================================
function setupWakeLock() {
    // TODO: Task 9
}

// ============================================================
// Service Worker
// ============================================================
function registerServiceWorker() {
    // TODO: Task 10
}

// ============================================================
// Boot
// ============================================================
document.addEventListener('DOMContentLoaded', init);
