/* ============================================================================
 * Personal Life OS – sw.js (Service Worker)
 * ----------------------------------------------------------------------------
 * Po co to jest: dzięki temu aplikacja startuje bez internetu i da się ją
 * zainstalować. Dane (zadania, wydarzenia, fiszki) offline obsługuje Firestore
 * (własny cache w przeglądarce) – ten plik dba tylko o SAM PROGRAM.
 *
 * Strategie:
 *  - własne pliki (index.html, app.js …): „cache-first + odświeżanie w tle”.
 *    Start jest natychmiastowy, a nowa wersja pobiera się po cichu i pojawia
 *    się przy KOLEJNYM otwarciu aplikacji.
 *  - biblioteki z CDN (Tailwind, Firebase SDK, Lucide, fonty): cache-first.
 *  - zapytania do bazy i logowania (googleapis.com): NIGDY nie dotykamy.
 *
 * Po zmianie plików aplikacji zwiększ VERSION poniżej – wtedy stary cache
 * zostanie usunięty.
 * ========================================================================== */

const VERSION = 'v1.2.0';
const SHELL_CACHE = `lifeos-shell-${VERSION}`;
const RUNTIME_CACHE = `lifeos-runtime-${VERSION}`;

// Ścieżki WZGLĘDNE (./…) – dzięki temu działa też na GitHub Pages (/nazwa-repo/).
const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './logic.js',
  './firebase-config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com',
]);

/** Czy to zasób z CDN, który wolno trzymać w cache? */
function isCacheableCrossOrigin(url) {
  if (!CDN_HOSTS.has(url.hostname)) return false;
  // www.gstatic.com hostuje też inne rzeczy – bierzemy tylko SDK Firebase.
  if (url.hostname === 'www.gstatic.com') return url.pathname.startsWith('/firebasejs/');
  return true;
}

// ------------------------------------------------------------ INSTALACJA ----
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Każdy plik osobno: brak jednego (np. ikony) nie przerywa instalacji.
    await Promise.all(SHELL_FILES.map(async (file) => {
      try {
        const res = await fetch(new Request(file, { cache: 'reload' }));
        if (res.ok) await cache.put(file, res);
        else console.warn('[SW] pominięto (HTTP ' + res.status + '):', file);
      } catch (err) {
        console.warn('[SW] nie udało się zapisać:', file, err);
      }
    }));
    await self.skipWaiting();
  })());
});

// ------------------------------------------------------------ AKTYWACJA -----
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('lifeos-') && !keep.has(n))
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// ---------------------------------------------------------- STRATEGIE -------
async function cacheFirstWithRefresh(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);   // odśwież w tle, ale odpowiedz od razu z cache
    return cached;
  }
  const res = await refresh;
  return res || new Response('Brak połączenia i brak zapisanej kopii.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    // res.type === 'opaque' to odpowiedź no-cors (np. <script src> z CDN) – też ją zapisujemy.
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// ------------------------------------------------------------- FETCH --------
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Wejście na stronę (adres aplikacji) → zawsze index.html z cache.
    if (request.mode === 'navigate') {
      event.respondWith(cacheFirstWithRefresh(event, new Request('./index.html'), SHELL_CACHE));
      return;
    }
    event.respondWith(cacheFirstWithRefresh(event, request, SHELL_CACHE));
    return;
  }

  if (isCacheableCrossOrigin(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
  // Wszystko inne (Firestore, logowanie…) przechodzi bez zmian.
});

// --------------------------------------------------------- WIADOMOŚCI -------
// Strona wysyła listę zasobów, które właśnie załadowała. Dzięki temu nawet
// przy pierwszej wizycie (zanim SW przejął kontrolę) biblioteki z CDN trafiają
// do cache, a aplikacja działa offline już po pierwszym uruchomieniu.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      await Promise.all(event.data.urls.map(async (raw) => {
        try {
          const url = new URL(raw);
          if (!isCacheableCrossOrigin(url)) return;
          if (await cache.match(raw)) return;
          let res;
          try { res = await fetch(raw); } catch (e) { res = await fetch(raw, { mode: 'no-cors' }); }
          if (res && (res.ok || res.type === 'opaque')) await cache.put(raw, res);
        } catch (err) { /* pojedynczy zasób – ignorujemy */ }
      }));
    })());
  }
});
