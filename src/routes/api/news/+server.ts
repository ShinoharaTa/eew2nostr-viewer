// ニュースの中継。
//
// RSS の配信元は CORS を開けていないため、ブラウザから直接は取れない。
// ここでサーバ側が取って JSON に直す。
//
// 配信元に不必要な負荷をかけないよう、一定時間はキャッシュを返す。
// 取得に失敗したときは、期限切れでも直前に取れたものを返す。
// ニュースが少し古いことより、画面から消えるほうが困るため。

import { json } from "@sveltejs/kit";
import { parseRss, type NewsItem } from "$lib/news/rss";
import type { RequestHandler } from "./$types";

const FEED_URL = "https://www.nhk.or.jp/rss/news/cat0.xml";
const SOURCE = "NHK";
const TTL_MS = 5 * 60 * 1000;
const LIMIT = 20;

let cache: { at: number; items: NewsItem[] } | null = null;

export const GET: RequestHandler = async ({ fetch }) => {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return respond(cache.items, cache.at, true);
  }

  try {
    const res = await fetch(FEED_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`配信元が ${res.status} を返しました`);
    const items = parseRss(await res.text(), LIMIT);
    // 0件はパースの失敗を疑う。直前のものがあればそちらを残す
    if (items.length === 0 && cache) return respond(cache.items, cache.at, true);
    cache = { at: now, items };
    return respond(items, now, false);
  } catch (e) {
    if (cache) return respond(cache.items, cache.at, true);
    return json(
      {
        source: SOURCE,
        items: [],
        fetchedAt: null,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
};

function respond(items: NewsItem[], at: number, cached: boolean) {
  return json(
    { source: SOURCE, items, fetchedAt: new Date(at).toISOString(), cached },
    {
      headers: {
        // CDN 側でも同じ時間だけ持たせる
        "cache-control": `public, max-age=${Math.floor(TTL_MS / 1000)}`,
      },
    },
  );
}
