// 状況別ワークスペース。
// 状況ごとに「開くウィンドウ・レイヤー・地図の寄せ先」をまとめて切り替える。
//
// 値の import を持たせていない（型だけ）。Node から直接読んでテストできるようにするため。

import type { BosaiStatus, Hazard, Severity } from "../bosai/status";

export type Situation = "normal" | "rain" | "quake" | "tsunami";

export interface WorkspaceDef {
  id: Situation;
  label: string;
  /** 有効にするレイヤー。ここに無いものは切る */
  layers: string[];
  /** 開くウィンドウ */
  windows: string[];
  /** 地図を寄せる対象。null なら全国のまま */
  focus: { hazards: Hazard[]; minSeverity: Severity } | null;
}

export const WORKSPACES: WorkspaceDef[] = [
  {
    id: "normal",
    label: "平常",
    layers: ["warning"],
    windows: ["log"],
    focus: null,
  },
  {
    id: "rain",
    label: "大雨",
    // 浸水想定と土砂の区域は別カテゴリ（ハザードマップモード）に分けたので
    // ここでは重ねない。発令情報に静的な参照情報を混ぜない
    layers: ["warning"],
    windows: ["detail", "log"],
    focus: { hazards: ["weather", "sediment", "flood"], minSeverity: "warning" },
  },
  {
    id: "quake",
    label: "地震",
    layers: ["warning", "quake"],
    windows: ["detail", "log"],
    focus: { hazards: ["eew", "earthquake"], minSeverity: "info" },
  },
  {
    id: "tsunami",
    label: "津波",
    layers: ["warning", "tsunami"],
    windows: ["detail", "log"],
    focus: { hazards: ["tsunami"], minSeverity: "info" },
  },
];

const RANK: Record<Severity, number> = { emergency: 3, warning: 2, advisory: 1, info: 0 };

/** 地震とみなす発表の新しさ。これを過ぎたら平常に戻る */
export const QUAKE_WINDOW_MS = 10 * 60 * 1000;

const isOn = (s: BosaiStatus) => s.status === "active" || s.status === "finalized";

/**
 * いまの状況を判定する。
 *
 * 優先順は 津波 > 地震 > 大雨 > 平常。
 * 津波は注意報でも避難を要するため段階を問わず最優先にする
 * （仕様書のとおり、津波は注意報でも severity が warning に格上げされている）。
 *
 * 地震だけ時間で切る。震源の情報は出っぱなしになるため、
 * 発表からの経過で見ないと地震の配置から戻れなくなる。
 */
export function detectSituation(list: BosaiStatus[], now: number = Date.now()): Situation {
  let quake = false;
  let rain = false;

  for (const s of list) {
    if (!isOn(s)) continue;

    if (s.hazard === "tsunami") return "tsunami";

    if (s.hazard === "eew" || s.hazard === "earthquake") {
      const at = Date.parse(s.publishedAt);
      if (Number.isFinite(at) && now - at < QUAKE_WINDOW_MS) quake = true;
    }

    if (
      (s.hazard === "weather" || s.hazard === "sediment" || s.hazard === "flood") &&
      RANK[s.severity] >= RANK.warning
    ) {
      rain = true;
    }
  }

  if (quake) return "quake";
  if (rain) return "rain";
  return "normal";
}

/** 地図を寄せる対象を選ぶ。段階の高いものを優先し、同点なら新しいもの */
export function focusTargets(def: WorkspaceDef, list: BosaiStatus[]): BosaiStatus[] {
  if (!def.focus) return [];
  const min = RANK[def.focus.minSeverity];
  return list
    .filter(
      (s) =>
        isOn(s) &&
        s.area !== null &&
        def.focus!.hazards.includes(s.hazard) &&
        RANK[s.severity] >= min,
    )
    .sort(
      (a, b) =>
        RANK[b.severity] - RANK[a.severity] ||
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    );
}
