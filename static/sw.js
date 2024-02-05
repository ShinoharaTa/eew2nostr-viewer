const CACHE_VERSION = "v1";
const CACHE_NAME = `${registration.scope}!${CACHE_VERSION}`;
const MAX_AGE_SECONDS = 3600; // 1時間のキャッシュ時間

// キャッシュするファイルをセットする
const urlsToCache = ["."];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName.startsWith(`${registration.scope}!`) &&
            cacheName !== CACHE_NAME
          ) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isCacheable = url.pathname.match(/\.(png|ico|woff)$/);

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        const headers = response.headers;
        const date = headers.get("date");
        const ageSeconds = date
          ? (Date.now() - new Date(date).getTime()) / 1000
          : MAX_AGE_SECONDS + 1;
        if (ageSeconds < MAX_AGE_SECONDS) {
          return response; // キャッシュが新しい場合は、キャッシュからレスポンスを返す
        }
        // キャッシュが古い場合は、後続の処理で新しいコンテンツを取得
      }

      return fetch(event.request.clone()).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }

        const responseToCache = response.clone();
        if (isCacheable) {
          caches.open(CACHE_NAME).then((cache) => {
            const headers = { date: new Date().toUTCString() };
            cache.put(
              event.request,
              new Response(responseToCache.body, {
                ...responseToCache,
                headers,
              })
            );
          });
        }

        return response;
      });
    })
  );
});
