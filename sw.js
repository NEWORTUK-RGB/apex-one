/* APEX ONE service worker — offline app shell, cache-first with network refresh */
'use strict';
const VERSION = 'apexone-fe2efeaf-v2.0.1';
const SHELL = [
  '/',
  '/index.html',
  '/robots.txt',
  '/manifest.webmanifest',
  /* Source files (CSS + JS extracted from monolith) */
  '/src/css/main.css',
  '/src/js/main.js',
  /* PWA icons */
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  /* Self-hosted fonts — cached for full offline use */
  '/fonts/inter-latin.woff2',
  '/fonts/inter-latin-ext.woff2',
  '/fonts/jetbrains-mono-latin.woff2',
  '/fonts/jetbrains-mono-latin-ext.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Only handle GET requests from our own origin
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Navigations: network-first (fresh app), fall back to cached shell offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/index.html', copy));
        }
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets (fonts, icons, manifest): cache-first.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
