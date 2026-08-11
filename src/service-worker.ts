/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;

// version はビルドごとに変わるため、デプロイのたびに新しいキャッシュへ切り替わる。
const CACHE = `cache-${version}`;

// build: SvelteKit が生成したアセット、files: static/ の中身。
// いずれもビルド時に確定するので、手で一覧を管理する必要がない。
const ASSETS = [...build, ...files];

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // ビルド成果物と static/ のファイルは内容がバージョンに紐づくので
      // キャッシュを優先してよい。
      if (ASSETS.includes(url.pathname)) {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
      }

      // それ以外(HTML を含む)はネットワーク優先。
      // 緊急地震速報を扱う都合上、古い内容を返すのはオフライン時だけに限る。
      try {
        const response = await fetch(event.request);
        if (response.status === 200 && response.type === "basic") {
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (err) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});
