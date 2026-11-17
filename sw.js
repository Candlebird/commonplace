// Lets the installed app open offline and appear in the phone's share sheet. Notes themselves sync through Firestore's own cache.
const CACHE = 'commonplace-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The page: always try for the newest, fall back to the saved copy offline (shared links arrive with ?text=…).
  if (req.mode === 'navigate' && url.pathname.startsWith(SCOPE)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Icons and the versioned Firebase SDK: from the cache, filled on first use.
  const ours = url.origin === location.origin && url.pathname.startsWith(SCOPE);
  if (ours || url.href.startsWith('https://www.gstatic.com/firebasejs/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
