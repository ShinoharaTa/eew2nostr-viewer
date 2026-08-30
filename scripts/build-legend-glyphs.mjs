// 凡例テキスト(都道府県名など)のグリフをパス化して JSON にする。
//
// サーバーレス環境には日本語フォントが無く、sharp(librsvg)の <text> は
// 豆腐になる。必要な文字列は有限(47都道府県名 + 「他n県」)なので、
// ビルド時にアウトラインをパスへ変換して同梱し、実行時のフォント依存を無くす。
//
// フォント: Noto Sans CJK JP Bold(SIL Open Font License 1.1)
// 再生成: node scripts/build-legend-glyphs.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import opentype from "opentype.js";

const FONT_URL =
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf";
const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/server/legend-glyphs.json",
);

// パス座標のフォントサイズ。利用側はこれを基準に scale する
const FONT_SIZE = 100;

// 県名は手打ちせず、地図パスと同じデータ源(japan.topojson の nam_ja)から
// 導出する。コードと名前の対応ずれを構造的に防ぐため
const TOPO_URL =
  "https://raw.githubusercontent.com/dataofjapan/land/master/japan.topojson";

async function loadPrefNames() {
  const res = await fetch(TOPO_URL);
  if (!res.ok) throw new Error(`県名データのダウンロード失敗: ${res.status}`);
  const topo = await res.json();
  const names = {};
  for (const geom of topo.objects.japan.geometries) {
    names[geom.properties.id] = geom.properties.nam_ja;
  }
  if (Object.keys(names).length !== 47) {
    throw new Error(`県名が47件ではない: ${Object.keys(names).length}`);
  }
  return names;
}

const PREF_NAMES = await loadPrefNames();

// 「他n県」の組み立てに使う1文字グリフ
const EXTRA_CHARS = "他県0123456789";

console.log("フォントをダウンロード中...");
const res = await fetch(FONT_URL);
if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);
const font = opentype.parse(await res.arrayBuffer());

// ベースライン原点・FONT_SIZE でのアウトラインと送り幅を記録する
function render(text) {
  const path = font.getPath(text, 0, 0, FONT_SIZE);
  const width = font.getAdvanceWidth(text, FONT_SIZE);
  // 小数1桁で十分(1200px 描画で 0.1px 未満の誤差)
  const d = path
    .toPathData(1)
    .replace(/(\d+\.\d)\d+/g, "$1");
  return { d, w: Math.round(width * 10) / 10 };
}

const names = {};
for (const [code, name] of Object.entries(PREF_NAMES)) {
  names[code] = render(name);
}
const chars = {};
for (const ch of EXTRA_CHARS) {
  chars[ch] = render(ch);
}

const out = {
  font: "Noto Sans CJK JP Bold (OFL-1.1)",
  fontSize: FONT_SIZE,
  // 行送り・上下配置の計算に使う代表メトリクス(FONT_SIZE 基準)
  ascender: Math.round((font.ascender / font.unitsPerEm) * FONT_SIZE),
  descender: Math.round((font.descender / font.unitsPerEm) * FONT_SIZE),
  names,
  chars,
};

writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(
  `書き出し: ${OUT_PATH} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`,
);
