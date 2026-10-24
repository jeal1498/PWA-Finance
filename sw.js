// Service worker: Finanzas funciona offline. Sube CACHE en cada cambio o el teléfono no se actualiza.
const CACHE = 'finanzas-v3';
const ASSETS = [
  './',
  'index.html',
  'app.js',
  'datos.js',
  'sync.js',
  'styles.css',
  'favicon.svg',
  'manifest.webmanifest',
  'js/db.js',
  'js/backup.js',
  'js/migrar-finanzas.js',
  'js/finance.js',
  'fonts/bricolage-latin.woff2',
  'fonts/plex-sans-latin.woff2',
  'fonts/plex-mono-600-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('finanzas-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate: responde de caché al instante y actualiza en segundo plano.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached || (req.mode === 'navigate' ? cache.match('index.html') : undefined));
      return cached || network;
    }),
  );
});
