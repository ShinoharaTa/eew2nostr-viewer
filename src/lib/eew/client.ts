// 緊急地震速報を nostr リレーから購読する。
//
// 気象警報が気象庁の JSON をポーリングして取るのに対し、
// 緊急地震速報は秒を争うので WebSocket で押し出してもらう。
// 取得経路も更新の仕方も別系統になる。

import { parseEew, type EewReport } from "./eew";

export const EEW_RELAYS = [
  "wss://relay-jp.shino3.net",
  "wss://r.kojira.io",
  "wss://yabu.me",
];

export const EEW_D_TAG = "eew_alert_system_by_shino3";

export interface EewSubscription {
  close(): void;
}

/**
 * 直近の緊急地震速報を購読する。
 *
 * @param sinceSeconds 何秒前まで遡って取るか。既定は24時間。
 *   起動直後に何も出ないと動いているか分からないので、過去ぶんも拾う。
 */
export async function subscribeEew(
  onReport: (report: EewReport) => void,
  opts: { sinceSeconds?: number; relays?: string[] } = {},
): Promise<EewSubscription> {
  const { sinceSeconds = 24 * 3600, relays = EEW_RELAYS } = opts;

  // nostr-tools はブラウザ専用の作りなので、SSR のモジュールグラフに入れない
  const { SimplePool } = await import("nostr-tools/pool");
  const pool = new SimplePool();

  const sub = pool.subscribe(
    relays,
    {
      kinds: [7078],
      "#d": [EEW_D_TAG],
      since: Math.floor(Date.now() / 1000) - sinceSeconds,
    },
    {
      onevent(ev: { content: string }) {
        const report = parseEew(ev.content);
        // 壊れた1件で画面を落とさない。形が違うものは捨てる
        if (report) onReport(report);
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
