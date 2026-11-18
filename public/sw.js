// Lets the installed app open offline, appear in the share sheet, and open a note from a reminder.
// Notes themselves sync through the database's own offline cache.
const CACHE = 'commonplace-v2';
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = ['./', 'icon.svg', 'icon-192.png'];

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

const put = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin && url.pathname.startsWith(SCOPE);

  // The page (shared links arrive with ?title=…&text=…): newest when online, saved copy offline.
  if (req.mode === 'navigate' && ours) {
    e.respondWith(fetch(req).then((res) => put('./', res)).catch(() => caches.match('./')));
    return;
  }
  // Built files have the content hash in their name, so a saved copy is always right.
  if ((ours && /\/assets\/|\.(png|svg)$/.test(url.pathname)) || url.href.startsWith('https://cdn.jsdelivr.net/npm/tesseract')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
  }
});

// Tapping a reminder opens its note.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  const target = new URL(self.registration.scope + (id ? `#note/${id}` : '')).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (w) return w.navigate(target).then((c) => (c || w).focus()).catch(() => w.focus());
    return self.clients.openWindow(target);
  }));
});
