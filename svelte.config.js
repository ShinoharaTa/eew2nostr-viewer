import adapterNode from "@sveltejs/adapter-node";
import adapterVercel from "@sveltejs/adapter-vercel";

// 本番は Vercel、ローカルと自己ホストは Node サーバーとして動かす。
// Vercel は .vercel/output を、adapter-node は build/ を出力するため
// 環境変数 VERCEL の有無で切り替える。
// runtime を明示しないと adapter-vercel がビルド実行時の Node から
// 推測するため、Vercel 非対応バージョン(25 系など)でビルドすると落ちる。
const adapter = process.env.VERCEL
  ? adapterVercel({ runtime: "nodejs24.x" })
  : adapterNode();

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [],
  kit: {
    adapter,
  },
};

export default config;
