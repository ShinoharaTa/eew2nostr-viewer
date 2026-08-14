// 防災ステータスイベント (kind 30830) を購読する。
// 仕様: eew2nostr の docs/status-events.md

import {
  BOSAI_PUBKEY,
  BOSAI_RELAY,
  BOSAI_STATUS_KIND,
  parseBosaiStatus,
  type BosaiStatus,
} from "./status";

export interface BosaiSubscription {
  close(): void;
}

/**
 * 防災ステータスを購読する。
 *
 * addressable event なので、同じ key の更新は新しいイベントとして届く。
 * 呼び出し側が古い方を残さないよう、key ごとに created_at の新しい方だけを通す。
 *
 * authors を必ず固定する。kind 30830 は誰でも発行できるため、
 * 固定しないと第三者が偽のアラートを流せてしまう。
 */
export async function subscribeBosaiStatus(
  onStatus: (status: BosaiStatus) => void,
  opts: { relays?: string[]; limit?: number; onEose?: () => void } = {},
): Promise<BosaiSubscription> {
  const { relays = [BOSAI_RELAY], limit = 800 } = opts;

  // nostr-tools はブラウザ専用の作りなので、SSR のモジュールグラフに入れない
  const { SimplePool } = await import("nostr-tools/pool");
  const pool = new SimplePool();

  // key ごとの最新 created_at。リレーを複数にしたときの重複と、
  // 古い版が後から届く場合に備える
  const seenAt = new Map<string, number>();

  const sub = pool.subscribe(
    relays,
    {
      kinds: [BOSAI_STATUS_KIND],
      authors: [BOSAI_PUBKEY],
      limit,
    },
    {
      onevent(ev: { content: string; created_at: number; tags: string[][] }) {
        const status = parseBosaiStatus(ev.content);
        // 移行前の旧形式と壊れたものはここで落ちる
        if (!status) return;
        const prev = seenAt.get(status.key);
        if (prev !== undefined && prev >= ev.created_at) return;
        seenAt.set(status.key, ev.created_at);
        onStatus(status);
      },
      // 溜まっている過去分を読み終えた合図。呼び出し側が
      // 「再生」と「新着」を区別するために使う
      oneose() {
        opts.onEose?.();
      },
    },
  );

  return {
    close() {
      try {
        sub.close();
      } catch {
        // 閉じられなくても実害はない
      }
      pool.close(relays);
    },
  };
}
