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
