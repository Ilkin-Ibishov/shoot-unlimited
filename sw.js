// Offline support: network first, cache fallback.
const CACHE = 'shoot-unlimited-v10';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'js/data.js', 'js/engine.js', 'js/dsp.js', 'js/audio.js', 'js/audio-worker.js', 'js/platform.js', 'js/debug.js', 'js/game.js', 'js/render.js', 'js/ui.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { // revalidate so updates show up on reload
    if (r.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes('fonts.g'))) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
