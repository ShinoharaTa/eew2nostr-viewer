// 国土交通省「重ねるハザードマップ」のラスタタイル。
//
// 配信元・ズーム範囲は 2026-08-12 に実測した。種別ごとに上限ズームが違い、
// とくに地すべりは z11 までしか無い。maxNativeZoom を指定して、それ以上に
// 拡大したときは低いズームのタイルを引き伸ばして使う。
// 指定しないとタイルが 404 になり、拡大した瞬間にレイヤーが消える。
// 「消えた」を「危険が無い」と読まれるのは避けたい。
//
// 出典表示は利用条件なので、レイヤーを出したら必ず出典も出すこと。

export interface HazardTileDef {
  id: string;
  label: string;
  /** disaportaldata.gsi.go.jp/raster/{path}/{z}/{x}/{y}.png */
  paths: string[];
  /** タイルが実在する上限ズーム。これを超えると引き伸ばして表示する */
  maxNativeZoom: number;
  /** これより広域では表示しない。全国表示で出しても読めず、負荷だけかかる */
  minZoom: number;
  color: string;
}

export const HAZARD_TILES: HazardTileDef[] = [
  {
    id: "flood",
    label: "洪水浸水想定",
    paths: ["01_flood_l2_shinsuishin_data"],
    maxNativeZoom: 17,
    minZoom: 8,
    color: "#4a86c8",
  },
  {
    id: "tsunami",
    label: "津波浸水想定",
    paths: ["04_tsunami_newlegend_data"],
    maxNativeZoom: 17,
    minZoom: 8,
    color: "#3fa3a3",
  },
  {
    id: "hightide",
    label: "高潮浸水想定",
    paths: ["03_hightide_l2_shinsuishin_data"],
    maxNativeZoom: 17,
    minZoom: 8,
    color: "#7b6bc4",
  },
  {
    // 土砂災害警戒区域は3種で1組。まとめて1つのレイヤーとして扱う。
    // 地すべりだけ上限が z11 なので、重ねるときは種別ごとに maxNativeZoom を変える
    id: "sediment",
    label: "土砂災害警戒区域",
    paths: ["05_dosekiryukeikaikuiki", "05_kyukeishakeikaikuiki", "05_jisuberikeikaikuiki"],
    maxNativeZoom: 17,
    minZoom: 8,
    color: "#b5793f",
  },
];

/** 種別ごとの上限ズーム。実測値。指定が無いものは maxNativeZoom を使う */
export const PATH_MAX_NATIVE_ZOOM: Record<string, number> = {
  "05_jisuberikeikaikuiki": 11,
};

export const HAZARD_TILE_BASE = "https://disaportaldata.gsi.go.jp/raster";

export const HAZARD_ATTRIBUTION = "ハザードマップ: 国土交通省 ハザードマップポータルサイト";

export function hazardTileUrl(path: string): string {
  return `${HAZARD_TILE_BASE}/${path}/{z}/{x}/{y}.png`;
}
