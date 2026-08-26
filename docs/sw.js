const CACHE = 'aeol-b-v73';
const CORE = ['./', 'index.html', 'styles.css?v=72', 'app.js?v=73', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE).catch(() => {}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isImage = sameOrigin && url.pathname.includes('/images/');

  if (isImage) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}));
        }
        return response;
      } catch (error) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Network-first for HTML/JS/JSON so a stale PWA cannot trap an old release.
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && sameOrigin) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}));
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return new Response('Sin conexion', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
