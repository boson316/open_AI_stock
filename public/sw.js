// OpenStock 離線快取：程式檔（檔名含雜湊）優先用快取；頁面與資料優先抓最新、斷線時用快取。
const CACHE = "openstock-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
// 頁面載入後傳來已用到的檔案清單（程式、樣式、資料），一併存起來供離線使用。
self.addEventListener("message", (e) => {
  const urls = (e.data && e.data.type === "cache-urls" && Array.isArray(e.data.urls)) ? e.data.urls : [];
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(
        urls
          .filter((u) => new URL(u).origin === location.origin)
          .map((u) => c.match(u, { ignoreVary: true }).then((hit) => hit || fetch(u).then((res) => res.ok && c.put(u, res)).catch(() => {}))),
      ),
    ),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/assets/")) {
    e.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate", ignoreVary: true }).then((hit) => hit || Response.error())),
  );
});
