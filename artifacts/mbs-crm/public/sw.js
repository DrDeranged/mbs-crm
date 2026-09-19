// Keep this namespace private to this PWA. Never delete caches belonging to
// another application sharing the origin.
// Keep this value in sync with the version in use-pwa.tsx. It is deliberately
// in the script URL so stale workers can be identified and removed.
const SERVICE_WORKER_VERSION = 'mbs-crm-sw-v3';
const CACHE_NAME = `mbs-crm-${SERVICE_WORKER_VERSION}`;
const CACHE_ALLOWLIST = new Set([CACHE_NAME]);
const OFFLINE_URL = './offline.html';

function isClerkRequest(url) {
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return hostname === 'accounts.dev' ||
    hostname.endsWith('.accounts.dev') ||
    hostname.includes('clerk') ||
    pathname.includes('__clerk') ||
    /(^|\/)clerk(\/|$)/.test(pathname) ||
    pathname.includes('/npm/@clerk') ||
    pathname.includes('/@clerk/');
}

function responseOrError(value) {
  return value instanceof Response ? value : Response.error();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => {
        // Use new Request to ensure it resolves relative to sw.js location
        return cache.addAll([
          new Request(OFFLINE_URL, { cache: 'reload' })
        ]);
      }),
      self.skipWaiting(),
    ])
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !CACHE_ALLOWLIST.has(name))
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Never intercept Clerk or API traffic. This is important for authenticated
  // requests: allowing these through preserves Clerk's cookies and headers.
  if (isClerkRequest(url) || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Cache-first for hashed assets from Vite
  if (isSameOrigin && url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          response = responseOrError(response);
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => Response.error());
      })
    );
    return;
  }

  // Navigate requests: network-first, fallback to offline.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => responseOrError(response)).catch(() => {
        return caches.match(new Request(OFFLINE_URL)).then((cached) => responseOrError(cached));
      })
    );
    return;
  }

  // Network-first default
  event.respondWith(
    fetch(event.request)
      .then((response) => responseOrError(response))
      .catch(() => caches.match(event.request).then((cached) => responseOrError(cached)))
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