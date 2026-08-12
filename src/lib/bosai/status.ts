// eew2nostr が Nostr に記録する防災ステータスイベント (kind 30830) を読む。
// 仕様: eew2nostr の docs/status-events.md
//
// このファイルは意図的に import を持たない。Node から直接読んでテストできるようにするため。

export const BOSAI_STATUS_KIND = 30830;
export const BOSAI_RELAY = "wss://relay-jp.shino3.net";

/**
 * 発行者の公開鍵。
 *
 * kind 30830 は誰でも発行できる。author を固定しないと、
 * 第三者が同じ kind とタグで偽のアラートを流せてしまう。
 * 防災情報を出す画面でこれは許容できないので、購読時に必ず authors で絞る。
 */
export const BOSAI_PUBKEY =
  "0955d4241024ed1fb0fb5f0607741a3b82ceae940413e566322f9d61cc842def";

/** content.schema の接頭辞。これが無いものは移行前の旧形式 */
export const BOSAI_SCHEMA_PREFIX = "jp.shino3.bosai.status/";

export type Hazard =
  | "eew"
  | "earthquake"
  | "tsunami"
  | "volcano"
  | "weather"
  | "sediment"
  | "flood"
  | "tornado"
  | "heavy-rain"
  | "megaquake";

export type AlertStatus = "active" | "finalized" | "resolved" | "cancelled";
export type Severity = "emergency" | "warning" | "advisory" | "info";
export type AlertKind = "forecast" | "observed" | "action";

export interface BosaiArea {
  name: string;
  code: string;
  type: string;
}

export interface BosaiStatus {
  key: string;
  hazard: Hazard;
  kind: AlertKind;
  severity: Severity;
  status: AlertStatus;
  headline: string;
  publishedAt: string;
  updatedAt: string;
  expiresAt: string | null;
  area: BosaiArea | null;
  detail: Record<string, unknown>;
}

export const SEVERITY_RANK: Record<Severity, number> = {
  emergency: 3,
  warning: 2,
  advisory: 1,
  info: 0,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  emergency: "特別警報・切迫",
  warning: "警報",
  advisory: "注意報",
  info: "参考",
};

// 気象庁の配色指針に沿う。装飾ではなく段階の符号化
export const SEVERITY_COLOR: Record<Severity, string> = {
  emergency: "#a50021",
  warning: "#ff2800",
  advisory: "#f2e700",
  info: "#7b868c",
};

export const HAZARD_LABEL: Record<Hazard, string> = {
  eew: "緊急地震速報",
  earthquake: "地震",
  tsunami: "津波",
  volcano: "火山",
  weather: "気象警報・注意報",
  sediment: "土砂災害",
  flood: "洪水",
  tornado: "竜巻",
  "heavy-rain": "記録的短時間大雨",
  megaquake: "南海トラフ・後発地震",
};

/**
 * 都道府県コードに束ねられる地域区分。
 *
 * 仕様書のとおり、この3つだけが code の先頭2桁を JIS X 0401 の
 * 都道府県コードとして扱える。震央地名・津波予報区・火山・河川は
 * 都道府県に対応づかない（複数県にまたがる、海域である等）。
 */
const PREFECTURE_AREA_TYPES = new Set(["一次細分区域", "市町村等", "府県予報区"]);

/** 都道府県コードを返す。束ねられない区分なら null */
export function prefectureCodeOfArea(area: BosaiArea | null): string | null {
  if (!area || !PREFECTURE_AREA_TYPES.has(area.type)) return null;
  const code = area.code.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

const HAZARDS = new Set<string>([
  "eew", "earthquake", "tsunami", "volcano", "weather",
  "sediment", "flood", "tornado", "heavy-rain", "megaquake",
]);
const STATUSES = new Set<string>(["active", "finalized", "resolved", "cancelled"]);
const SEVERITIES = new Set<string>(["emergency", "warning", "advisory", "info"]);

/**
 * イベントの content を BosaiStatus にする。形が違えば null。
 *
 * 移行前の旧形式（schema フィールドが無く、posts / deliveries などの
 * 内部フィールドを含む）が実データに混ざっている（確認時 500件中126件）。
 * schema の有無で判別して捨てる。replaceable なので、そのイベントの
 * 次の更新で新形式に置き換わる。
 */
export function parseBosaiStatus(content: string): BosaiStatus | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const schema = raw.schema;
  if (typeof schema !== "string" || !schema.startsWith(BOSAI_SCHEMA_PREFIX)) {
    return null;
  }

  const { key, hazard, kind, severity, status } = raw as Record<string, string>;
  if (typeof key !== "string") return null;
  if (!HAZARDS.has(hazard) || !STATUSES.has(status) || !SEVERITIES.has(severity)) {
    return null;
  }

  const areaRaw = raw.area as Record<string, unknown> | null | undefined;
  const area: BosaiArea | null =
    areaRaw && typeof areaRaw.code === "string"
      ? {
          name: String(areaRaw.name ?? ""),
          code: areaRaw.code,
          type: String(areaRaw.type ?? ""),
        }
      : null;

  return {
    key,
    hazard: hazard as Hazard,
    kind: (kind as AlertKind) ?? "forecast",
    severity: severity as Severity,
    status: status as AlertStatus,
    headline: String(raw.headline ?? ""),
    publishedAt: String(raw.publishedAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : null,
    area,
    detail: (raw.detail as Record<string, unknown>) ?? {},
  };
}

/** 発表中とみなすか。地図と一覧に出す条件 */
export function isActive(s: BosaiStatus): boolean {
  return s.status === "active" || s.status === "finalized";
}

/**
 * 地図に置けるか。
 * 震度速報の第一報や取消報など、対象地域が無いものは地図から外す。
 */
export function isMappable(s: BosaiStatus): boolean {
  return s.area !== null;
}

/**
 * 都道府県ごとに、最も高い緊急度を求める。地図の塗り分けに使う。
 *
 * 同じ市区町村が複数の粒度で同時に出る（気象警報は一次細分区域、
 * 土砂災害警戒情報は市町村等）。件数を数えると二重計上になるので、
 * ここでは数えず「最も高い段階」だけを採る。
 */
export function topSeverityByPrefecture(list: BosaiStatus[]): Map<string, Severity> {
  const out = new Map<string, Severity>();
  for (const s of list) {
    if (!isActive(s)) continue;
    const pref = prefectureCodeOfArea(s.area);
    if (!pref) continue;
    const cur = out.get(pref);
    if (!cur || SEVERITY_RANK[s.severity] > SEVERITY_RANK[cur]) {
      out.set(pref, s.severity);
    }
  }
  return out;
}

/** 一次細分区域ごとの最も高い緊急度。予報区単位で塗るときに使う */
export function topSeverityByArea(list: BosaiStatus[]): Map<string, Severity> {
  const out = new Map<string, Severity>();
  for (const s of list) {
    if (!isActive(s) || !s.area) continue;
    if (s.area.type !== "一次細分区域") continue;
    const cur = out.get(s.area.code);
    if (!cur || SEVERITY_RANK[s.severity] > SEVERITY_RANK[cur]) {
      out.set(s.area.code, s.severity);
    }
  }
  return out;
}
