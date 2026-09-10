// 発令エリアの地図画像をサーバーサイドでレンダリングする。
//
//   GET /images/alert.webp?pref=13:red&pref=11:yellow&w=1200&h=630
//   GET /images/alert.webp?pref=43:purple&epi=32.7545,130.762&int=7&mag=7.3
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

// 強調県のアウトラインは塗りとのコントラストで決める。
// 白縁固定だと 🟡(黄)や ⚪(白)の縁が塗りと同化するため
const EDGE_LIGHT = "#f2f6f8";
const EDGE_DARK = "#161f24";
const EDGE_LUMINANCE_THRESHOLD = 0.4;

// WCAG の相対輝度。明るい塗りかどうかの判定に使う
function luminance(hex: string): number {
  const linear = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

function edgeFor(fill: string): string {
  return luminance(fill) > EDGE_LUMINANCE_THRESHOLD ? EDGE_DARK : EDGE_LIGHT;
}

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

// 凡例パネルと震源ラベルの共通スタイル。地図の邪魔をしない半透明の板に載せる
const PANEL_FILL = "#0b1216";
const PANEL_FILL_OPACITY = 0.78;
const PANEL_STROKE = "#ffffff";
const PANEL_STROKE_OPACITY = 0.1;
const PANEL_TEXT = "#eef3f5";

// 震源の ✕ マーク。県の塗り(黒〜白の6色)のどれに重なっても読めるよう、
// 暗いハローの上に明色の線を重ねる。サイズは短辺比
const EPI_ARM_RATIO = 0.026; // ✕ の腕の長さ(中心から端まで)
const EPI_STROKE_RATIO = 0.0085;
const EPI_HALO_RATIO = 0.006; // ハローの片側の太さ
const EPI_MARK_COLOR = "#ffffff";
const EPI_HALO_COLOR = "#0b1216";

// 震度は気象庁の階級。5・6 は弱/強があるので単独の "5" は受け付けない
const INTENSITY_LABELS: Record<string, string> = {
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5-": "5弱",
  "5+": "5強",
  "6-": "6弱",
  "6+": "6強",
  "7": "7",
};
// エラーメッセージ用の並び。Record のキー順だと整数キーが先に来て
// "1 / 2 / 3 / 4 / 7 / 5- / ..." になってしまうため明示する
const INTENSITY_ORDER = ["1", "2", "3", "4", "5-", "5+", "6-", "6+", "7"];
// 投稿側が漢字表記のまま渡してきても通す
const INTENSITY_ALIASES: Record<string, string> = {
  "5弱": "5-",
  "5強": "5+",
  "6弱": "6-",
  "6強": "6+",
};

// 震源の緯度経度の許容範囲。日本周辺から大きく外れた値は投稿側のバグとみなす
const EPI_LAT_MIN = 20;
const EPI_LAT_MAX = 50;
const EPI_LON_MIN = 118;
const EPI_LON_MAX = 156;

const CACHE_HEADER = "public, max-age=86400, s-maxage=31536000, immutable";

interface PrefSpec {
  code: number;
  color: string; // PALETTE のトークン
}

interface Epicenter {
  lat: number;
  lon: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 緯度経度 → 地図座標。scripts/build-prefecture-paths.mjs の project() と
// 同じ式を、同スクリプトが書き出した projection パラメータで再現する
function projectLatLon(lat: number, lon: number): [number, number] {
  const { lonMin, latMax, cosLat0, k } = mapData.projection;
  return [(lon - lonMin) * cosLat0 * k, (latMax - lat) * k];
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

// epi=32.7545,130.762(緯度,経度)
function parseEpicenter(value: string): Epicenter | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (lat < EPI_LAT_MIN || lat > EPI_LAT_MAX) return null;
  if (lon < EPI_LON_MIN || lon > EPI_LON_MAX) return null;
  return { lat, lon };
}

// int=7 / int=5- / int=5+ / int=5弱。戻りは表示用の文字列("5強" など)。
// クエリ中の "+" は空白にデコードされるため、末尾の空白は "+" と解釈する
// (投稿側が int=5+ を %2B にエスケープしなくても通るように)
function parseIntensity(value: string): string | null {
  const token = value.replace(/ +$/, "+").trim();
  const key = INTENSITY_ALIASES[token] ?? token;
  return INTENSITY_LABELS[key] ?? null;
}

// mag=7.3 / mag=M7.3。表示は気象庁に合わせて小数1桁に揃える
function parseMagnitude(value: string): number | null {
  const t = value.trim().replace(/^[Mm]/, "");
  if (!/^\d{1,2}(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (n < 0 || n > 10) return null;
  return n;
}

// 描画対象の地図範囲 [minX, minY, spanX, spanY] を決める。
// 発令県があれば、その外接矩形に余白と下限を掛けた範囲へ寄せる。
// 震源は海上のことが多く県の外接矩形から外れるので、これも範囲に含める
function regionFor(
  prefs: PrefSpec[],
  epi: Epicenter | null,
  wholeMap: boolean,
): [number, number, number, number] {
  const { viewWidth, viewHeight } = mapData;
  const bounds: Record<string, number[]> = mapData.bounds;

  if (wholeMap || (prefs.length === 0 && !epi)) return [0, 0, viewWidth, viewHeight];

  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { code } of prefs) {
    const [x1, y1, x2, y2] = bounds[code];
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }
  if (epi) {
    const [x, y] = projectLatLon(epi.lat, epi.lon);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const span = Math.max(
    Math.max(maxX - minX, maxY - minY) * (1 + ZOOM_PAD_RATIO) + ZOOM_PAD_UNITS,
    ZOOM_MIN_SPAN,
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return [cx - span / 2, cy - span / 2, span, span];
}

// 地図座標 → キャンバス座標の変換。地図と震源マーカーで同じものを使う
interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

// 対象範囲をキャンバスに収める(余白つき contain・中央寄せ)
function viewportFor(
  width: number,
  height: number,
  [rx, ry, spanX, spanY]: [number, number, number, number],
): Viewport {
  const margin = Math.min(width, height) * MARGIN_RATIO;
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);
  return {
    scale,
    tx: (width - spanX * scale) / 2 - rx * scale,
    ty: (height - spanY * scale) / 2 - ry * scale,
  };
}

function buildMap(prefs: PrefSpec[], { scale, tx, ty }: Viewport): string {
  const paths: Record<string, string> = mapData.prefs;

  // 塗りと県境を別レイヤーにする。塗りにストロークを同時に付けると、
  // 後から描く隣県の塗りが線を半分覆って太さが不均一になるため。
  // 県境は背景色の線で「切れ目」として描く(海と同化して迷いなく読める)
  const boundaryStroke = (1.5 / scale).toFixed(2);
  // 強調県のアウトラインは塗りとのコントラストで色を決め(edgeFor)、
  // 太さは通常の県境と同じにする。同色の県が並んだときの内側の境目も
  // この線だけが頼りになるため、細くしすぎない
  const highlightStroke = (1.5 / scale).toFixed(2);

  const colorOf = new Map(prefs.map((p) => [p.code, PALETTE[p.color]]));
  const baseFill: string[] = [];
  const baseBoundary: string[] = [];
  const activeLight: string[] = [];
  const activeDark: string[] = [];
  for (const [code, d] of Object.entries(paths)) {
    const fill = colorOf.get(Number(code));
    if (fill) {
      const edge = edgeFor(fill);
      const path = `<path d="${d}" fill="${fill}" stroke="${edge}" stroke-width="${highlightStroke}"/>`;
      // 明るい塗り(暗縁)を後に描く。明縁と暗縁の県が隣接したとき、
      // 共有辺には両方の塗りに対してコントラストのある暗縁を残すため
      (edge === EDGE_DARK ? activeDark : activeLight).push(path);
    } else {
      baseFill.push(`<path d="${d}" fill="${LAND_FILL}"/>`);
      baseBoundary.push(`<path d="${d}" fill="none" stroke="${LAND_STROKE}" stroke-width="${boundaryStroke}"/>`);
    }
  }

  // 描画順: 塗り → 県境 → 強調県(明縁 → 暗縁)
  return (
    `<g transform="translate(${tx} ${ty}) scale(${scale})" fill-rule="evenodd" stroke-linejoin="round">` +
    baseFill.join("") +
    baseBoundary.join("") +
    activeLight.join("") +
    activeDark.join("") +
    `</g>`
  );
}

// 「他n県」「震度5強」などを1文字グリフの組み合わせで作る。座標系はフォント
// 座標のままで、拡縮は呼び出し側の transform に任せる。戻りは [パス群, 送り幅]。
// 同梱していない文字は落とす(使う文字はパラメータのバリデーションで縛ってある)
function textPath(text: string): [string, number] {
  const chars: Record<string, { d: string; w: number }> = glyphs.chars;
  const parts: string[] = [];
  let advance = 0;
  for (const ch of text) {
    const glyph = chars[ch];
    if (!glyph) continue;
    parts.push(`<g transform="translate(${advance.toFixed(1)} 0)"><path d="${glyph.d}"/></g>`);
    advance += glyph.w;
  }
  return [parts.join(""), advance];
}

// 半透明パネル。凡例と震源ラベルで見た目を揃える
function panelRect(r: Rect, radius: number): string {
  return (
    `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}"` +
    ` rx="${radius.toFixed(1)}" fill="${PANEL_FILL}" fill-opacity="${PANEL_FILL_OPACITY}"` +
    ` stroke="${PANEL_STROKE}" stroke-opacity="${PANEL_STROKE_OPACITY}" stroke-width="1"/>`
  );
}

// 右上の凡例。「●(色丸) 県名」を並べる。地図の邪魔をしないよう
// 半透明パネルに載せ、行数は上限で丸める。
// 震源ラベルがここを避けられるよう、パネルの矩形も返す
function buildLegend(
  width: number,
  height: number,
  prefs: PrefSpec[],
): { svg: string; rect: Rect | null } {
  if (prefs.length === 0) return { svg: "", rect: null };

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
    const [body, advance] = textPath(`他${rest}県`);
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
      // 黒(レベル5)のような暗い丸でも見えるよう、地図と同じ規則で輪郭を添える
      items.push(
        `<circle cx="${dotX.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dotR.toFixed(1)}" fill="${row.color}" stroke="${edgeFor(row.color)}" stroke-opacity="0.5" stroke-width="1"/>`,
      );
    }
    const textX = panelX + padX + dotR * 2 + dotGap;
    // グリフはベースライン原点。行中央から視覚的に揃う位置に置く
    const baseline = cy + fontSize * 0.36;
    items.push(
      `<g transform="translate(${textX.toFixed(1)} ${baseline.toFixed(1)}) scale(${glyphScale.toFixed(4)})" fill="#eef3f5">${row.body}</g>`,
    );
  });

  const rect: Rect = { x: panelX, y: panelY, w: panelW, h: panelH };
  return { svg: panelRect(rect, fontSize * 0.35) + items.join(""), rect };
}

// 震源の ✕ マークと「震度5強 / M7.3」ラベル。
// ラベルは ✕ の右→左→下→上 の順に、キャンバスに収まって凡例と重ならない
// 位置を選ぶ。どれも駄目ならキャンバス内へ寄せて置く
function buildEpicenter(
  width: number,
  height: number,
  vp: Viewport,
  epi: Epicenter,
  lines: string[],
  avoid: Rect | null,
): string {
  const [mapX, mapY] = projectLatLon(epi.lat, epi.lon);
  const mx = mapX * vp.scale + vp.tx;
  const my = mapY * vp.scale + vp.ty;

  const unit = Math.min(width, height);
  const arm = unit * EPI_ARM_RATIO;
  const core = unit * EPI_STROKE_RATIO;
  const halo = core + unit * EPI_HALO_RATIO * 2;
  const p = (v: number) => v.toFixed(1);
  const cross =
    `M${p(mx - arm)} ${p(my - arm)}L${p(mx + arm)} ${p(my + arm)}` +
    `M${p(mx + arm)} ${p(my - arm)}L${p(mx - arm)} ${p(my + arm)}`;
  const mark =
    `<path d="${cross}" fill="none" stroke="${EPI_HALO_COLOR}" stroke-opacity="0.85" stroke-width="${p(halo)}" stroke-linecap="round"/>` +
    `<path d="${cross}" fill="none" stroke="${EPI_MARK_COLOR}" stroke-width="${p(core)}" stroke-linecap="round"/>`;

  if (lines.length === 0) return mark;

  const fontSize = Math.min(Math.max(unit * 0.042, 13), 30);
  const glyphScale = fontSize / glyphs.fontSize;
  const rowH = fontSize * 1.34;
  const padX = fontSize * 0.55;
  const padY = fontSize * 0.32;

  const rows = lines.map((line) => textPath(line));
  const panelW = padX * 2 + Math.max(...rows.map(([, w]) => w)) * glyphScale;
  const panelH = padY * 2 + rowH * rows.length;

  const margin = unit * MARGIN_RATIO;
  // ✕ の視覚的な端(腕の長さ + ハローの太さの半分)から離す
  const gap = arm + halo / 2 + unit * 0.016;
  const candidates: [number, number][] = [
    [mx + gap, my - panelH / 2], // 右
    [mx - gap - panelW, my - panelH / 2], // 左
    [mx - panelW / 2, my + gap], // 下
    [mx - panelW / 2, my - gap - panelH], // 上
  ];
  const fits = ([x, y]: [number, number]) => {
    if (x < margin || y < margin) return false;
    if (x + panelW > width - margin || y + panelH > height - margin) return false;
    if (!avoid) return true;
    // 凡例とはマージン分あけて判定する。角がぎりぎり接すると窮屈に見えるため
    return !(
      x < avoid.x + avoid.w + margin &&
      x + panelW > avoid.x - margin &&
      y < avoid.y + avoid.h + margin &&
      y + panelH > avoid.y - margin
    );
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const [panelX, panelY] = candidates.find(fits) ?? [
    clamp(mx + gap, margin, width - margin - panelW),
    clamp(my - panelH / 2, margin, height - margin - panelH),
  ];

  const items = rows.map(([body], i) => {
    // グリフはベースライン原点。行中央から視覚的に揃う位置に置く
    const baseline = panelY + padY + rowH * (i + 0.5) + fontSize * 0.36;
    return `<g transform="translate(${p(panelX + padX)} ${p(baseline)}) scale(${glyphScale.toFixed(4)})" fill="${PANEL_TEXT}">${body}</g>`;
  });

  // ✕ を最後に描く。パネルがキャンバス端へ寄せられて重なっても隠れないように
  return (
    panelRect({ x: panelX, y: panelY, w: panelW, h: panelH }, fontSize * 0.35) +
    items.join("") +
    mark
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

  const epiParam = url.searchParams.get("epi");
  let epicenter: Epicenter | null = null;
  if (epiParam !== null) {
    epicenter = parseEpicenter(epiParam);
    if (epicenter === null) {
      return bad(
        `epi は「緯度,経度」で指定してください(例 epi=32.7545,130.762。緯度 ${EPI_LAT_MIN}〜${EPI_LAT_MAX} / 経度 ${EPI_LON_MIN}〜${EPI_LON_MAX})`,
      );
    }
  }

  const intParam = url.searchParams.get("int");
  let intensity: string | null = null;
  if (intParam !== null) {
    intensity = parseIntensity(intParam);
    if (intensity === null) {
      return bad(`int は ${INTENSITY_ORDER.join(" / ")} のいずれかです`);
    }
  }

  // EEW の予想震度は上限が決まらないことがある(電文の forecastMaxInt.to = "over")。
  // 投稿本文の「震度5弱程度以上」と画像の表記が食い違わないようにする
  const overParam = url.searchParams.get("over");
  if (overParam !== null && overParam !== "1" && overParam !== "true") {
    return bad("over は 1 / true で指定してください(予想震度の上限が決まらないとき)");
  }
  const over = overParam !== null;
  if (over && intensity === null) {
    return bad("over は int(震度)と一緒に指定してください");
  }

  const magParam = url.searchParams.get("mag");
  let magnitude: number | null = null;
  if (magParam !== null) {
    magnitude = parseMagnitude(magParam);
    if (magnitude === null) return bad("mag は 0〜10 の数値で指定してください(例 mag=7.3)");
  }

  // ラベルは ✕ に添えるものなので、震源が無いと置き場所が決まらない
  if (!epicenter && (intensity !== null || magnitude !== null)) {
    return bad("int / mag は epi(震源の緯度経度)と一緒に指定してください");
  }

  const lines: string[] = [];
  if (intensity !== null) lines.push(`震度${intensity}${over ? "以上" : ""}`);
  if (magnitude !== null) lines.push(`M${magnitude.toFixed(1)}`);

  const vp = viewportFor(width, height, regionFor(prefs, epicenter, view === "japan"));
  const legend = buildLegend(width, height, prefs);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${BG_COLOR}"/>` +
    buildMap(prefs, vp) +
    legend.svg +
    (epicenter ? buildEpicenter(width, height, vp, epicenter, lines, legend.rect) : "") +
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
