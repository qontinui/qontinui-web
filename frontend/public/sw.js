/**
 * Service Worker for Offline-First Architecture
 *
 * Handles:
 * - Background sync for screenshot uploads
 * - Offline caching of static assets
 * - Push notifications (future)
 *
 * ## Why hand-rolled, not Workbox
 *
 * This worker is intentionally hand-written rather than generated via
 * Workbox / `next-pwa` / similar. The trade-off was deliberate:
 *
 *   - The SW already does what we need: cache-first for static, network for
 *     /api/*, background-sync for screenshot uploads, BUILD_ID_CHANGED for
 *     coordinated cache invalidation. Workbox's batteries (precache
 *     manifests, runtime route strategies) are overkill for that scope.
 *   - `next-pwa` lags Next.js majors (we're on Next 15 App Router). Tying
 *     SW correctness to a third-party plugin's release cadence is the kind
 *     of yak-shave we wanted to avoid.
 *   - Workbox would be ~40 KB minified inside the SW bundle. The SW runs
 *     before any page paints and we'd rather keep it small.
 *
 * Re-evaluate the call if this file grows past ~300 LOC, or if we need
 * advanced strategies (e.g. NetworkFirst-with-timeout per route, or a
 * precache manifest that survives version bumps without re-downloading
 * unchanged assets). Until then, build-id-keyed cache names + the
 * BUILD_ID_CHANGED message handler give us coordinated invalidation
 * without the dependency.
 */

// CACHE_VERSION is replaced at build time by scripts/inject-build-id.mjs
// (post-build pass). The unsubstituted token is the development default —
// it stays stable across `next dev` reloads and only changes after a real
// production build runs. The src file under public/ is the template; only
// the copy in .next/standalone/public/ gets the real id.
const CACHE_VERSION = '__BUILD_ID__';
const CACHE_NAME = 'qontinui-' + CACHE_VERSION;
const CACHE_PREFIX = 'qontinui-';
const SYNC_TAG = 'sync-screenshots';

// Assets to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/offline.html', // Fallback offline page
];

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((error) => {
        // Don't fail installation if caching fails
        console.warn('[ServiceWorker] Failed to cache some assets:', error);
      });
    })
  );

  // Activate immediately
  self.skipWaiting();
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => {
            console.log('[ServiceWorker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
  );

  // Take control of all pages immediately
  return self.clients.claim();
});

/**
 * Background sync event - process sync queue
 */
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Sync event:', event.tag);

  if (event.tag === SYNC_TAG) {
    event.waitUntil(
      processSyncQueue()
        .then(() => {
          console.log('[ServiceWorker] Sync completed successfully');
        })
        .catch((error) => {
          console.error('[ServiceWorker] Sync failed:', error);
          // Throwing error will cause browser to retry
          throw error;
        })
    );
  }
});

/**
 * Process the sync queue
 *
 * Note: We can't directly import ES modules in service worker,
 * so we use postMessage to communicate with the main thread.
 */
async function processSyncQueue() {
  // Get all clients (tabs)
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  if (clients.length === 0) {
    console.log('[ServiceWorker] No clients available, deferring sync');
    throw new Error('No clients available');
  }

  // Send message to first client to process sync queue
  const client = clients[0];

  return new Promise((resolve, reject) => {
    // Create message channel for response
    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      if (event.data.success) {
        resolve(event.data);
      } else {
        reject(new Error(event.data.error || 'Sync failed'));
      }
    };

    // Send sync request
    client.postMessage(
      {
        type: 'BACKGROUND_SYNC',
        tag: SYNC_TAG,
      },
      [messageChannel.port2]
    );

    // Timeout after 5 minutes
    setTimeout(() => {
      reject(new Error('Sync timeout'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Fetch event - network-first strategy
 *
 * For API requests: always try network first, don't cache
 * For static assets: cache-first with network fallback
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip API requests (always use network)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip Next.js build output. Chunks under /_next/static/* are content-hashed
  // in prod (HTTP cache handles them) and rebuild constantly in dev with new
  // module IDs. SW caching them creates the exact mismatch this comment exists
  // to prevent: cached chunk references __webpack_modules__[oldId], the live
  // runtime only has the new ids, Lazy boundaries throw
  // "Cannot read properties of undefined (reading 'call')". Skipping /_next/
  // entirely also covers /_next/data/* RSC payloads and HMR streams.
  if (url.pathname.startsWith('/_next/')) {
    return;
  }

  // Skip WebSocket requests
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached version and update cache in background
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response.ok) {
                return caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, response);
                });
              }
            })
            .catch(() => {
              // Ignore network errors
            })
        );

        return cachedResponse;
      }

      // Not in cache, fetch from network
      return fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }

          return response;
        })
        .catch((error) => {
          console.error('[ServiceWorker] Fetch failed:', error);

          // Only show offline page if truly offline (not just a network error)
          if (request.mode === 'navigate' && !navigator.onLine) {
            return caches.match('/offline.html');
          }

          // For other errors (timeout, server error, etc), let them propagate
          // The app will handle them normally
          throw error;
        });
    })
  );
});

/**
 * Message event - handle messages from main thread
 */
self.addEventListener('message', (event) => {
  console.log('[ServiceWorker] Message received:', event.data);

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CLAIM_CLIENTS') {
    self.clients.claim();
  }

  if (event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(event.data.urls);
      })
    );
  }

  // Build-id changed — call skipWaiting so the *waiting* worker activates
  // immediately. The page routes this message to `registration.waiting`
  // (see notifyBuildIdChange in lib/service-worker.ts), so `self` here is
  // the NEW SW with the NEW CACHE_NAME. Its own `activate` handler then
  // evicts every cache that does not match its CACHE_NAME (i.e. the
  // previous build's caches).
  //
  // Eviction MUST NOT happen here: if this handler runs in the OLD SW
  // (no pending update yet, message routed to controller as fallback),
  // `CACHE_NAME` is the stale id and "delete everything else" would wipe
  // the freshly-staged new cache. skipWaiting() in the old SW is a
  // harmless no-op.
  if (event.data.type === 'BUILD_ID_CHANGED') {
    self.skipWaiting();
  }
});

console.log('[ServiceWorker] Loaded');
