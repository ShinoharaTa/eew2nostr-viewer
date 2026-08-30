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
GET /images/alert.webp?pref=42&pref=43&key=eew
```

| パラメータ | 内容 |
| --- | --- |
| `pref` | 都道府県コード(JIS X 0401、1〜47)。繰り返し指定・カンマ区切りの両方可。省略時は強調なしの全国図 |
| `key` | 強調色。`eew` / `warning` / `emergency` / `advisory` / `tsunami`(既定 `warning`) |
| `w` / `h` | 画像サイズ(100〜2000)。既定は OGP 向けの 1200×630 |
| `view` | `auto`(既定): 発令県の範囲へ自動ズーム / `japan`: 全国図固定 |

地図形状の出典: [地球地図日本](https://www.gsi.go.jp/kankyochiri/gm_jpn.html)(国土地理院)を変換した
[dataofjapan/land](https://github.com/dataofjapan/land) の japan.topojson を簡略化して利用しています。
再生成は `node scripts/build-prefecture-paths.mjs`。

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
