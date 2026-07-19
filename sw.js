// sw.js — オフライン対応 (HTTPSで配信されたときのみ登録される)
const CACHE = 'jun-mahjong-v2';
const ASSETS = [
  '.', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/ui/main.js',
  'js/engine/rules.js', 'js/engine/tiles.js', 'js/engine/wall.js',
  'js/engine/agari.js', 'js/engine/shanten.js', 'js/engine/yaku.js',
  'js/engine/score.js', 'js/engine/game.js', 'js/engine/ai.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }))
  );
});
