/* Service Worker: macht die App voll offline-fähig (Cache-First für die App-Dateien).
 * WICHTIG: Wenn du Dateien änderst, erhöhe CACHE_VERSION, damit Handys die neue Version laden. */
const CACHE_VERSION = 'lernapp-v1.0.0';

const APP_SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css',
  'js/app.js', 'js/util.js', 'js/db.js', 'js/store.js', 'js/srs.js', 'js/importer.js',
  'js/speech.js', 'js/score.js', 'js/ai-hook.js',
  'js/views/filters.js', 'js/views/learn.js', 'js/views/audio.js', 'js/views/exam.js',
  'js/views/stats.js', 'js/views/content.js', 'js/views/settings.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'data/schema.json', 'data/beispiel-inhalte.json',
  'data/vorlage-quiz.csv', 'data/vorlage-pruefung.csv', 'data/ki-prompt.txt'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
