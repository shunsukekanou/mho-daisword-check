/*
 * sw.js：ホーム画面のアプリを、電波が弱い場所でも開けるようにする小さな仕組み
 * ・まずネットから取り、取れなければ控え（キャッシュ）を使う。そのため、公開した新しい版は、次に開いたとき反映される。
 * ・チェックの記録（localStorage）は、ここでは扱わない。
 * ・ファイルを変えて公開するときは、下の CACHE の版番号を上げる。
 */
var CACHE = 'mho-check-v1';
var FILES = [
  './', 'index.html', 'style.css', 'data.js', 'core.js', 'app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(FILES); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('index.html'); });
    })
  );
});
