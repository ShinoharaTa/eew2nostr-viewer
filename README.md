# EEW on Nostr Kind: 30078 viewer

Nostr リレー上に流れる緊急地震速報(kind 7078 / `#d` = `eew_alert_system_by_shino3`)を表示するビューアです。

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
