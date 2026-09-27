// Keep this namespace private to this PWA. Never delete caches belonging to
// another application sharing the origin.
const CACHE_NAME = 'mbs-crm-v1';
const CACHE_PREFIX = 'mbs-crm-';
const OFFLINE_URL = './offline.html';
const SHELL_URL = new URL('./index.html', self.location.href).href;

function unavailableResponse() {
  return new Response('This resource is unavailable while offline.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function isMainBundle(url) {
  return url.pathname.split('/').pop().startsWith('index-') ||
    url.pathname.split('/').pop().startsWith('main-') ||
    /\/(index|main)\.(js|css)$/.test(url.pathname);
}

function isHashedAsset(url) {
  const filename = url.pathname.split('/').pop();
  return url.pathname.includes('/assets/') &&
    !isMainBundle(url) &&
    /-[A-Za-z0-9_-]{8,}\.[^./]+$/.test(filename);
}

function isHtmlAssetResponse(url, response) {
  return /\.(js|css)$/i.test(url.pathname) &&
    /^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/i.test(
      response.headers.get('content-type') || ''
    );
}

async function cachedFallback(request) {
  try {
    const exact = await caches.match(request);
    if (exact) return exact;
  } catch (_) {
    // Cache Storage may be unavailable; still return a valid Response.
  }
  return unavailableResponse();
}

async function navigationFallback(request) {
  try {
    const exact = await caches.match(request);
    if (exact) return exact;
    const shell = await caches.match(SHELL_URL);
    if (shell) return shell;
    const offline = await caches.match(new Request(OFFLINE_URL));
    if (offline) return offline;
  } catch (_) {
    // Cache Storage may be unavailable; still return a valid Response.
  }
  return unavailableResponse();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use new Request to ensure it resolves relative to sw.js location
      return cache.addAll([
        new Request(OFFLINE_URL, { cache: 'reload' })
      ]);
    })
  );
  // Do NOT skipWaiting automatically; wait for user to click reload toast
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Network-first for API
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    // API responses must never be served from Cache Storage. In particular,
    // an offline shell must not turn stale authenticated data into a response.
    event.respondWith(fetch(event.request).catch(() => unavailableResponse()));
    return;
  }

  // Immutable, fingerprinted assets are safe to serve cache-first.
  if (isSameOrigin && isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        try {
          const cached = await caches.match(event.request);
          if (cached) {
            if (!isHtmlAssetResponse(url, cached)) return cached;
            try {
              const cache = await caches.open(CACHE_NAME);
              await cache.delete(event.request);
            } catch (_) {
              // The invalid entry is rejected even if Cache Storage cannot purge it.
            }
            return unavailableResponse();
          }
          const response = await fetch(event.request);
          if (response && isHtmlAssetResponse(url, response)) return unavailableResponse();
          if (response && response.ok) {
            try {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(event.request, response.clone());
            } catch (_) {
              // A successful network response remains usable if caching fails.
            }
          }
          return response || unavailableResponse();
        } catch (_) {
          return cachedFallback(event.request);
        }
      })()
    );
    return;
  }

  // Navigations and the app entry bundle must bypass the browser HTTP cache.
  // Store successful responses in Cache Storage for explicit offline fallback.
  if (isSameOrigin && (event.request.mode === 'navigate' || isMainBundle(url) ||
      url.pathname === '/index.html' || url.pathname === '/')) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request, { cache: 'no-store' });
          if (response && response.ok) {
            try {
              const cache = await caches.open(CACHE_NAME);
              if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
                await cache.put(SHELL_URL, response.clone());
              }
              if (isMainBundle(url)) await cache.put(event.request, response.clone());
            } catch (_) {
              // A successful network response remains usable if caching fails.
            }
          }
          return response || unavailableResponse();
        } catch (_) {
          return event.request.mode === 'navigate'
            ? navigationFallback(event.request)
            : cachedFallback(event.request);
        }
      })()
    );
    return;
  }

  // Network-first for all other requests. Never leave respondWith rejecting:
  // cache any exact offline copy, then serve an explicit unavailable response.
  event.respondWith(
    fetch(event.request).catch(() => cachedFallback(event.request))
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const data = payload.data || {};
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon-192x192.png',
    tag: payload.tag || data.tag || 'crm-notification',
    data: { ...data, url: payload.url || data.url || self.registration.scope },
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'MBS CRM', options));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) 
    ? event.notification.data.url 
    : self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const existing = windowClients.find((client) => client.url.includes(urlToOpen) && 'focus' in client);
      if (existing) {
        return existing.focus();
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});