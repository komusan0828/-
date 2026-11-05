// オフラインでも最後に見た号を開けるようにする
// アプリを直したときは、この番号と index.html の ?v= を一緒に上げる
const CACHE = 'mn-v10';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg'];
self.addEventListener('install', (e) => {
  // スマホに残っている古いファイルではなく、必ずサーバーから取り直して保存する
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// まずネットから（スマホに覚えている古い版を使わず、毎回新しいか確かめて）取り、つながらないときだけ保存しておいたものを使う
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const key = url.origin + url.pathname;
  e.respondWith(
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.match(key).then((r) => r || caches.match(url.origin + url.pathname.replace(/[^/]*$/, '') + 'index.html')))
  );
});
