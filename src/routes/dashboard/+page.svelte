<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { browser } from "$app/environment";
// maplibre-gl は default export を持たないので名前付きで取る
import {
  Map as MlMap,
  LngLatBounds,
  NavigationControl,
  type MapMouseEvent,
  type MapGeoJSONFeature,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  fetchAreas,
  fetchClass10Geo,
  fetchWarningsForPrefecture,
  prefectureCodeOf,
  type AreaDict,
  type AreaGeoJson,
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
let map: MlMap | null = null;
let geo: AreaGeoJson | null = null;

// 選択中の県の、区域ごとの発令内容。□ブロックで並べる元
const blocks = $derived.by(() => {
  const out: { areaCode: string; areaName: string; items: { code: string; status: string; level: WarningLevel }[] }[] = [];
  for (const rep of reports) {
    for (const [areaCode, w] of rep.byArea) {
      if (w.active.length === 0) continue;
      const items = w.active
        .map((a) => ({ ...a, level: warningLevel(a.code) }))
        .sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level]);
      out.push({
        areaCode,
        areaName: areas?.class10s[areaCode]?.name ?? areaCode,
        items,
      });
    }
  }
  // 段階の高い区域を先に出す
  return out.sort(
    (a, b) => LEVEL_RANK[b.items[0].level] - LEVEL_RANK[a.items[0].level],
  );
});

const quietAreas = $derived(
  reports.reduce((n, r) => n + [...r.byArea.values()].filter((w) => w.active.length === 0).length, 0),
);

const reportedAt = $derived(reports[0]?.reportedAt ?? "");

async function selectPrefecture(prefCode: string) {
  if (!areas) return;
  selectedPref = prefCode;
  selectedName = prefectureName(prefCode);
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
  zoomToPrefecture(prefCode);
}

function zoomToPrefecture(prefCode: string) {
  if (!map || !geo) return;
  const bounds = new LngLatBounds();
  let hit = false;
  for (const f of geo.features) {
    if (prefectureCodeOf(f.properties.code) !== prefCode) continue;
    for (const poly of f.geometry.coordinates) {
      for (const ring of poly) {
        for (const [lng, lat] of ring) {
          bounds.extend([lng, lat]);
          hit = true;
        }
      }
    }
  }
  if (hit) map.fitBounds(bounds, { padding: 40, duration: 700, maxZoom: 9 });
}

function resetView() {
  selectedPref = null;
  reports = [];
  failedOffices = [];
  map?.fitBounds(
    [
      [127.0, 26.0],
      [146.5, 45.8],
    ],
    { padding: 20, duration: 600 },
  );
  map?.setFilter("area-selected", ["==", ["get", "prefCode"], "__none__"]);
}

onMount(async () => {
  if (!browser) return;
  try {
    const [a, g] = await Promise.all([fetchAreas(), fetchClass10Geo()]);
    areas = a;
    geo = g;

    // 予報区コードから都道府県コードを持たせておく。塗り分けと選択に使う
    for (const f of g.features) {
      f.properties.prefCode = prefectureCodeOf(f.properties.code);
    }

    const m = new MlMap({
      container: mapEl,
      // 背景タイルに依存しない。予報区のポリゴンそのものを白地図として描く
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1013" } }],
      },
      bounds: [
        [127.0, 26.0],
        [146.5, 45.8],
      ],
      fitBoundsOptions: { padding: 20 },
      attributionControl: false,
    });

    m.on("load", () => {
      if (!geo) return;
      m.addSource("areas", { type: "geojson", data: geo });
      m.addLayer({
        id: "area-fill",
        type: "fill",
        source: "areas",
        paint: { "fill-color": "#1e2a2f", "fill-opacity": 1 },
      });
      m.addLayer({
        id: "area-selected",
        type: "fill",
        source: "areas",
        filter: ["==", ["get", "prefCode"], "__none__"],
        paint: { "fill-color": "#2b3f4d", "fill-opacity": 1 },
      });
      m.addLayer({
        id: "area-line",
        type: "line",
        source: "areas",
        paint: { "line-color": "#41545c", "line-width": 0.6 },
      });

      m.on("click", "area-fill", (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const f = e.features?.[0];
        if (!f) return;
        const pref = String(f.properties?.prefCode ?? "");
        if (!pref) return;
        m.setFilter("area-selected", ["==", ["get", "prefCode"], pref]);
        void selectPrefecture(pref);
      });
      m.on("mouseenter", "area-fill", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "area-fill", () => {
        m.getCanvas().style.cursor = "";
      });

      m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
      phase = "ready";
    });

    m.on("error", (e) => {
      errorText = e.error?.message ?? "地図の描画に失敗しました";
      phase = "error";
    });

    map = m;
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
    phase = "error";
  }
});

onDestroy(() => {
  map?.remove();
  map = null;
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
        <strong>データを取得できませんでした</strong>
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
          <span><i style="background: {LEVEL_COLOR[lv as WarningLevel]}"></i>{LEVEL_LABEL[lv as WarningLevel]}</span>
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
  border-radius: 3px; padding: 7px 12px; cursor: pointer;
  min-height: 34px;
  &:active { background: #1c262b; }
}

.mapwrap { flex: 1 1 55%; position: relative; min-height: 220px; }
.map { position: absolute; inset: 0; }

.overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; background: rgba(8, 11, 13, 0.86); color: #90a0a7; font-size: 14px;
  padding: 20px; text-align: center;
  &.err { color: #ff93a5; }
}
.hint {
  position: absolute; left: 50%; top: 12px; transform: translateX(-50%);
  background: rgba(8, 11, 13, 0.82); border: 1px solid #232f35;
  border-radius: 3px; padding: 6px 12px; font-size: 12px; color: #90a0a7;
  pointer-events: none; max-width: calc(100% - 24px); text-align: center;
}
.credit {
  position: absolute; left: 8px; bottom: 6px;
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
  padding: 9px 14px;
  border-bottom: 1px solid #232f35;
  background: #172025;
  font-size: 14px;
}
.dim { color: #90a0a7; font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.deck-body { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 12px; }

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
  padding: 7px 10px;
  border-radius: 3px;
  font-size: 13px; font-weight: 700;
  min-height: 34px;
  border: 1px solid transparent;
}
.cname { white-space: nowrap; }
.fresh {
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  padding: 1px 5px; border-radius: 2px;
  background: rgba(0, 0, 0, 0.28);
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

.empty {
  padding: 24px 14px; color: #5d6c73; font-size: 13px; text-align: center;
}

@media (max-width: 680px) {
  .mapwrap { flex: 1 1 45%; }
  .deck { flex: 1 1 50%; }
}
</style>
