/**
 * sw.js - Service Worker for MAPS GIS PWA
 *
 * Implements a cache-first strategy for app assets to enable
 * fully offline operation after the first load.
 */

// ============================================
// VERSION CONTROL - BUMP THIS TO FORCE UPDATE
// ============================================
const APP_VERSION = '2.4.0'; // Bump to force cache refresh on all devices

const CACHE_NAME = 'maps-gis-v' + APP_VERSION;
const STATIC_CACHE = 'maps-gis-static-v' + APP_VERSION;
const DYNAMIC_CACHE = 'maps-gis-dynamic-v' + APP_VERSION;

// Core app assets to cache immediately
const CORE_ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=2.4.0',
  './js/app.js?v=2.4.0',
  './js/storage.js?v=2.4.0',
  './js/pdf-processor.js?v=2.4.0',
  './js/sync-manager.js?v=2.4.0',
  './js/admin-manager.js?v=2.4.0',
  './manifest.json',
  './assets/logo_lab_chino_PNG.png?v=2.4.0'
];

// CDN resources to cache (external dependencies)
const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/proj4@2.9.2/dist/proj4.js',
  'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.min.js',
  'https://cdn.jsdelivr.net/npm/georaster@1.6.0/dist/georaster.browser.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/georaster-layer-for-leaflet@3.10.0/dist/georaster-layer-for-leaflet.min.js',
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
  'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/piexif.min.js'
];

// Tile URL patterns to handle separately (stale-while-revalidate for speed)
const TILE_PATTERNS = [
  'basemaps.cartocdn.com',
  'tile.openstreetmap.org'
];

// Never cache these domains (APIs must always be fresh)
const NETWORK_ONLY_DOMAINS = [
  'supabase.co'
];

// ============================================
// INSTALL - Cache core assets
// ============================================

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching core assets');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Caching CDN assets');
        return caches.open(DYNAMIC_CACHE);
      })
      .then((cache) => {
        return cache.addAll(CDN_ASSETS);
      })
      .then(() => {
        console.log('[SW] All assets cached');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Cache installation failed:', err);
      })
  );
});

// ============================================
// ACTIVATE - Clean old caches
// ============================================

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            return name !== STATIC_CACHE && name !== DYNAMIC_CACHE;
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// ============================================
// FETCH - Cache-first strategy
// ============================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // Network-only for APIs (never cache Supabase or other APIs)
  if (NETWORK_ONLY_DOMAINS.some(pattern => url.hostname.includes(pattern))) {
    event.respondWith(fetch(request));
    return;
  }

  // For tile servers: stale-while-revalidate (fast cached load, background refresh)
  if (TILE_PATTERNS.some(pattern => url.hostname.includes(pattern))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // For CDN assets: cache-first
  if (url.hostname === 'unpkg.com') {
    event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
    return;
  }

  // For app assets: cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ============================================
// HELPERS
// ============================================

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(request, { signal: controller.signal })
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

// ============================================
// STRATEGY: Cache First
// ============================================

async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetchWithTimeout(request, 6000);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache-first failed:', error);
    return new Response('Offline - Resource not cached', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

// ============================================
// STRATEGY: Stale-While-Revalidate (tiles)
// Serve cached tile immediately, then refresh in background.
// This keeps the map fast even on slow/spotty connections.
// ============================================

async function staleWhileRevalidate(request) {
  const cachedResponse = await caches.match(request);

  const networkFetch = fetchWithTimeout(request, 1500)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        const cache = caches.open(DYNAMIC_CACHE);
        cache.then((c) => c.put(request, networkResponse.clone()));
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await networkFetch;
    if (networkResponse) {
      return networkResponse;
    }
  } catch (error) {
    console.error('[SW] Stale-while-revalidate failed:', error);
  }

  // Return a transparent 1x1 pixel for failed tile requests
  return new Response('', {
    status: 204,
    statusText: 'No Content'
  });
}

// ============================================
// MESSAGE HANDLER - Manual cache update
// ============================================

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'UPDATE_CACHE') {
    caches.open(STATIC_CACHE).then((cache) => {
      cache.addAll(CORE_ASSETS);
    });
  }
});
