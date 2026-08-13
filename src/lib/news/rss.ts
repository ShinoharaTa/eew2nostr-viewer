// RSS 2.0 を最小限だけ読む。
//
// このファイルは意図的に import を持たない。Node から直接読んでテストできるようにするため。
// 汎用の XML パーサは入れていない。読むのは配信元が決まった RSS 2.0 だけで、
// 必要なのは title / link / description / pubDate の4つしかないため。

export interface NewsItem {
  title: string;
  link: string;
  /** 記事の要約。画面内で読めるようにするため持つ。無ければ空文字 */
  description: string;
  /** ISO 8601。読めなければ空文字 */
  publishedAt: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m] ?? m);
}

/** タグの中身を取る。CDATA で包まれていることがある */
function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return decode((cdata ? cdata[1] : raw).trim());
}

function toIso(v: string): string {
  if (!v) return "";
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * RSS 2.0 の XML から記事を取り出す。
 * 壊れた1件で全部を落とさないよう、title と link が揃ったものだけ返す。
 */
export function parseRss(xml: string, limit = 20): NewsItem[] {
  const items: NewsItem[] = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const title = pick(block, "title");
    const link = pick(block, "link");
    if (!title || !link) continue;
    items.push({
      title,
      link,
      // description に HTML を入れてくる配信元があるので、タグは落として文だけ残す
      description: pick(block, "description").replace(/<[^>]+>/g, "").trim(),
      publishedAt: toIso(pick(block, "pubDate") || pick(block, "dc:date")),
    });
    if (items.length >= limit) break;
  }
  return items;
}
