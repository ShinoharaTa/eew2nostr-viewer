// 発令エリアの地図画像をサーバーサイドでレンダリングする。
//
//   GET /images/alert.webp?pref=42&pref=43&key=eew&w=1200&h=630
//
// eew2nostr が Nostr 投稿に画像 URL を載せるための API。クエリだけで
// 画像が一意に決まるので、CDN に長期キャッシュさせて実質静的配信にする。
//
// 出典: 地図形状は地球地図日本(国土地理院)由来(scripts/build-prefecture-paths.mjs 参照)

import sharp from "sharp";
import { SEVERITY_COLOR } from "$lib/bosai/status";
import mapData from "$lib/server/prefecture-paths.json";
import type { RequestHandler } from "./$types";

// 発令種別ごとの強調色。気象庁の配色指針(viewer の SEVERITY_COLOR)に揃える。
// eew は警報級の赤。tsunami は大津波警報の紫
const KEY_COLOR: Record<string, string> = {
  eew: SEVERITY_COLOR.warning,
  warning: SEVERITY_COLOR.warning,
  emergency: SEVERITY_COLOR.emergency,
  advisory: SEVERITY_COLOR.advisory,
  tsunami: "#b40068",
};

// 地の配色は viewer 本体のダークテーマに揃える
const BG_COLOR = "#1c2529";
const LAND_FILL = "#2f3d44";
const LAND_STROKE = "#16242f";

const DEFAULT_WIDTH = 1200; // OGP 推奨サイズ
const DEFAULT_HEIGHT = 630;
const SIZE_MIN = 100;
const SIZE_MAX = 2000;
const MARGIN_RATIO = 0.04;

// 自動ズームの調整値(地図座標系。全体が 1000×1032)。
// 全国図固定だと沖縄や長崎の離島がプレビューサイズで視認できないため、
// 既定では発令県の範囲に寄せ、周辺県が入る程度の余白と下限を設ける
const ZOOM_PAD_RATIO = 0.35;
const ZOOM_PAD_UNITS = 40;
const ZOOM_MIN_SPAN = 300;

const CACHE_HEADER = "public, max-age=86400, s-maxage=31536000, immutable";

function bad(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// pref=42&pref=43 と pref=42,43 の両方を受ける。
// 不正値は無視せずエラーにする。投稿側のバグに気付けなくなるため
function parsePrefs(values: string[]): number[] | null {
  const codes = new Set<number>();
  for (const value of values) {
    for (const token of value.split(",")) {
      if (!/^\d{1,2}$/.test(token.trim())) return null;
      const code = Number(token);
      if (code < 1 || code > 47) return null;
      codes.add(code);
    }
  }
  return [...codes];
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
function regionFor(prefs: number[], wholeMap: boolean): [number, number, number, number] {
  const { viewWidth, viewHeight } = mapData;
  const bounds: Record<string, number[]> = mapData.bounds;

  if (wholeMap || prefs.length === 0) return [0, 0, viewWidth, viewHeight];

  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const code of prefs) {
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

function buildSvg(
  width: number,
  height: number,
  prefs: number[],
  color: string,
  wholeMap: boolean,
): string {
  const paths = mapData.prefs as Record<string, string>;
  const [rx, ry, spanX, spanY] = regionFor(prefs, wholeMap);

  // 対象範囲をキャンバスに収める(余白つき contain・中央寄せ)
  const margin = Math.min(width, height) * MARGIN_RATIO;
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);
  const tx = (width - spanX * scale) / 2 - rx * scale;
  const ty = (height - spanY * scale) / 2 - ry * scale;

  // ストロークは拡縮後に約1pxになるよう地図座標系の太さへ換算する
  const baseStroke = (1 / scale).toFixed(2);
  // 同色のハローを2層下に敷いてグローにする。小さな離島(沖縄・長崎など)や
  // 暗い強調色(特別警報)でもプレビューサイズで視認できるようにするため
  const haloOuter = (8 / scale).toFixed(2);
  const haloInner = (4 / scale).toFixed(2);
  const highlightStroke = (1 / scale).toFixed(2);

  const highlighted = new Set(prefs);
  const base: string[] = [];
  const halo: string[] = [];
  const active: string[] = [];
  for (const [code, d] of Object.entries(paths)) {
    if (highlighted.has(Number(code))) {
      halo.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="0.3" stroke-width="${haloOuter}"/>` +
          `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="0.6" stroke-width="${haloInner}"/>`,
      );
      active.push(`<path d="${d}" fill="${color}" stroke="#e8eef1" stroke-opacity="0.55" stroke-width="${highlightStroke}"/>`);
    } else {
      base.push(`<path d="${d}" fill="${LAND_FILL}" stroke="${LAND_STROKE}" stroke-width="${baseStroke}"/>`);
    }
  }

  // 描画順: 通常の県 → ハロー → 強調県。強調県の境界線を最前面に出す
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${BG_COLOR}"/>` +
    `<g transform="translate(${tx} ${ty}) scale(${scale})" fill-rule="evenodd" stroke-linejoin="round">` +
    base.join("") +
    halo.join("") +
    active.join("") +
    `</g></svg>`
  );
}

export const GET: RequestHandler = async ({ url }) => {
  const prefs = parsePrefs(url.searchParams.getAll("pref"));
  if (prefs === null) return bad("pref は 1〜47 の都道府県コードで指定してください");

  const key = url.searchParams.get("key") ?? "warning";
  const color = KEY_COLOR[key];
  if (!color) return bad(`key は ${Object.keys(KEY_COLOR).join(" / ")} のいずれかです`);

  const width = parseSize(url.searchParams.get("w"), DEFAULT_WIDTH);
  const height = parseSize(url.searchParams.get("h"), DEFAULT_HEIGHT);
  if (width === null || height === null) {
    return bad(`w / h は ${SIZE_MIN}〜${SIZE_MAX} の整数で指定してください`);
  }

  const view = url.searchParams.get("view") ?? "auto";
  if (view !== "auto" && view !== "japan") return bad("view は auto / japan のいずれかです");

  const svg = buildSvg(width, height, prefs, color, view === "japan");
  const image = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();

  return new Response(new Uint8Array(image), {
    headers: {
      "content-type": "image/webp",
      "cache-control": CACHE_HEADER,
      "x-attribution": "map data: Global Map Japan (GSI) via dataofjapan/land",
    },
  });
};
