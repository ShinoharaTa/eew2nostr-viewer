<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { browser } from "$app/environment";
import type { Map as LMap, GeoJSON as LGeoJSON, PathOptions, Layer } from "leaflet";
import type { Feature, MultiPolygon } from "geojson";
import "leaflet/dist/leaflet.css";
import OpsWindow from "$lib/components/OpsWindow.svelte";
import {
  fetchAreas,
  fetchClass10Geo,
  fetchAllWarnings,
  topLevelByArea,
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
type WinId = "list" | "detail" | "timeline";

let phase = $state<Phase>("loading");
let errorText = $state("");
let progress = $state({ done: 0, total: 0 });

let areas = $state<AreaDict | null>(null);
let reports = $state<WarningReport[]>([]);
let failedOffices = $state<string[]>([]);
let selectedPref = $state<string | null>(null);
let selectedArea = $state<string | null>(null);

let mapEl: HTMLDivElement;
let map: LMap | null = null;
let areaLayer: LGeoJSON | null = null;

const HOME_BOUNDS: [[number, number], [number, number]] = [
  [24.0, 122.9],
  [45.7, 146.2],
];

// 気象警報だけが実装済み。他は取得経路の用意ができ次第つなぐ
const LAYERS = [
  { id: "warning", label: "警報・注意報", color: "#ff2800", ready: true },
  { id: "quake", label: "地震", color: "#67a9c4", ready: false },
  { id: "volcano", label: "火山", color: "#d0913f", ready: false },
  { id: "typhoon", label: "台風", color: "#dde5e8", ready: false },
  { id: "hazard", label: "ハザードマップ", color: "#8d6bb5", ready: false },
];
let layerOn = $state<Record<string, boolean>>({ warning: true });

// 位置と大きさはここで保持する。OpsWindow が直接書き換えるので、
// 閉じて開き直しても動かした位置が残る
const geom = $state({
  list: { x: 16, y: 16, w: 330, h: 380 },
  detail: { x: 362, y: 16, w: 330, h: 300 },
  timeline: { x: 16, y: 412, w: 470, h: 220 },
});
let openWins = $state<WinId[]>(["list", "detail"]);
let zOrder = $state<WinId[]>(["list", "detail", "timeline"]);

const zOf = (id: WinId) => 10 + zOrder.indexOf(id);
function focusWin(id: WinId) {
  zOrder = [...zOrder.filter((w) => w !== id), id];
}
function toggleWin(id: WinId) {
  const willOpen = !openWins.includes(id);
  openWins = willOpen ? [...openWins, id] : openWins.filter((w) => w !== id);
  if (willOpen) focusWin(id);
}

const areaLevels = $derived(topLevelByArea(reports));

const counts = $derived.by(() => {
  const c = { special: 0, warning: 0, advisory: 0 };
  for (const lv of areaLevels.values()) {
    if (lv === "special") c.special++;
    else if (lv === "warning") c.warning++;
    else if (lv === "advisory") c.advisory++;
  }
  return c;
});

interface AreaRow {
  areaCode: string;
  areaName: string;
  prefCode: string;
  prefName: string;
  top: WarningLevel;
  items: { code: string; status: string; level: WarningLevel }[];
  reportedAt: string;
}

const allRows = $derived.by(() => {
  const rows: AreaRow[] = [];
  for (const rep of reports) {
    for (const [areaCode, w] of rep.byArea) {
      if (w.active.length === 0 || !w.top) continue;
      const items = w.active
        .map((a) => ({ ...a, level: warningLevel(a.code) }))
        .sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level]);
      const prefCode = prefectureCodeOf(areaCode);
      rows.push({
        areaCode,
        areaName: areas?.class10s[areaCode]?.name ?? areaCode,
        prefCode,
        prefName: prefectureName(prefCode),
        top: w.top,
        items,
        reportedAt: rep.reportedAt,
      });
    }
  }
  return rows.sort(
    (a, b) => LEVEL_RANK[b.top] - LEVEL_RANK[a.top] || a.areaCode.localeCompare(b.areaCode),
  );
});

// 県を選んでいればその県だけ、選んでいなければ全国
const visibleRows = $derived(
  selectedPref ? allRows.filter((r) => r.prefCode === selectedPref) : allRows,
);

const detailRow = $derived(allRows.find((r) => r.areaCode === selectedArea) ?? null);

// 気象庁の JSON は「いまの状態」しか返さないため、発表から解除までの帯は描けない。
// 予報区ごとの最終発表時刻を直近6時間の軸に置く
const timeLanes = $derived.by(() => {
  const now = Date.now();
  const span = 6 * 3600 * 1000;
  const seen: Record<string, { name: string; at: number; top: WarningLevel }> = {};
  for (const r of visibleRows) {
    const at = new Date(r.reportedAt).getTime();
    const cur = seen[r.areaCode];
    if (!cur || at > cur.at) seen[r.areaCode] = { name: r.areaName, at, top: r.top };
  }
  return Object.values(seen)
    .sort((a, b) => b.at - a.at)
    .slice(0, 14)
    .map((v) => ({
      name: v.name,
      top: v.top,
      pos: Math.max(0, Math.min(100, ((v.at - (now - span)) / span) * 100)),
      label: fmtClock(v.at),
    }));
});

const BASE: PathOptions = { color: "#41545c", weight: 0.55, fillColor: "#1e2a2f", fillOpacity: 1 };

function styleOf(props: AreaFeatureProps): PathOptions {
  const lv = layerOn.warning ? areaLevels.get(props.code) : undefined;
  const inPref = props.prefCode === selectedPref;
  const isSel = props.code === selectedArea;
  return {
    color: isSel ? "#cfe6f2" : inPref ? "#7fb2c9" : BASE.color,
    weight: isSel ? 1.8 : inPref ? 1.1 : BASE.weight,
    fillColor: lv ? LEVEL_COLOR[lv] : BASE.fillColor,
    fillOpacity: lv ? (lv === "advisory" ? 0.55 : 0.72) : 1,
  };
}

function restyle() {
  areaLayer?.eachLayer((l: Layer) => {
    const f = (l as Layer & { feature?: Feature<MultiPolygon, AreaFeatureProps> }).feature;
    if (!f) return;
    (l as Layer & { setStyle: (s: PathOptions) => void }).setStyle(styleOf(f.properties));
  });
}

function pickArea(areaCode: string) {
  selectedArea = areaCode;
  selectedPref = prefectureCodeOf(areaCode);
  if (!openWins.includes("detail")) toggleWin("detail");
  else focusWin("detail");
  restyle();
  zoomToPrefecture(selectedPref);
}

function zoomToPrefecture(prefCode: string) {
  if (!map || !areaLayer) return;
  let bounds: ReturnType<LGeoJSON["getBounds"]> | null = null;
  areaLayer.eachLayer((l: Layer) => {
    const f = (l as Layer & { feature?: Feature<MultiPolygon, AreaFeatureProps> }).feature;
    if (!f || f.properties.prefCode !== prefCode) return;
    const b = (l as Layer & { getBounds: () => ReturnType<LGeoJSON["getBounds"]> }).getBounds();
    bounds = bounds ? bounds.extend(b) : b;
  });
  if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
}

function resetView() {
  selectedPref = null;
  selectedArea = null;
  restyle();
  map?.fitBounds(HOME_BOUNDS, { padding: [2, 2] });
}

function toggleLayer(id: string) {
  layerOn = { ...layerOn, [id]: !layerOn[id] };
  restyle();
}

onMount(async () => {
  if (!browser) return;
  try {
    // leaflet は window に触れるので、SSR のモジュールグラフに入れず動的に読む
    const [mod, a, g] = await Promise.all([import("leaflet"), fetchAreas(), fetchClass10Geo()]);
    const L = mod.default ?? mod;
    areas = a;

    for (const f of (g as AreaGeoJson).features) {
      f.properties.prefCode = prefectureCodeOf(f.properties.code);
    }

    // 背景タイルは張らない。予報区のポリゴンそのものを白地図として描く
    const m = L.map(mapEl, {
      // 左上はウインドウの定位置なので、拡大縮小は右下に置く
      zoomControl: false,
      attributionControl: false,
      minZoom: 3,
      maxZoom: 12,
    });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    m.fitBounds(HOME_BOUNDS, { padding: [2, 2] });

    areaLayer = L.geoJSON(g as AreaGeoJson, {
      style: (f) => styleOf(f?.properties as AreaFeatureProps),
      onEachFeature: (feature, layer) => {
        const p = feature.properties as AreaFeatureProps;
        layer.on("click", () => pickArea(p.code));
        layer.bindTooltip(p.name, { sticky: true, direction: "top" });
      },
    }).addTo(m);

    map = m;
    phase = "ready";

    // 全国58予報区ぶん。地図の塗り分けに要るが時間がかかるので、
    // 地図を出してから追いかけて取る
    const res = await fetchAllWarnings(a, {
      onProgress: (done, total) => (progress = { done, total }),
    });
    reports = res.reports;
    failedOffices = res.failed;
    restyle();
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

function fmtClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtStamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const DOCK: [WinId, string][] = [
  ["list", "一覧"],
  ["detail", "詳細"],
  ["timeline", "発表時刻"],
];
</script>

<svelte:head><title>防災ダッシュボード</title></svelte:head>

<div class="console">
  <header class="bar">
    <span class="beacon" class:live={phase === "ready"}></span>
    <span class="brand">防災オペレーション</span>
    <div class="counts">
      <div class="cnt">
        <b style="color: {LEVEL_COLOR.special}">{counts.special}</b><span>特別警報</span>
      </div>
      <div class="cnt">
        <b style="color: {LEVEL_COLOR.warning}">{counts.warning}</b><span>警報</span>
      </div>
      <div class="cnt">
        <b style="color: {LEVEL_COLOR.advisory}">{counts.advisory}</b><span>注意報</span>
      </div>
      <div class="cnt"><b>{allRows.length}</b><span>発令中の区域</span></div>
    </div>
    <span class="grow"></span>
    {#if progress.total > 0 && progress.done < progress.total}
      <span class="mono dim pad">取得中 {progress.done}/{progress.total}</span>
    {/if}
    {#if selectedPref}
      <button class="ghost" onclick={resetView}>全国へ戻す</button>
    {/if}
  </header>

  <nav class="layers" aria-label="レイヤー">
    {#each LAYERS as l (l.id)}
      <button
        class="lyr"
        class:on={layerOn[l.id]}
        disabled={!l.ready}
        title={l.ready ? "" : "未実装"}
        onclick={() => toggleLayer(l.id)}
      >
        <i style="background: {l.color}"></i>{l.label}{#if !l.ready}<span class="soon">未</span>{/if}
      </button>
    {/each}
    <span class="grow"></span>
    <span class="credit">出典: 気象庁</span>
  </nav>

  <div class="stage">
    <div class="map" bind:this={mapEl}></div>

    {#if phase === "loading"}
      <div class="overlay"><span>気象庁のデータを取得しています…</span></div>
    {:else if phase === "error"}
      <div class="overlay err">
        <strong>地図を表示できませんでした</strong><span>{errorText}</span>
      </div>
    {/if}

    {#if failedOffices.length > 0}
      <p class="failbar">
        {failedOffices.length} 件の予報区を取得できませんでした。表示は取得できたぶんのみです。
      </p>
    {/if}

    {#if phase === "ready" && openWins.includes("list")}
      <OpsWindow
        title={selectedPref ? `発令中 / ${prefectureName(selectedPref)}` : "発令中一覧（全国）"}
        sub="{visibleRows.length}区域"
        geom={geom.list}
        z={zOf("list")}
        focused={zOrder.at(-1) === "list"}
        onfocus={() => focusWin("list")}
        onclose={() => toggleWin("list")}
      >
        {#if visibleRows.length === 0}
          <p class="empty">発表中の警報・注意報はありません</p>
        {/if}
        {#each visibleRows as r (r.areaCode)}
          <button
            class="row"
            class:sel={r.areaCode === selectedArea}
            onclick={() => pickArea(r.areaCode)}
          >
            <i class="bar-{r.top}"></i>
            <span class="mid">
              <span class="ttl">{r.areaName}</span>
              <span class="sub">{r.prefName} ／ {r.items.length}件</span>
            </span>
            <span class="tag tag-{r.top}">{LEVEL_LABEL[r.top]}</span>
          </button>
        {/each}
      </OpsWindow>
    {/if}

    {#if phase === "ready" && openWins.includes("detail")}
      <OpsWindow
        title="詳細"
        sub={detailRow ? detailRow.prefName : ""}
        geom={geom.detail}
        z={zOf("detail")}
        focused={zOrder.at(-1) === "detail"}
        onfocus={() => focusWin("detail")}
        onclose={() => toggleWin("detail")}
      >
        {#if !detailRow}
          <p class="empty">地図か一覧から区域を選んでください</p>
        {:else}
          <div class="detail">
            <div class="place">{detailRow.areaName}</div>
            <div class="meta mono">{detailRow.prefName} ／ {detailRow.areaCode}</div>
            <!-- 警報は「区域 × 種別」で同時に複数出る。ブロックで並べると数と種類が一目で掴める -->
            <div class="chips">
              {#each detailRow.items as it (it.code)}
                <span class="chip lv-{it.level}">
                  {warningName(it.code)}
                  {#if it.status === "発表"}<b class="fresh">発表</b>{/if}
                </span>
              {/each}
            </div>
            <div class="meta">発表 {fmtStamp(detailRow.reportedAt)}</div>
          </div>
        {/if}
      </OpsWindow>
    {/if}

    {#if phase === "ready" && openWins.includes("timeline")}
      <OpsWindow
        title="発表時刻"
        sub="直近6時間"
        geom={geom.timeline}
        z={zOf("timeline")}
        focused={zOrder.at(-1) === "timeline"}
        onfocus={() => focusWin("timeline")}
        onclose={() => toggleWin("timeline")}
      >
        <p class="note">
          気象庁の JSON は現在の状態のみを返すため、発表から解除までの帯は描けません。
          予報区ごとの最終発表時刻を並べています。
        </p>
        {#each timeLanes as l (l.name)}
          <div class="lane">
            <span class="nm">{l.name}</span>
            <span class="tk"><i style="left: {l.pos}%; background: {LEVEL_COLOR[l.top]}"></i></span>
            <span class="tm mono">{l.label}</span>
          </div>
        {/each}
        {#if timeLanes.length === 0}
          <p class="empty">表示するものがありません</p>
        {/if}
      </OpsWindow>
    {/if}

    <div class="dock">
      {#each DOCK as [id, label] (id)}
        <button class="dockbtn" class:on={openWins.includes(id)} onclick={() => toggleWin(id)}>
          {label}
        </button>
      {/each}
    </div>

    <div class="legend">
      {#each ["special", "warning", "advisory"] as lv (lv)}
        <span>
          <i style="background: {LEVEL_COLOR[lv as WarningLevel]}"></i>{LEVEL_LABEL[lv as WarningLevel]}
        </span>
      {/each}
    </div>
  </div>
</div>

<style lang="scss">
.console {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #080b0d;
  color: #e2e9ec;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
  overflow: hidden;
}
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dim { color: #8d9aa0; font-size: 12px; }
.grow { flex: 1; }
.pad { padding: 0 12px; align-self: center; }

.bar {
  flex: none;
  display: flex;
  align-items: stretch;
  height: 52px;
  background: #172025;
  border-bottom: 1px solid #232f35;
}
.beacon {
  align-self: center;
  margin-left: 14px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5d6c73;
  flex: none;
  &.live { background: #2ed17f; box-shadow: 0 0 0 3px rgba(46, 209, 127, 0.16); }
}
.brand {
  display: flex;
  align-items: center;
  padding: 0 14px 0 8px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
  border-right: 1px solid #232f35;
}
.counts { display: flex; min-width: 0; overflow: hidden; }
.cnt {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 13px;
  border-right: 1px solid #232f35;
  white-space: nowrap;
  b {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 19px;
    line-height: 1.05;
  }
  span { font-size: 10px; letter-spacing: 0.08em; color: #6d7c83; }
}
.ghost {
  align-self: center;
  font: inherit;
  font-size: 13px;
  color: #90a0a7;
  margin-right: 14px;
  background: transparent;
  border: 1px solid #35454d;
  border-radius: 3px;
  padding: 7px 12px;
  cursor: pointer;
  min-height: 34px;
  &:hover { background: #1c262b; }
}

.layers {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  background: #0e1417;
  border-bottom: 1px solid #232f35;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}
.lyr {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  min-height: 32px;
  border: 1px solid #2f3d44;
  border-radius: 999px;
  background: transparent;
  color: #8d9aa0;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  i { width: 8px; height: 8px; border-radius: 2px; opacity: 0.35; flex: none; }
  &.on {
    color: #e2e9ec;
    border-color: #6d7c83;
    background: #1c262b;
    i { opacity: 1; }
  }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #67a9c4; outline-offset: 2px; }
}
.soon { font-size: 9px; padding: 0 4px; border-radius: 2px; background: #2b373d; color: #8d9aa0; }
.credit { font-size: 10px; color: #5d6c73; white-space: nowrap; }

.stage { flex: 1; position: relative; min-height: 0; }
.map { position: absolute; inset: 0; background: #0b1013; }

.overlay {
  position: absolute;
  inset: 0;
  z-index: 900;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(8, 11, 13, 0.86);
  color: #90a0a7;
  font-size: 14px;
  &.err { color: #ff93a5; }
}
.failbar {
  position: absolute;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  z-index: 800;
  margin: 0;
  padding: 6px 12px;
  border-radius: 3px;
  background: #2a2210;
  color: #f0d68a;
  font-size: 12px;
  border: 1px solid #4a3c18;
}

.dock {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 800;
  display: flex;
  gap: 6px;
}
.dockbtn {
  font: inherit;
  font-size: 12px;
  color: #8d9aa0;
  background: rgba(8, 11, 13, 0.85);
  border: 1px solid #35454d;
  border-radius: 3px;
  padding: 7px 12px;
  cursor: pointer;
  min-height: 32px;
  &.on { background: #e2e9ec; color: #0b1013; border-color: #e2e9ec; font-weight: 700; }
}

.legend {
  position: absolute;
  right: 60px;
  bottom: 12px;
  z-index: 800;
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #8d9aa0;
  background: rgba(8, 11, 13, 0.78);
  border: 1px solid #232f35;
  border-radius: 3px;
  padding: 5px 10px;
  pointer-events: none;
  span { display: inline-flex; align-items: center; gap: 5px; }
  i { width: 9px; height: 9px; border-radius: 2px; }
}

.empty { padding: 20px 14px; margin: 0; color: #5d6c73; font-size: 13px; text-align: center; }
.note {
  margin: 0;
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.6;
  color: #8d9aa0;
  border-bottom: 1px solid #212b30;
}

.row {
  display: flex;
  width: 100%;
  gap: 9px;
  align-items: stretch;
  padding: 8px 10px;
  border: none;
  border-bottom: 1px solid #1c2529;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:hover { background: #1a2327; }
  &.sel { background: #16242f; }
  i { width: 3px; border-radius: 2px; flex: none; }
  .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .ttl {
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 11px;
    color: #8d9aa0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
.bar-special { background: #a50021; }
.bar-warning { background: #ff2800; }
.bar-advisory { background: #f2e700; }
.bar-other { background: #5d6c73; }

.tag {
  align-self: center;
  flex: none;
  padding: 1px 6px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 700;
}
.tag-special { background: #a50021; color: #fff; }
.tag-warning { background: #ff2800; color: #fff; }
.tag-advisory { background: #f2e700; color: #241f00; }
.tag-other { background: #2b373d; color: #c8d3d8; }

.detail { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.place { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
.meta { font-size: 11px; color: #8d9aa0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 9px;
  border-radius: 3px;
  font-size: 12.5px;
  font-weight: 700;
}
.fresh { font-size: 9px; padding: 1px 4px; border-radius: 2px; background: rgba(0, 0, 0, 0.3); }
.lv-special { background: #a50021; color: #fff; }
.lv-warning { background: #ff2800; color: #fff; }
.lv-advisory { background: #f2e700; color: #241f00; }
.lv-other { background: #2b373d; color: #c8d3d8; }

.lane {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  .nm {
    width: 96px;
    flex: none;
    font-size: 11px;
    color: #b7c2c7;
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tk { flex: 1; height: 12px; background: #1a2327; border-radius: 2px; position: relative; }
  .tk i { position: absolute; top: 1px; bottom: 1px; width: 3px; border-radius: 1px; }
  .tm { font-size: 10px; color: #6d7c83; flex: none; }
}

:global(.leaflet-container) { background: #0b1013; outline: none; }
:global(.leaflet-control-zoom a) { background: #172025; color: #c8d3d8; border-color: #35454d; }
:global(.leaflet-control-zoom a:hover) { background: #22303a; }
:global(.leaflet-tooltip) {
  background: #172025;
  color: #e2e9ec;
  border: 1px solid #35454d;
  box-shadow: none;
  font-size: 12px;
}
:global(.leaflet-tooltip-top::before) { border-top-color: #35454d; }
</style>
