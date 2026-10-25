// Service worker: Finanzas funciona offline. Sube CACHE en cada cambio o el teléfono no se actualiza.
const CACHE = 'finanzas-v17';
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
  'fonts/dmsans.woff2',
  'fonts/jetbrains.woff2',
];

// Las instalaciones y las respuestas piden siempre el archivo fresco al servidor (cache: 'reload' / 'no-cache'),
// porque GitHub Pages guarda 10 min en la caché del navegador y el teléfono se quedaba con la versión vieja.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// Al actualizarse, borra las cachés viejas y recarga solas las pantallas abiertas para mostrar la versión nueva.
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k.startsWith('finanzas-') && k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    if (old.length) for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
  })());
});

// Primero la red (con 4 s de espera); sin internet o muy lenta, responde lo guardado.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (!cached) return net.catch(() => (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
    return Promise.race([net, new Promise((_, no) => setTimeout(no, 4000))]).catch(() => cached);
  })());
});
