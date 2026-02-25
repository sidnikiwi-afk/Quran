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
    medImg.src = getImageUrl(page, 'high');
    medImg.onload = () => {
        // Only swap if we're still on this page
        if (state.currentPage === page) {
            dom.pageImg.src = medImg.src;
            dom.pageImg.style.filter = '';
            dom.pageImg.style.transform = '';
            // Re-position markers now that image has final dimensions
            requestAnimationFrame(() => renderMarkers(page));
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

    // 6. Update juz tab
    showJuzTab(page);

    // 7. Preload adjacent pages
    preloadAdjacent(page);

    // 8. Save state
    saveState();

    // 9. Render markers for this page
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
        // Already using high-res by default
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

            // Already using high-res by default
            if (currentScale <= 1.05) {
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

        <!-- Settings -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="settings-content">Settings <span class="collapse-arrow">&#9660;</span></div>
            <div id="settings-content" class="collapsible-content">

            <div class="setting-row">
                <span class="setting-label">Dark Mode</span>
                <label class="toggle">
                    <input type="checkbox" id="theme-toggle" ${state.theme === 'dark' ? 'checked' : ''}>
                    <span class="toggle-track"></span>
                </label>
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
            </div>
        </div>

        <!-- Offline -->
        <div class="menu-section">
            <div class="menu-section-title collapsible" data-target="offline-content">Offline <span class="collapse-arrow">&#9660;</span></div>
            <div id="offline-content" class="collapsible-content">
                <button id="download-all-btn"
                    style="width:100%;padding:12px;border:none;border-radius:var(--btn-radius);background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Download All Pages</button>
                <div id="download-progress" style="display:none;margin-top:8px;text-align:center;font-size:13px;color:#888;"></div>
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

    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('change', (e) => {
        setTheme(e.target.checked ? 'dark' : 'light');
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

    // Swipe right on menu panel to close (RTL-friendly dismiss)
    let menuTouchStartX = 0;
    dom.menuPanel.addEventListener('touchstart', (e) => {
        menuTouchStartX = e.touches[0].clientX;
    }, { passive: true });
    dom.menuPanel.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - menuTouchStartX;
        if (dx > 80) closeMenu(); // Swipe right > 80px = close
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
        metaThemeColor.setAttribute('content', theme === 'dark' ? '#1a1a1a' : '#f5f0e8');
    }
    // Update toggle if it exists
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = (theme === 'dark');
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
        // Re-position markers layer on resize
        renderMarkers(state.currentPage);
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
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('SW registered:', reg.scope);
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
