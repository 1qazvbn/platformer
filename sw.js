importScripts('version.js');

const CACHE = 'platformer-' + self.GAME_VERSION;
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=' + self.GAME_VERSION,
  './game.js?v=' + self.GAME_VERSION,
  './version.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).then(resp => {
      const copy = resp.clone();
      if (resp.ok && event.request.method === 'GET') {
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return resp;
    }).catch(() => caches.match(event.request))
  );
});
