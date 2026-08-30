// 発令エリアの地図画像をサーバーサイドでレンダリングする。
//
//   GET /images/alert.webp?pref=13:red&pref=11:yellow&w=1200&h=630
//
// eew2nostr が Nostr 投稿に画像 URL を載せるための API。クエリだけで
// 画像が一意に決まるので、CDN に長期キャッシュさせて実質静的配信にする。
//
// 色は「トークン→色」の変換だけを担い、「現象→色」の判定は bot 側の責務
// (eew2nostr#35, #40 で決めた 色=警戒レベル の6色体系)。
//
// 出典: 地図形状は地球地図日本(国土地理院)由来(scripts/build-prefecture-paths.mjs 参照)。
// 凡例の文字は Noto Sans CJK JP のアウトラインをビルド時にパス化して同梱
// (serverless に日本語フォントが無いため。scripts/build-legend-glyphs.mjs 参照)

import sharp from "sharp";
import mapData from "$lib/server/prefecture-paths.json";
import glyphs from "$lib/server/legend-glyphs.json";
import type { RequestHandler } from "./$types";

// 警戒レベル配色(気象庁「気象情報の配色に関する設定指針」相当)。
// eew2nostr の議論(#35, #40)で決めた6色をそのまま採用する
const PALETTE: Record<string, string> = {
  black: "#0c000c", // レベル5相当(特別警報・氾濫発生)
  purple: "#aa00aa", // レベル4相当(大津波警報・氾濫危険など)
  red: "#ff2800", // レベル3相当(警報・津波警報など)
  orange: "#ff9900", // 震度4〜5強・噴火レベル3
  yellow: "#f2e700", // レベル2相当(注意報など)
  white: "#ffffff", // レベル1
};

// 地の配色は viewer 本体のダークテーマに揃える。
// 県境は背景色系の細線にして、地形が「線で区切られた面」として読めるようにする
const BG_COLOR = "#161f24";
const LAND_FILL = "#3d4a53";
const LAND_STROKE = "#171f24";
const HIGHLIGHT_STROKE = "#f2f6f8";

const DEFAULT_WIDTH = 1200; // OGP 推奨サイズ
const DEFAULT_HEIGHT = 630;
const SIZE_MIN = 100;
const SIZE_MAX = 2000;
const MARGIN_RATIO = 0.03;

// 自動ズームの調整値(地図座標系。全体が 1000×1032)。
// 全国図固定だと沖縄や長崎の離島がプレビューサイズで視認できないため、
// 既定では発令県の範囲に寄せる。余白は隣県が少し見える程度に絞る
const ZOOM_PAD_RATIO = 0.18;
const ZOOM_PAD_UNITS = 24;
const ZOOM_MIN_SPAN = 210;

// 凡例は指定順に最大8件、溢れは「他n県」に丸める
const LEGEND_MAX_ROWS = 8;

const CACHE_HEADER = "public, max-age=86400, s-maxage=31536000, immutable";

interface PrefSpec {
  code: number;
  color: string; // PALETTE のトークン
}

function bad(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// pref=13:red&pref=11:yellow と pref=13:red,11:yellow の両方を受ける。
// 色を省略したトークンは key の色になる。不正値は無視せずエラーにする。
// 投稿側のバグに気付けなくなるため
function parsePrefs(values: string[], fallbackColor: string): PrefSpec[] | null {
  const seen = new Map<number, PrefSpec>();
  for (const value of values) {
    for (const token of value.split(",")) {
      const m = /^(\d{1,2})(?::([a-z]+))?$/.exec(token.trim());
      if (!m) return null;
      const code = Number(m[1]);
      if (code < 1 || code > 47) return null;
      const color = m[2] ?? fallbackColor;
      if (!PALETTE[color]) return null;
      seen.set(code, { code, color }); // 重複指定は後勝ち
    }
  }
  return [...seen.values()];
}

function parseSize(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (n < SIZE_MIN || n > SIZE_MAX) return null;
  return n;
}

// 描画対象の地図範囲 [minX, minY, spanX, spanY] を決める。
// 発令県があれば、その外接矩形に余白と下限を掛けた範囲へ寄せる
function regionFor(prefs: PrefSpec[], wholeMap: boolean): [number, number, number, number] {
  const { viewWidth, viewHeight } = mapData;
  const bounds: Record<string, number[]> = mapData.bounds;

  if (wholeMap || prefs.length === 0) return [0, 0, viewWidth, viewHeight];

  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { code } of prefs) {
    const [x1, y1, x2, y2] = bounds[code];
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }

  const span = Math.max(
    Math.max(maxX - minX, maxY - minY) * (1 + ZOOM_PAD_RATIO) + ZOOM_PAD_UNITS,
    ZOOM_MIN_SPAN,
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return [cx - span / 2, cy - span / 2, span, span];
}

function buildMap(
  width: number,
  height: number,
  prefs: PrefSpec[],
  wholeMap: boolean,
): string {
  const paths: Record<string, string> = mapData.prefs;
  const [rx, ry, spanX, spanY] = regionFor(prefs, wholeMap);

  // 対象範囲をキャンバスに収める(余白つき contain・中央寄せ)
  const margin = Math.min(width, height) * MARGIN_RATIO;
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);
  const tx = (width - spanX * scale) / 2 - rx * scale;
  const ty = (height - spanY * scale) / 2 - ry * scale;

  const baseStroke = (1 / scale).toFixed(2);
  // 強調県はくっきりした細い明色アウトライン。隣接する強調県同士でも
  // 境目が明るい線として残る(ぼかし・グローは使わない)
  const highlightStroke = (1.2 / scale).toFixed(2);

  const colorOf = new Map(prefs.map((p) => [p.code, PALETTE[p.color]]));
  const base: string[] = [];
  const active: string[] = [];
  for (const [code, d] of Object.entries(paths)) {
    const fill = colorOf.get(Number(code));
    if (fill) {
      active.push(
        `<path d="${d}" fill="${fill}" stroke="${HIGHLIGHT_STROKE}" stroke-width="${highlightStroke}"/>`,
      );
    } else {
      base.push(`<path d="${d}" fill="${LAND_FILL}" stroke="${LAND_STROKE}" stroke-width="${baseStroke}"/>`);
    }
  }

  return (
    `<g transform="translate(${tx} ${ty}) scale(${scale})" fill-rule="evenodd" stroke-linejoin="round">` +
    base.join("") +
    active.join("") +
    `</g>`
  );
}

// 「他n県」を1文字グリフの組み合わせで作る。座標系はフォント座標のままで、
// 拡縮は呼び出し側の transform に任せる。戻りは [パス群, 送り幅]
function othersText(count: number): [string, number] {
  const chars: Record<string, { d: string; w: number }> = glyphs.chars;
  const parts: string[] = [];
  let advance = 0;
  for (const ch of `他${count}県`) {
    const glyph = chars[ch];
    parts.push(`<g transform="translate(${advance.toFixed(1)} 0)"><path d="${glyph.d}"/></g>`);
    advance += glyph.w;
  }
  return [parts.join(""), advance];
}

// 右上の凡例。「●(色丸) 県名」を並べる。地図の邪魔をしないよう
// 半透明パネルに載せ、行数は上限で丸める
function buildLegend(width: number, height: number, prefs: PrefSpec[]): string {
  if (prefs.length === 0) return "";

  const names: Record<string, { d: string; w: number }> = glyphs.names;
  const unit = Math.min(width, height);
  const fontSize = Math.min(Math.max(unit * 0.042, 13), 30);
  const glyphScale = fontSize / glyphs.fontSize;
  const rowH = fontSize * 1.5;
  const dotR = fontSize * 0.34;
  const padX = fontSize * 0.7;
  const padY = fontSize * 0.55;
  const dotGap = fontSize * 0.55; // 丸とテキストの間

  const shown = prefs.slice(0, LEGEND_MAX_ROWS);
  const rest = prefs.length - shown.length;

  interface Row {
    color: string | null; // null = 「他n県」行
    body: string; // フォント座標系のパス群
    advance: number; // フォント座標系の送り幅
  }
  const rows: Row[] = shown.map(({ code, color }) => ({
    color: PALETTE[color],
    body: `<path d="${names[code].d}"/>`,
    advance: names[code].w,
  }));
  if (rest > 0) {
    const [body, advance] = othersText(rest);
    rows.push({ color: null, body, advance });
  }

  const maxTextW = Math.max(...rows.map((r) => r.advance)) * glyphScale;
  const panelW = padX * 2 + dotR * 2 + dotGap + maxTextW;
  const panelH = padY * 2 + rowH * rows.length;
  const panelX = width - unit * MARGIN_RATIO - panelW;
  const panelY = unit * MARGIN_RATIO;

  const items: string[] = [];
  rows.forEach((row, i) => {
    const cy = panelY + padY + rowH * (i + 0.5);
    const dotX = panelX + padX + dotR;
    if (row.color) {
      // 黒(レベル5)や白でも見えるように薄い輪郭を添える
      items.push(
        `<circle cx="${dotX.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dotR.toFixed(1)}" fill="${row.color}" stroke="#ffffff" stroke-opacity="0.4" stroke-width="1"/>`,
      );
    }
    const textX = panelX + padX + dotR * 2 + dotGap;
    // グリフはベースライン原点。行中央から視覚的に揃う位置に置く
    const baseline = cy + fontSize * 0.36;
    items.push(
      `<g transform="translate(${textX.toFixed(1)} ${baseline.toFixed(1)}) scale(${glyphScale.toFixed(4)})" fill="#eef3f5">${row.body}</g>`,
    );
  });

  return (
    `<rect x="${panelX.toFixed(1)}" y="${panelY.toFixed(1)}" width="${panelW.toFixed(1)}" height="${panelH.toFixed(1)}" rx="${(fontSize * 0.35).toFixed(1)}" fill="#0b1216" fill-opacity="0.78" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1"/>` +
    items.join("")
  );
}

export const GET: RequestHandler = async ({ url }) => {
  const key = url.searchParams.get("key") ?? "red";
  if (!PALETTE[key]) return bad(`key は ${Object.keys(PALETTE).join(" / ")} のいずれかです`);

  const prefs = parsePrefs(url.searchParams.getAll("pref"), key);
  if (prefs === null) {
    return bad(
      `pref は「都道府県コード(1〜47)」または「コード:色」で指定してください(色: ${Object.keys(PALETTE).join(" / ")})`,
    );
  }

  const width = parseSize(url.searchParams.get("w"), DEFAULT_WIDTH);
  const height = parseSize(url.searchParams.get("h"), DEFAULT_HEIGHT);
  if (width === null || height === null) {
    return bad(`w / h は ${SIZE_MIN}〜${SIZE_MAX} の整数で指定してください`);
  }

  const view = url.searchParams.get("view") ?? "auto";
  if (view !== "auto" && view !== "japan") return bad("view は auto / japan のいずれかです");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${BG_COLOR}"/>` +
    buildMap(width, height, prefs, view === "japan") +
    buildLegend(width, height, prefs) +
    `</svg>`;
  const image = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();

  return new Response(new Uint8Array(image), {
    headers: {
      "content-type": "image/webp",
      "cache-control": CACHE_HEADER,
      "x-attribution": "map data: Global Map Japan (GSI) via dataofjapan/land",
    },
  });
};
