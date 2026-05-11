/* =====================================================
   Service Worker – 도시대기측정소 점검앱
   오프라인 캐싱 + localStorage 자동 백업
===================================================== */
var CACHE_NAME = 'daegi-user-v13';
var ASSETS = [
  './',
  './user.html',
  './admin.html',
  './user.html',
  './manifest.json',
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

/* 요청 가로채기 – 캐시 우선, 없으면 네트워크 */
self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        /* CDN 리소스는 캐시에 추가 */
        if (response && response.status === 200 &&
            e.request.url.includes('cdnjs.cloudflare.com')) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, clone);
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
