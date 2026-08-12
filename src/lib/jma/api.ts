// 気象庁の防災情報 JSON を取る。
// いずれも access-control-allow-origin: * が付いているのでブラウザから直接叩ける。
// プロキシは要らない。

import { type WarningLevel, warningLevel, LEVEL_RANK } from "./warningCodes";

const BASE = "https://www.jma.go.jp/bosai";

// ---- area.json ----

export interface AreaNode {
  name: string;
  enName: string;
  officeName?: string;
  parent?: string;
  children?: string[];
}

export interface AreaDict {
  centers: Record<string, AreaNode>;
  offices: Record<string, AreaNode>;
  class10s: Record<string, AreaNode>;
  class15s: Record<string, AreaNode>;
  class20s: Record<string, AreaNode>;
}

export function fetchAreas(fetcher: typeof fetch = fetch): Promise<AreaDict> {
  return json<AreaDict>(`${BASE}/common/const/area.json`, fetcher);
}

// ---- 予報区のポリゴン ----

export interface AreaFeatureProps {
  code: string;
  name: string;
  enName: string;
  /** 気象庁のデータには無い。塗り分けと選択のためクライアント側で付与する */
  prefCode?: string;
}

export type AreaGeoJson = GeoJSON.FeatureCollection<GeoJSON.MultiPolygon, AreaFeatureProps>;

// class10s は一次細分区域。警報が出る単位そのものなので、県で塗るより正確に描ける。
export function fetchClass10Geo(fetcher: typeof fetch = fetch): Promise<AreaGeoJson> {
  return json<AreaGeoJson>(`${BASE}/common/const/geojson/class10s.json`, fetcher);
}

// ---- 警報・注意報 ----

interface RawWarningArea {
  code: string;
  warnings: { code?: string; status: string }[];
}

interface RawWarning {
  reportDatetime: string;
  publishingOffice: string;
  headlineText?: string;
  areaTypes: { areas: RawWarningArea[] }[];
}

export interface AreaWarnings {
  areaCode: string;
  /** 発令中のものだけ。解除と「発表警報・注意報はなし」は除いてある */
  active: { code: string; status: string }[];
  /** 発令中で最も高い段階。無ければ null */
  top: WarningLevel | null;
}

export interface WarningReport {
  officeCode: string;
  reportedAt: string;
  publishingOffice: string;
  headline: string;
  /** 一次細分区域 (class10s) ごとの発令状況 */
  byArea: Map<string, AreaWarnings>;
}

/**
 * 府県予報区（offices のコード。東京なら 130000）の警報・注意報を取る。
 *
 * status には 発表 / 継続 / 解除 / 発表警報・注意報はなし が入る。
 * 解除を発令中として数えないこと。数えると解除された警報が地図に残り続ける。
 */
export async function fetchWarnings(
  officeCode: string,
  fetcher: typeof fetch = fetch,
): Promise<WarningReport> {
  const raw = await json<RawWarning>(
    `${BASE}/warning/data/warning/${officeCode}.json`,
    fetcher,
  );

  const byArea = new Map<string, AreaWarnings>();
  // areaTypes[0] が一次細分区域、[1] が市町村等。まずは一次細分区域だけ使う。
  for (const area of raw.areaTypes[0]?.areas ?? []) {
    const active = area.warnings.filter(
      (w): w is { code: string; status: string } =>
        typeof w.code === "string" && w.status !== "解除",
    );
    const top = active.reduce<WarningLevel | null>((best, w) => {
      const lv = warningLevel(w.code);
      return best === null || LEVEL_RANK[lv] > LEVEL_RANK[best] ? lv : best;
    }, null);
    byArea.set(area.code, { areaCode: area.code, active, top });
  }

  return {
    officeCode,
    reportedAt: raw.reportDatetime,
    publishingOffice: raw.publishingOffice,
    headline: raw.headlineText ?? "",
    byArea,
  };
}

// ---- 補助 ----

/** 予報区コードの先頭2桁が都道府県コード。011000 → 01 (北海道) */
export function prefectureCodeOf(areaCode: string): string {
  return areaCode.slice(0, 2);
}

/**
 * 府県予報区は都道府県と一対一ではない。
 * 北海道は8つ、沖縄は4つに分かれるため、先頭2桁だけでは予報区を特定できない。
 * area.json の class10s から親を辿って office を得る。
 */
export function officeOfClass10(areas: AreaDict, class10Code: string): string | null {
  return areas.class10s[class10Code]?.parent ?? null;
}

/** ある都道府県に属する府県予報区をすべて返す */
export function officesInPrefecture(areas: AreaDict, prefCode: string): string[] {
  return Object.keys(areas.offices).filter((code) => code.startsWith(prefCode));
}

/**
 * 都道府県ぶんの警報をまとめて取る。
 * 北海道のように複数の予報区に分かれる県があるため、1回の取得では足りない。
 * 一部の予報区が取れなくても、取れたぶんは返す。
 */
export async function fetchWarningsForPrefecture(
  areas: AreaDict,
  prefCode: string,
  fetcher: typeof fetch = fetch,
): Promise<{ reports: WarningReport[]; failed: string[] }> {
  const offices = officesInPrefecture(areas, prefCode);
  const settled = await Promise.allSettled(
    offices.map((code) => fetchWarnings(code, fetcher)),
  );
  const reports: WarningReport[] = [];
  const failed: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") reports.push(r.value);
    else failed.push(offices[i]);
  });
  return { reports, failed };
}

/**
 * 全国の警報を取る。府県予報区は58あるので、そのぶんの取得が走る。
 * 気象庁へ一度に投げると負荷をかけるため、同時実行を絞る。
 * 一部が失敗しても取れたぶんは返す。
 */
export async function fetchAllWarnings(
  areas: AreaDict,
  opts: { fetcher?: typeof fetch; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ reports: WarningReport[]; failed: string[] }> {
  const { fetcher = fetch, concurrency = 6, onProgress } = opts;
  const codes = Object.keys(areas.offices);
  const reports: WarningReport[] = [];
  const failed: string[] = [];
  let done = 0;
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= codes.length) return;
      try {
        reports.push(await fetchWarnings(codes[i], fetcher));
      } catch {
        failed.push(codes[i]);
      }
      onProgress?.(++done, codes.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, codes.length) }, () => worker()),
  );
  return { reports, failed };
}

/** 予報区コード -> 発令中で最も高い段階。地図の塗り分けに使う */
export function topLevelByArea(reports: WarningReport[]): Map<string, WarningLevel> {
  const out = new Map<string, WarningLevel>();
  for (const rep of reports) {
    for (const [code, w] of rep.byArea) {
      if (!w.top) continue;
      const cur = out.get(code);
      if (!cur || LEVEL_RANK[w.top] > LEVEL_RANK[cur]) out.set(code, w.top);
    }
  }
  return out;
}

async function json<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(url);
  if (!res.ok) {
    throw new Error(`気象庁のデータを取得できませんでした (${res.status}): ${url}`);
  }
  return (await res.json()) as T;
}
