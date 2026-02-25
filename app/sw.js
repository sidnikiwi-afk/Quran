const CACHE_NAME = 'quran-v1';
const SHELL_FILES = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './data/metadata.json',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// Install — cache app shell
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_FILES))
            .then(() => self.skipWaiting())
    );
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch — cache-first for images, network-first for app shell
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    if (url.pathname.includes('/images/pages/')) {
        // Cache-first for page images
        e.respondWith(
            caches.match(e.request).then(cached => {
                if (cached) return cached;
                return fetch(e.request).then(resp => {
                    if (resp.ok) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                    }
                    return resp;
                });
            })
        );
    } else {
        // Network-first for app shell (so updates propagate)
        e.respondWith(
            fetch(e.request)
                .then(resp => {
                    if (resp.ok) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                    }
                    return resp;
                })
                .catch(() => caches.match(e.request))
        );
    }
});

// Message handler for "download all pages"
self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'downloadAll') {
        const totalPages = e.data.totalPages || 847;
        const tier = e.data.tier || 'medium';

        downloadAllPages(e.source, totalPages, tier);
    }
});

async function downloadAllPages(client, totalPages, tier) {
    const cache = await caches.open(CACHE_NAME);
    let downloaded = 0;
    let errors = 0;

    // Download in batches of 10 for efficiency
    const batchSize = 10;
    for (let i = 1; i <= totalPages; i += batchSize) {
        const batch = [];
        for (let j = i; j < Math.min(i + batchSize, totalPages + 1); j++) {
            const url = `./images/pages/${tier}/${j}.webp`;
            batch.push(
                cache.match(url).then(existing => {
                    if (existing) {
                        downloaded++;
                        return; // Already cached
                    }
                    return fetch(url).then(resp => {
                        if (resp.ok) {
                            downloaded++;
                            return cache.put(url, resp);
                        } else {
                            errors++;
                        }
                    }).catch(() => { errors++; });
                })
            );
        }
        await Promise.all(batch);

        // Report progress
        client.postMessage({
            type: 'downloadProgress',
            downloaded,
            total: totalPages,
            errors
        });
    }

    client.postMessage({
        type: 'downloadComplete',
        downloaded,
        total: totalPages,
        errors
    });
}
