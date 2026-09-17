/* Service worker: cachea la interfaz para que abra al instante.
   Los DATOS nunca se cachean: siempre vienen frescos de la API. */
const CACHE = 'pos-vitys-v5';
const ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Nunca cachear llamadas a la API ni peticiones que no sean GET
  if (e.request.method !== 'GET' || url.indexOf('script.google.com') >= 0) return;

  // Interfaz: primero cache (rapidisimo), y se refresca en segundo plano
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const red = fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return res;
      }).catch(() => hit);
      return hit || red;
    })
  );
});
