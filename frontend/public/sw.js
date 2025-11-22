/**
 * Service Worker for Offline-First Architecture
 *
 * Handles:
 * - Background sync for screenshot uploads
 * - Offline caching of static assets
 * - Push notifications (future)
 */

const CACHE_NAME = 'qontinui-v1';
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

          // Return offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/offline.html');
          }

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
});

console.log('[ServiceWorker] Loaded');
