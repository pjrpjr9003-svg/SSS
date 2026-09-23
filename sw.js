/* 도시대기측정소 점검앱 — 지역별 추천 경로를 포함한 오프라인 캐시 */
var CACHE_PREFIX = 'daegi-app-' + encodeURIComponent(new URL(self.registration.scope).pathname) + '-';
var CACHE_NAME = CACHE_PREFIX + 'v18-direct-inspection';
var ASSETS = [
  './', './index.html', './admin.html', './user.html',
  './manifest-v2.json', './manifest-admin-v2.json', './manifest-user-v2.json',
  './app-icon-v2-192.png', './app-icon-v2-512.png',
  './app-icon-user-v2-192.png', './app-icon-user-v2-512.png',
  './brand-admin-v2.png', './brand-user-v2.png',
];
var OPTIONAL = [
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];
var urls = ASSETS.map(function(path) { return new URL(path, self.registration.scope).href; });
var canonical = function(url) { var u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(urls.map(function(url) { return new Request(url, {cache:'reload'}); })).then(function() {
      // Export libraries are optional: a CDN outage must not block the app update.
      return Promise.all(OPTIONAL.map(function(url) {
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 4000);
        return fetch(url, {signal:controller.signal}).then(function(response) {
          if (response.ok) return cache.put(url, response);
        }).catch(function() {}).finally(function() { clearTimeout(timeout); });
      }));
    });
  }).then(function() { return self.skipWaiting(); }));
});
self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(key) {
      return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME;
    }).map(function(key) { return caches.delete(key); }));
  }).then(function() { return self.clients.claim(); }));
});
self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var key = canonical(request.url), isLocal = urls.indexOf(key) >= 0, isOptional = OPTIONAL.indexOf(key) >= 0;
  // Firebase, image uploads and unrelated applications are not intercepted.
  if (!isLocal && !isOptional) return;
  var isHTML = isLocal && (request.mode === 'navigate' || /\/$|\.html$/.test(new URL(key).pathname));
  event.respondWith(caches.open(CACHE_NAME).then(function(cache) {
    function fromNetwork() {
      return fetch(request).then(function(response) {
        if (response.ok) {
          var copy = response.clone();
          event.waitUntil(cache.put(key, copy).catch(function() {}));
        }
        if (!response.ok && isHTML) return cache.match(key).then(function(cached) { return cached || response; });
        return response;
      });
    }
    if (isHTML) return fromNetwork().catch(function() {
      return cache.match(key).then(function(cached) {
        return cached || new Response('오프라인입니다. 온라인에서 한 번 접속한 뒤 다시 열어주세요.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
      });
    });
    return cache.match(key).then(function(cached) { return cached || fromNetwork(); }).catch(function() {
      return Response.error();
    });
  }));
});
