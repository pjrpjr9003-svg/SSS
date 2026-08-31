/* =====================================================
   Service Worker – 도시대기측정소 점검앱
   오프라인 캐싱 + localStorage 자동 백업
===================================================== */
var CACHE_NAME = 'daegi-v12';
var ASSETS = [
  './',
  './index.html',
  './admin.html',
  './user.html',
  './manifest.json',
  './manifest-admin.json',
  './manifest-user.json',
  './icon-192.png',
  './icon-512.png',
  './icon-user-192.png',
  './icon-user-512.png',
  './logo-admin.png',
  './logo-user.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

/* 설치 – 주요 파일 캐시 */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* 활성화 – 구 캐시 삭제 */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* 요청 가로채기
   - HTML 문서: 네트워크 우선 → 배포한 최신 화면을 즉시 반영
   - 그 외 리소스: 캐시 우선 */
self.addEventListener('fetch', function(e) {
  var req = e.request;
  var isHTML = req.mode === 'navigate' ||
               req.destination === 'document' ||
               req.url.indexOf('.html') > -1;

  if (isHTML) {
    e.respondWith(
      fetch(req).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(response) {
        /* CDN 리소스는 캐시에 추가 */
        if (response && response.status === 200 &&
            req.url.includes('cdnjs.cloudflare.com')) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(req, clone);
          });
        }
        return response;
      }).catch(function() {
        /* 완전 오프라인 – index.html 반환 */
        return caches.match('./index.html');
      });
    })
  );
});
