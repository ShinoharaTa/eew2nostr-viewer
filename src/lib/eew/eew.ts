// 緊急地震速報の電文（nostr kind 7078 / d タグ eew_alert_system_by_shino3）を
// 画面で使う形に直す。
//
// 形式は実際にリレーから取った200件で確認した（2026-08-12）。
// このファイルは意図的に import を持たない。Node から直接読んでテストできるようにするため。

export interface EewCoordinate {
  lat: number;
  lon: number;
}

export interface EewReport {
  /** 同じ地震の続報は同じ eventId になる */
  eventId: string;
  /** 第何報か。電文では文字列で入っている */
  serial: number;
  /** 発表時刻ではなく地震の発生時刻 */
  originTime: string;
  /** 警報か予報か。警報は画面を占有する */
  isWarning: boolean;
  isCanceled: boolean;
  isLastInfo: boolean;
  hypocenter: string;
  coordinate: EewCoordinate | null;
  /** km。電文では文字列 */
  depthKm: number | null;
  magnitude: number | null;
  /** 電文の生の震度表記。"5-" や "over" が入る */
  maxIntRaw: string | null;
  /** 表示用。"5弱" や "不明" */
  maxIntLabel: string;
  /** 並べ替え用の強さ。不明は -1 */
  maxIntRank: number;
}

/** 震度の表記ゆれを表示用に直す */
export function intensityLabel(raw: string | null | undefined): string {
  if (!raw || raw === "over") return "不明";
  if (raw === "5-") return "5弱";
  if (raw === "5+") return "5強";
  if (raw === "6-") return "6弱";
  if (raw === "6+") return "6強";
  return raw;
}

/** 震度の強さ。並べ替えと閾値の判定に使う。不明は -1 */
export function intensityRank(raw: string | null | undefined): number {
  const table: Record<string, number> = {
    "1": 1, "2": 2, "3": 3, "4": 4,
    "5-": 5, "5+": 6, "6-": 7, "6+": 8, "7": 9,
  };
  if (!raw) return -1;
  return table[raw] ?? -1;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 電文の content（JSON 文字列）を EewReport にする。
 * 形が違えば null を返す。壊れた1件で画面を落とさないため。
 *
 * body.intensity は存在しないことがある（実データ200件中1件）。
 * 震源が特定できていない段階の速報がこれにあたる。
 */
export function parseEew(content: string): EewReport | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const body = raw.body as Record<string, unknown> | undefined;
  const eventId = typeof raw.eventId === "string" ? raw.eventId : null;
  if (!body || !eventId) return null;

  const eq = body.earthquake as Record<string, unknown> | undefined;
  const hypo = eq?.hypocenter as Record<string, unknown> | undefined;
  const coord = hypo?.coordinate as Record<string, unknown> | undefined;
  const lat = num((coord?.latitude as Record<string, unknown> | undefined)?.value);
  const lon = num((coord?.longitude as Record<string, unknown> | undefined)?.value);

  const intensity = body.intensity as Record<string, unknown> | undefined;
  const maxIntRaw =
    ((intensity?.forecastMaxInt as Record<string, unknown> | undefined)?.to as string) ?? null;

  return {
    eventId,
    serial: num(raw.serialNo) ?? 0,
    originTime: (eq?.originTime as string) ?? "",
    isWarning: body.isWarning === true,
    isCanceled: body.isCanceled === true,
    isLastInfo: body.isLastInfo === true,
    hypocenter: (hypo?.name as string) ?? "震源調査中",
    coordinate: lat !== null && lon !== null ? { lat, lon } : null,
    depthKm: num((hypo?.depth as Record<string, unknown> | undefined)?.value),
    magnitude: num((eq?.magnitude as Record<string, unknown> | undefined)?.value),
    maxIntRaw,
    maxIntLabel: intensityLabel(maxIntRaw),
    maxIntRank: intensityRank(maxIntRaw),
  };
}

/**
 * 同じ地震の続報をまとめ、地震ごとに最新の報だけ残す。
 * 新しい地震が先。
 */
export function latestPerEvent(reports: EewReport[]): EewReport[] {
  const byEvent: Record<string, EewReport> = {};
  for (const r of reports) {
    const cur = byEvent[r.eventId];
    if (!cur || r.serial > cur.serial) byEvent[r.eventId] = r;
  }
  return Object.values(byEvent).sort(
    (a, b) => Date.parse(b.originTime) - Date.parse(a.originTime),
  );
}

/** 画面を占有して知らせる対象か */
export const TAKEOVER_MIN_RANK = intensityRank("5-");
export const TAKEOVER_WINDOW_MS = 3 * 60 * 1000;

/**
 * 画面を占有すべきかどうか。
 *
 * 予報は頻繁に流れる（実データでは直近で35地震ぶん）。
 * すべてで画面を覆うと、本当に危ないときに無視されるようになる。
 * 警報、または最大震度5弱以上の予報に限る。
 *
 * 取消が来たら即座に降ろす。発生から一定時間が過ぎたものも降ろす。
 */
export function shouldTakeOver(r: EewReport, now: number = Date.now()): boolean {
  if (r.isCanceled) return false;
  if (!r.isWarning && r.maxIntRank < TAKEOVER_MIN_RANK) return false;
  const origin = Date.parse(r.originTime);
  if (!Number.isFinite(origin)) return false;
  return now - origin < TAKEOVER_WINDOW_MS;
}
