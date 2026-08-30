# 防災ダッシュボード

気象庁の防災情報を地図上で横断して見るダッシュボードです。
全国の白地図から県を選ぶと、その県に発表されている警報・注意報が並びます。

## データ源

いずれも気象庁が公開しているもので、CORS が開いているためブラウザから直接取得しています。

| データ | 入手先 |
| --- | --- |
| 地域階層の定義 | `jma.go.jp/bosai/common/const/area.json` |
| 予報区ポリゴン | `jma.go.jp/bosai/common/const/geojson/class10s.json` |
| 警報・注意報 | `jma.go.jp/bosai/warning/data/warning/{府県コード}.json` |

地図は Leaflet で描いています。背景タイルは使わず、予報区のポリゴンそのものを白地図としています。

> 緊急地震速報の表示は現在ありません。nostr 経由の別系統のため、
> ダッシュボードへの統合は別途対応します。

## 画像 API

発令エリアを強調した日本地図をサーバーサイドでレンダリングして返します。
eew2nostr が Nostr 投稿に画像 URL を載せる用途を想定しています。
クエリだけで画像が一意に決まるため、CDN に長期キャッシュされます。

```
GET /images/alert.webp?pref=13:red&pref=14:red&pref=11:yellow
```

| パラメータ | 内容 |
| --- | --- |
| `pref` | `コード` または `コード:色`。コードは都道府県コード(JIS X 0401、1〜47)。繰り返し指定・カンマ区切りの両方可。色を省略すると `key` の色。省略時は強調なしの全国図 |
| `key` | 色を省略した `pref` に使う既定色(既定 `red`) |
| `w` / `h` | 画像サイズ(100〜2000)。既定は OGP 向けの 1200×630 |
| `view` | `auto`(既定): 発令県の範囲へ自動ズーム / `japan`: 全国図固定 |

色は警戒レベルの6色トークンで指定します(eew2nostr#35・#40 で決めた
「色 = 警戒レベル」の体系。どの現象を何色にするかの判定は投稿側の責務)。

| トークン | 色 | 意味 |
| --- | --- | --- |
| `black` | #0C000C | レベル5相当(特別警報・氾濫発生) |
| `purple` | #AA00AA | レベル4相当(大津波警報・氾濫危険など) |
| `red` | #FF2800 | レベル3相当(警報・津波警報など) |
| `orange` | #FF9900 | 震度4〜5強・噴火レベル3 |
| `yellow` | #F2E700 | レベル2相当(注意報など) |
| `white` | #FFFFFF | レベル1 |

画像の右上には「●(色丸) 県名」の凡例が指定順に最大8件入り、溢れた分は「他n県」に丸められます。

地図形状の出典: [地球地図日本](https://www.gsi.go.jp/kankyochiri/gm_jpn.html)(国土地理院)を変換した
[dataofjapan/land](https://github.com/dataofjapan/land) の japan.topojson を簡略化して利用しています。
再生成は `node scripts/build-prefecture-paths.mjs`。
凡例の文字は Noto Sans CJK JP(SIL Open Font License 1.1)のアウトラインを
パス化して同梱しています(`node scripts/build-legend-glyphs.mjs` で再生成)。

## セットアップ

```sh
npm install
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー(`0.0.0.0` で待ち受け) |
| `npm run build` | 本番ビルド。`build/` に Node サーバーを出力 |
| `npm start` | ビルド済みサーバーを起動。ポートは `PORT`(既定 3000) |
| `npm run preview` | ビルド結果を Vite でプレビュー |
| `npm run check` | svelte-check による型チェック |
| `npm run lint` | ESLint |

## 本番

`@sveltejs/adapter-node` を使っているので、ビルド後は Node だけで動きます。

```sh
npm ci
npm run build
PORT=3000 node build
```
