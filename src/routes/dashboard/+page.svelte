<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { browser } from "$app/environment";
import type { Map as LMap, GeoJSON as LGeoJSON, PathOptions, Layer } from "leaflet";
import type { Feature, MultiPolygon } from "geojson";
import "leaflet/dist/leaflet.css";
import {
  fetchAreas,
  fetchClass10Geo,
  fetchWarningsForPrefecture,
  prefectureCodeOf,
  type AreaDict,
  type AreaGeoJson,
  type AreaFeatureProps,
  type WarningReport,
} from "$lib/jma/api";
import { prefectureName } from "$lib/jma/prefectures";
import {
  LEVEL_COLOR,
  LEVEL_LABEL,
  LEVEL_RANK,
  warningLevel,
  warningName,
  type WarningLevel,
} from "$lib/jma/warningCodes";

type Phase = "loading" | "ready" | "error";

let phase = $state<Phase>("loading");
let errorText = $state("");
let areas = $state<AreaDict | null>(null);

let selectedPref = $state<string | null>(null);
let selectedName = $state("");
let reports = $state<WarningReport[]>([]);
let failedOffices = $state<string[]>([]);
let loadingPref = $state(false);

let mapEl: HTMLDivElement;
let map: LMap | null = null;
let areaLayer: LGeoJSON | null = null;

// 本土と南西諸島が収まる範囲。南鳥島(154E)や沖ノ鳥島(20.4N)まで含めると
// 地図が極端に小さくなるため、初期表示からは外す（移動すれば見える）
const HOME_BOUNDS: [[number, number], [number, number]] = [
  [24.0, 122.9],
  [45.7, 146.2],
];

const BASE_STYLE: PathOptions = {
  color: "#41545c",
  weight: 0.6,
  fillColor: "#1e2a2f",
  fillOpacity: 1,
};
const SELECTED_STYLE: PathOptions = {
  color: "#7fb2c9",
  weight: 1.2,
  fillColor: "#2b3f4d",
  fillOpacity: 1,
};

// 選択中の県の、区域ごとの発令内容。□ブロックで並べる元
const blocks = $derived.by(() => {
  const out: {
    areaCode: string;
    areaName: string;
    items: { code: string; status: string; level: WarningLevel }[];
  }[] = [];
  for (const rep of reports) {
    for (const [areaCode, w] of rep.byArea) {
      if (w.active.length === 0) continue;
      const items = w.active
        .map((a) => ({ ...a, level: warningLevel(a.code) }))
        .sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level]);
      out.push({ areaCode, areaName: areas?.class10s[areaCode]?.name ?? areaCode, items });
    }
  }
  return out.sort((a, b) => LEVEL_RANK[b.items[0].level] - LEVEL_RANK[a.items[0].level]);
});

const quietAreas = $derived(
  reports.reduce(
    (n, r) => n + [...r.byArea.values()].filter((w) => w.active.length === 0).length,
    0,
  ),
);

const reportedAt = $derived(reports[0]?.reportedAt ?? "");

function restyle() {
  areaLayer?.eachLayer((l: Layer) => {
    const f = (l as Layer & { feature?: Feature<MultiPolygon, AreaFeatureProps> })
      .feature;
    if (!f) return;
    const on = selectedPref !== null && f.properties.prefCode === selectedPref;
    (l as Layer & { setStyle: (s: PathOptions) => void }).setStyle(
      on ? SELECTED_STYLE : BASE_STYLE,
    );
  });
}

async function selectPrefecture(prefCode: string) {
  if (!areas) return;
  selectedPref = prefCode;
  selectedName = prefectureName(prefCode);
  restyle();
  zoomToPrefecture(prefCode);

  loadingPref = true;
  reports = [];
  failedOffices = [];
  try {
    const res = await fetchWarningsForPrefecture(areas, prefCode);
    // 取得中に別の県へ切り替わっていたら捨てる
    if (selectedPref !== prefCode) return;
    reports = res.reports;
    failedOffices = res.failed;
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
  } finally {
    if (selectedPref === prefCode) loadingPref = false;
  }
}

function zoomToPrefecture(prefCode: string) {
  if (!map || !areaLayer) return;
  let bounds: ReturnType<LGeoJSON["getBounds"]> | null = null;
  areaLayer.eachLayer((l: Layer) => {
    const f = (l as Layer & { feature?: Feature<MultiPolygon, AreaFeatureProps> })
      .feature;
    if (!f || f.properties.prefCode !== prefCode) return;
    const b = (l as Layer & { getBounds: () => ReturnType<LGeoJSON["getBounds"]> }).getBounds();
    bounds = bounds ? bounds.extend(b) : b;
  });
  if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 9 });
}

function resetView() {
  selectedPref = null;
  reports = [];
  failedOffices = [];
  restyle();
  map?.fitBounds(HOME_BOUNDS, { padding: [2, 2] });
}

onMount(async () => {
  if (!browser) return;
  try {
    // leaflet は window に触れるので、SSR のモジュールグラフに入れず動的に読む
    const [mod, a, g] = await Promise.all([
      import("leaflet"),
      fetchAreas(),
      fetchClass10Geo(),
    ]);
    const L = mod.default ?? mod;
    areas = a;

    // 予報区コードから都道府県コードを持たせておく。選択に使う
    for (const f of (g as AreaGeoJson).features) {
      f.properties.prefCode = prefectureCodeOf(f.properties.code);
    }

    // 背景タイルは張らない。予報区のポリゴンそのものを白地図として描く
    const m = L.map(mapEl, {
      zoomControl: true,
      attributionControl: false,
      // 予報区の形が正しく読めればよいので、回転や傾きは要らない
      minZoom: 3,
      maxZoom: 12,
    });
    m.fitBounds(HOME_BOUNDS, { padding: [2, 2] });

    areaLayer = L.geoJSON(g as AreaGeoJson, {
      style: () => BASE_STYLE,
      onEachFeature: (feature, layer) => {
        const pref = (feature.properties as AreaFeatureProps).prefCode;
        if (!pref) return;
        layer.on("click", () => void selectPrefecture(pref));
        layer.bindTooltip((feature.properties as AreaFeatureProps).name, {
          sticky: true,
          direction: "top",
        });
      },
    }).addTo(m);

    map = m;
    phase = "ready";
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
    phase = "error";
  }
});

onDestroy(() => {
  map?.remove();
  map = null;
  areaLayer = null;
});

function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
</script>

<svelte:head><title>防災ダッシュボード</title></svelte:head>

<div class="board">
  <header class="bar">
    <span class="beacon" class:live={phase === "ready"}></span>
    <span class="brand">防災ダッシュボード</span>
    <span class="grow"></span>
    {#if selectedPref}
      <button class="ghost" onclick={resetView}>全国へ戻す</button>
    {/if}
  </header>

  <div class="mapwrap">
    <div class="map" bind:this={mapEl}></div>
    {#if phase === "loading"}
      <div class="overlay"><span>気象庁のデータを取得しています…</span></div>
    {:else if phase === "error"}
      <div class="overlay err">
        <strong>地図を表示できませんでした</strong>
        <span>{errorText}</span>
      </div>
    {/if}
    {#if phase === "ready" && !selectedPref}
      <div class="hint">地図の県をタップすると、発令中の警報・注意報が並びます</div>
    {/if}
    <div class="credit">出典: 気象庁</div>
  </div>

  <section class="deck">
    {#if !selectedPref}
      <div class="empty">県が選ばれていません</div>
    {:else}
      <div class="deck-head">
        <strong>{selectedName}</strong>
        {#if loadingPref}
          <span class="dim">取得中…</span>
        {:else}
          <span class="dim">{blocks.length} 区域で発令中 ／ {quietAreas} 区域は発表なし</span>
        {/if}
        <span class="grow"></span>
        {#if reportedAt}<span class="mono dim">{fmtTime(reportedAt)} 発表</span>{/if}
      </div>

      {#if failedOffices.length > 0}
        <p class="warn">
          一部の予報区を取得できませんでした（{failedOffices.join(", ")}）。表示は取得できたぶんのみです。
        </p>
      {/if}

      <div class="deck-body">
        {#if !loadingPref && blocks.length === 0}
          <div class="empty">発表中の警報・注意報はありません</div>
        {/if}
        {#each blocks as b (b.areaCode)}
          <div class="areablock">
            <div class="areaname">{b.areaName}</div>
            <div class="chips">
              {#each b.items as it (it.code)}
                <span class="chip lv-{it.level}" title={LEVEL_LABEL[it.level]}>
                  <span class="cname">{warningName(it.code)}</span>
                  {#if it.status === "発表"}<span class="fresh">発表</span>{/if}
                </span>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <div class="legend">
        {#each ["special", "warning", "advisory"] as lv (lv)}
          <span>
            <i style="background: {LEVEL_COLOR[lv as WarningLevel]}"></i>{LEVEL_LABEL[lv as WarningLevel]}
          </span>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style lang="scss">
.board {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #080b0d;
  color: #e2e9ec;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
}

.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: 52px;
  background: #172025;
  border-bottom: 1px solid #232f35;
}
.brand { font-weight: 700; letter-spacing: 0.02em; }
.grow { flex: 1; }
.beacon {
  width: 7px; height: 7px; border-radius: 50%;
  background: #5d6c73; flex: none;
  &.live { background: #2ed17f; box-shadow: 0 0 0 3px rgba(46, 209, 127, 0.16); }
}
.ghost {
  font: inherit; font-size: 13px; color: #90a0a7;
  background: transparent; border: 1px solid #35454d;
  border-radius: 3px; padding: 7px 12px; cursor: pointer; min-height: 34px;
  &:active { background: #1c262b; }
}

.mapwrap { flex: 1 1 62%; position: relative; min-height: 220px; }
.map { position: absolute; inset: 0; background: #0b1013; }

.overlay {
  position: absolute; inset: 0; z-index: 500;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; background: rgba(8, 11, 13, 0.86); color: #90a0a7; font-size: 14px;
  padding: 20px; text-align: center;
  &.err { color: #ff93a5; }
}
.hint {
  position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 500;
  background: rgba(8, 11, 13, 0.82); border: 1px solid #232f35;
  border-radius: 3px; padding: 6px 12px; font-size: 12px; color: #90a0a7;
  pointer-events: none; max-width: calc(100% - 24px); text-align: center;
}
.credit {
  position: absolute; left: 8px; bottom: 6px; z-index: 500;
  font-size: 10px; color: #5d6c73; pointer-events: none;
}

.deck {
  flex: 1 1 40%;
  display: flex; flex-direction: column;
  border-top: 1px solid #232f35;
  background: #12191d;
  min-height: 0;
}
.deck-head {
  flex: none;
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 9px 14px; border-bottom: 1px solid #232f35;
  background: #172025; font-size: 14px;
}
.dim { color: #90a0a7; font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.deck-body {
  flex: 1; overflow-y: auto; padding: 10px 14px;
  display: flex; flex-direction: column; gap: 12px;
}

.warn {
  margin: 0; padding: 8px 14px;
  background: #2a2210; color: #f0d68a; font-size: 12px;
  border-bottom: 1px solid #232f35;
}

.areablock { display: flex; flex-direction: column; gap: 5px; }
.areaname { font-size: 12px; color: #90a0a7; letter-spacing: 0.02em; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }

/* 警報は「区域 × 種別」で同時に複数出る。四角のブロックで並べると数と種類が一目で掴める */
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 10px; border-radius: 3px;
  font-size: 13px; font-weight: 700; min-height: 34px;
}
.cname { white-space: nowrap; }
.fresh {
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  padding: 1px 5px; border-radius: 2px; background: rgba(0, 0, 0, 0.28);
}
.lv-special { background: #a50021; color: #fff; }
.lv-warning { background: #ff2800; color: #fff; }
.lv-advisory { background: #f2e700; color: #241f00; }
.lv-other { background: #2b373d; color: #c8d3d8; }

.legend {
  flex: none;
  display: flex; gap: 14px; flex-wrap: wrap;
  padding: 8px 14px; border-top: 1px solid #232f35;
  font-size: 11px; color: #90a0a7;
  span { display: inline-flex; align-items: center; gap: 5px; }
  i { width: 9px; height: 9px; border-radius: 2px; }
}

.empty { padding: 24px 14px; color: #5d6c73; font-size: 13px; text-align: center; }

/* Leaflet の既定色を画面に合わせる */
:global(.leaflet-container) { background: #0b1013; outline: none; }
:global(.leaflet-control-zoom a) {
  background: #172025; color: #c8d3d8; border-color: #35454d;
}
:global(.leaflet-control-zoom a:hover) { background: #22303a; }
:global(.leaflet-tooltip) {
  background: #172025; color: #e2e9ec; border: 1px solid #35454d;
  box-shadow: none; font-size: 12px;
}
:global(.leaflet-tooltip-top::before) { border-top-color: #35454d; }

@media (max-width: 680px) {
  .mapwrap { flex: 1 1 45%; }
  .deck { flex: 1 1 50%; }
}
</style>
