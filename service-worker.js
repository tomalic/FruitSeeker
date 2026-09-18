// 🔄 Cambia esta versión en cada despliegue (ej: fecha o número)
const CACHE_VERSION = 'v-2026-09-18-quicksearch-1'; 
const CACHE_NAME = 'fruitseeker' + CACHE_VERSION;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Instalar y cachear assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // Activa el SW inmediatamente
});

// Activar y limpiar versiones antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
  );
  self.clients.claim(); // Controlar clientes inmediatamente
});

// Responder desde caché o red
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((resp) => {
      return resp || fetch(event.request).then((response) => {
        // Guarda copia en caché para la próxima
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, copy).catch(()=>{});
        });
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
