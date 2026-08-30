// 都道府県の SVG パスデータを生成する。
//
// 出典: dataofjapan/land の japan.topojson(地球地図日本(国土地理院)の
// Shapefile を変換したもの)。利用条件は出典元の明記。
// https://github.com/dataofjapan/land
//
// 生成結果は src/lib/server/prefecture-paths.json にコミットする。
// 実行時に毎回変換するにはデータが重いのと、配信元に負荷をかけないため。
// 再生成: node scripts/build-prefecture-paths.mjs
//
// 小笠原諸島・南鳥島・沖ノ鳥島は描画範囲から除外する。含めると経度の幅が
// 30度以上になり、本土が小さくなりすぎて発令エリアが読めなくなるため。

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE_URL =
  "https://raw.githubusercontent.com/dataofjapan/land/master/japan.topojson";
const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/server/prefecture-paths.json",
);

// 描画範囲(経度・緯度)。沖縄・奄美は含み、小笠原方面だけ落とす
const LON_MIN = 122;
const LON_MAX = 149.2;
const LAT_MIN = 23.5;
const LAT_MAX = 46.2;

// 南東海域の除外ボックス。小笠原・硫黄島・鳥島は緯度だけでは沖縄と、
// 経度だけでは本土と区別できないため、組で判定する。
// 青ヶ島(緯度32.45)までの伊豆諸島は残す
const EXCLUDE_LON_MIN = 136;
const EXCLUDE_LAT_MAX = 32.3;

const VIEW_WIDTH = 1000; // 出力パスの座標系の横幅
const SIMPLIFY_TOLERANCE = 0.5; // 座標系単位。1200px 描画で 0.6px 相当
const MIN_RING_AREA = 2.0; // これより小さい島は描画しても見えない

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);
const topo = await res.json();

// --- TopoJSON のデコード(依存を増やさないため自前で行う) ---

const { scale, translate } = topo.transform;

// arc は整数の差分列。絶対座標(経度緯度)の列に戻す
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});

// 負のインデックスは逆順参照(~i)
function ringFromArcs(arcIndices) {
  const points = [];
  for (const idx of arcIndices) {
    const arc = idx >= 0 ? arcs[idx] : arcs[~idx].slice().reverse();
    // 連結部は前の arc の終点と重複するので落とす
    points.push(...(points.length ? arc.slice(1) : arc));
  }
  return points;
}

// --- 投影(正距円筒 + 中央緯度で横方向を補正) ---

const COS_LAT0 = Math.cos((36 * Math.PI) / 180);
const spanX = (LON_MAX - LON_MIN) * COS_LAT0;
const spanY = LAT_MAX - LAT_MIN;
const k = VIEW_WIDTH / spanX;
const VIEW_HEIGHT = Math.round(spanY * k);

function project([lon, lat]) {
  return [(lon - LON_MIN) * COS_LAT0 * k, (LAT_MAX - lat) * k];
}

// --- 単純化(Douglas-Peucker) ---

function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const cx = a[0] + Math.max(0, Math.min(1, t)) * dx;
  const cy = a[1] + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0;
    let maxIdx = 0;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

// --- 変換本体 ---

const geometries = topo.objects.japan.geometries;
const prefs = {};
const bounds = {};

for (const geom of geometries) {
  const code = geom.properties.id;
  const polygons =
    geom.type === "Polygon" ? [geom.arcs] : geom.arcs; // MultiPolygon
  const parts = [];
  // 発令エリアへの自動ズーム用に県のバウンディングボックスも記録する
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];

  for (const polygon of polygons) {
    for (const ringArcs of polygon) {
      const lonlat = ringFromArcs(ringArcs);
      // リング全体が描画範囲外なら捨てる(小笠原方面)
      const inRange = lonlat.some(
        ([lon, lat]) =>
          lon >= LON_MIN &&
          lon <= LON_MAX &&
          lat >= LAT_MIN &&
          lat <= LAT_MAX &&
          !(lon >= EXCLUDE_LON_MIN && lat <= EXCLUDE_LAT_MAX),
      );
      if (!inRange) continue;

      let ring = simplify(lonlat.map(project), SIMPLIFY_TOLERANCE);
      if (ring.length < 3 || ringArea(ring) < MIN_RING_AREA) continue;

      for (const [x, y] of ring) {
        bbox[0] = Math.min(bbox[0], x);
        bbox[1] = Math.min(bbox[1], y);
        bbox[2] = Math.max(bbox[2], x);
        bbox[3] = Math.max(bbox[3], y);
      }

      const d = ring
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
        .join("");
      parts.push(`${d}Z`);
    }
  }

  if (parts.length) {
    prefs[code] = parts.join("");
    bounds[code] = bbox.map((v) => Math.round(v * 10) / 10);
  }
}

const missing = [];
for (let code = 1; code <= 47; code++) {
  if (!prefs[code]) missing.push(code);
}
if (missing.length) throw new Error(`パスが生成されなかった県: ${missing}`);

const out = {
  source: SOURCE_URL,
  attribution: "地球地図日本(国土地理院) / dataofjapan/land",
  viewWidth: VIEW_WIDTH,
  viewHeight: VIEW_HEIGHT,
  prefs,
  bounds,
};

writeFileSync(OUT_PATH, JSON.stringify(out));
const size = JSON.stringify(out).length;
console.log(`書き出し: ${OUT_PATH} (${(size / 1024).toFixed(0)} KB, viewBox 0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT})`);
