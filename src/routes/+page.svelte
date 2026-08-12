<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { browser } from "$app/environment";
import type {
  Map as LMap,
  GeoJSON as LGeoJSON,
  LayerGroup as LLayerGroup,
  PathOptions,
  Layer,
} from "leaflet";
import type { Feature, MultiPolygon } from "geojson";
import "leaflet/dist/leaflet.css";
import OpsWindow from "$lib/components/OpsWindow.svelte";
import {
  fetchClass10Geo,
  prefectureCodeOf,
  type AreaGeoJson,
  type AreaFeatureProps,
} from "$lib/jma/api";
import { subscribeBosaiStatus, type BosaiSubscription } from "$lib/bosai/client";
import {
  isActive,
  prefectureCodeOfArea,
  topSeverityByArea,
  HAZARD_LABEL,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  BOSAI_RELAY,
  type BosaiStatus,
  type Severity,
} from "$lib/bosai/status";
import { prefectureName } from "$lib/jma/prefectures";
import {
  HAZARD_TILES,
  HAZARD_ATTRIBUTION,
  PATH_MAX_NATIVE_ZOOM,
  hazardTileUrl,
} from "$lib/hazard/tiles";

type Phase = "loading" | "ready" | "error";
type WinId = "list" | "detail" | "timeline";

let phase = $state<Phase>("loading");
let errorText = $state("");

// key ごとに最新1件。addressable event なので同じ key の更新で置き換わる
let statusByKey = $state<Record<string, BosaiStatus>>({});
let bosaiSub: BosaiSubscription | null = null;
let received = $state(0);
// 受信できないまま黙って空になるのが一番困る。一定時間で状態を出す
let stalled = $state(false);
let stallTimer: ReturnType<typeof setTimeout> | null = null;
// 経過表示のために時計を進める
let now = $state(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;
let selectedPref = $state<string | null>(null);
let selectedArea = $state<string | null>(null);

let mapEl: HTMLDivElement;
let map: LMap | null = null;
let areaLayer: LGeoJSON | null = null;

const HOME_BOUNDS: [[number, number], [number, number]] = [
  [24.0, 122.9],
  [45.7, 146.2],
];

// 気象警報とハザードマップが実装済み。他は取得経路の用意ができ次第つなぐ
const LAYERS = [
  { id: "warning", label: "警報・注意報", color: "#ff2800", ready: true, hazard: false },
  { id: "quake", label: "地震", color: "#67a9c4", ready: false, hazard: false },
  { id: "volcano", label: "火山", color: "#d0913f", ready: false, hazard: false },
  { id: "typhoon", label: "台風", color: "#dde5e8", ready: false, hazard: false },
  ...HAZARD_TILES.map((h) => ({
    id: h.id,
    label: h.label,
    color: h.color,
    ready: true,
    hazard: true,
  })),
];
let layerOn = $state<Record<string, boolean>>({ warning: true });
let mapZoom = $state(5);

const hazardOn = $derived(HAZARD_TILES.some((h) => layerOn[h.id]));
// ハザードマップは広域では読めず、通信量だけかかるので一定の拡大から出す
const hazardMinZoom = Math.min(...HAZARD_TILES.map((h) => h.minZoom));
const hazardTooWide = $derived(hazardOn && mapZoom < hazardMinZoom);
// タイルが実際に描かれているときだけ白地図の塗りを透かす。
// 広域では透かしても下に何も無く、地図が消えるだけになる
const hazardActive = $derived(hazardOn && mapZoom >= hazardMinZoom);

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

const statuses = $derived(Object.values(statusByKey));
const active = $derived(statuses.filter(isActive));

// 地図の面で塗れるのは一次細分区域のものだけ。
// 土砂災害は市町村等、地震は震央地名で、予報区の形を持たない
const areaSeverity = $derived(topSeverityByArea(active));

// 件数は区域ごとの最高段階で数える。
// 同じ市区町村が複数の粒度で同時に出るため、素直に件数を足すと二重計上になる
const counts = $derived.by(() => {
  const c = { emergency: 0, warning: 0, advisory: 0, info: 0 };
  const top: Record<string, Severity> = {};
  for (const s of active) {
    if (!s.area) continue;
    const cur = top[s.area.code];
    if (!cur || SEVERITY_RANK[s.severity] > SEVERITY_RANK[cur]) top[s.area.code] = s.severity;
  }
  for (const sev of Object.values(top)) c[sev]++;
  return c;
});

interface AreaGroup {
  areaCode: string;
  areaName: string;
  areaType: string;
  prefCode: string | null;
  prefName: string | null;
  top: Severity;
  items: BosaiStatus[];
  /** 一次細分区域のものだけ地図の面に対応する */
  onMap: boolean;
}

// 地域ごとにまとめる。仕様どおり、都道府県に束ねられるのは
// 一次細分区域・市町村等・府県予報区だけ。
// 震央地名・津波予報区・火山・河川は県に属さないので県名を付けない
const groups = $derived.by(() => {
  const byArea: Record<string, AreaGroup> = {};
  for (const s of active) {
    if (!s.area) continue;
    const g = byArea[s.area.code] ?? (byArea[s.area.code] = {
      areaCode: s.area.code,
      areaName: s.area.name,
      areaType: s.area.type,
      prefCode: prefectureCodeOfArea(s.area),
      prefName: null,
      top: s.severity,
      items: [],
      onMap: s.area.type === "一次細分区域",
    });
    g.items.push(s);
    if (SEVERITY_RANK[s.severity] > SEVERITY_RANK[g.top]) g.top = s.severity;
  }
  const list = Object.values(byArea);
  for (const g of list) {
    g.prefName = g.prefCode ? prefectureName(g.prefCode) : null;
    g.items.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  }
  return list.sort(
    (a, b) =>
      SEVERITY_RANK[b.top] - SEVERITY_RANK[a.top] ||
      (a.prefCode ?? "zz").localeCompare(b.prefCode ?? "zz") ||
      a.areaCode.localeCompare(b.areaCode),
  );
});

const visibleGroups = $derived(
  selectedPref ? groups.filter((g) => g.prefCode === selectedPref) : groups,
);

// 地図に面として出せないもの。「地図に無い＝危険が無い」と読まれないよう数を出す
const offMapCount = $derived(visibleGroups.filter((g) => !g.onMap).length);

const detailGroup = $derived(groups.find((g) => g.areaCode === selectedArea) ?? null);

// 発表からの経過。addressable event は履歴を残さないため、
// いま存在するものの publishedAt から現在までしか描けない
const timeLanes = $derived.by(() => {
  const span = 12 * 3600 * 1000;
  const from = now - span;
  return visibleGroups
    .slice(0, 14)
    .map((g) => {
      const started = Math.min(...g.items.map((i) => Date.parse(i.publishedAt) || now));
      const left = Math.max(0, ((started - from) / span) * 100);
      return {
        key: g.areaCode,
        name: g.prefName ? `${g.prefName} ${g.areaName}` : g.areaName,
        top: g.top,
        left,
        width: Math.max(1.5, 100 - left),
        label: fmtClock(started),
      };
    })
    .sort((a, b) => a.left - b.left);
});

const BASE: PathOptions = { color: "#41545c", weight: 0.55, fillColor: "#1e2a2f", fillOpacity: 1 };

function styleOf(props: AreaFeatureProps): PathOptions {
  const lv = layerOn.warning ? areaSeverity.get(props.code) : undefined;
  const inPref = props.prefCode === selectedPref;
  const isSel = props.code === selectedArea;
  return {
    color: isSel ? "#cfe6f2" : inPref ? "#7fb2c9" : BASE.color,
    weight: isSel ? 1.8 : inPref ? 1.1 : BASE.weight,
    fillColor: lv ? SEVERITY_COLOR[lv] : BASE.fillColor,
    // ハザードマップを出しているときは、下のラスタが見えるよう塗りを薄くする。
    // 警報の色は残したいので、発表なしの区域だけ完全に透かす
    fillOpacity: hazardActive ? (lv ? 0.3 : 0) : lv ? (lv === "advisory" ? 0.55 : 0.72) : 1,
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
  const g = groups.find((x) => x.areaCode === areaCode);
  selectedPref = g?.prefCode ?? prefectureCodeOf(areaCode);
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

// ハザードマップのタイル。切り替えのたびに作り直さず、一度作って付け外しする
const hazardLayers: Record<string, LLayerGroup> = {};

function buildHazardLayers(L: typeof import("leaflet")) {
  for (const h of HAZARD_TILES) {
    const group = L.layerGroup(
      h.paths.map((path) =>
        L.tileLayer(hazardTileUrl(path), {
          // 種別ごとに実在する上限ズームが違う。超えたぶんは引き伸ばす。
          // 指定しないと 404 になり、拡大した瞬間にレイヤーが消えて
          // 「危険が無い」と読まれてしまう
          maxNativeZoom: PATH_MAX_NATIVE_ZOOM[path] ?? h.maxNativeZoom,
          minZoom: h.minZoom,
          maxZoom: 18,
          opacity: 0.75,
          crossOrigin: true,
        }),
      ),
    );
    hazardLayers[h.id] = group;
  }
}

function toggleLayer(id: string) {
  const on = !layerOn[id];
  layerOn = { ...layerOn, [id]: on };

  const group = hazardLayers[id];
  if (group && map) {
    if (on) group.addTo(map);
    else map.removeLayer(group);
  }
  restyle();
}

onMount(async () => {
  if (!browser) return;
  try {
    // leaflet は window に触れるので、SSR のモジュールグラフに入れず動的に読む
    // 地域名は 30830 のレコードが持っているので area.json は要らない。
    // 取るのは地図のポリゴンだけ
    const [mod, g] = await Promise.all([import("leaflet"), fetchClass10Geo()]);
    const L = mod.default ?? mod;

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

    // URL で初期状態を指定できる。地点とレイヤーを他人に渡せるようにするため。
    //   ?center=35.72,139.80&zoom=12&layer=flood,sediment
    const q = new URLSearchParams(location.search);
    const center = q.get("center")?.split(",").map(Number);
    const zoom = Number(q.get("zoom"));
    if (center?.length === 2 && center.every(Number.isFinite) && Number.isFinite(zoom)) {
      m.setView([center[0], center[1]], zoom);
    } else {
      m.fitBounds(HOME_BOUNDS, { padding: [2, 2] });
    }
    const wanted = q.get("layer")?.split(",").filter(Boolean) ?? [];
    if (wanted.length > 0) {
      layerOn = { warning: layerOn.warning, ...Object.fromEntries(wanted.map((k) => [k, true])) };
    }
    mapZoom = m.getZoom();
    m.on("zoomend", () => {
      mapZoom = m.getZoom();
      // 透かすかどうかがズームで変わるので塗り直す
      if (hazardOn) restyle();
    });

    buildHazardLayers(L);
    // URL で指定されたハザードレイヤーを反映する
    for (const h of HAZARD_TILES) {
      if (layerOn[h.id]) hazardLayers[h.id]?.addTo(m);
    }

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

    // 防災ステータスを購読する。気象庁への全国ポーリングは不要になった
    bosaiSub = await subscribeBosaiStatus((st) => {
      statusByKey = { ...statusByKey, [st.key]: st };
      received++;
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
      stalled = false;
      restyle();
    });
    stallTimer = setTimeout(() => { if (received === 0) stalled = true; }, 12000);
    nowTimer = setInterval(() => (now = Date.now()), 30000);
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
    phase = "error";
  }
});

onDestroy(() => {
  if (stallTimer) clearTimeout(stallTimer);
  bosaiSub?.close();
  bosaiSub = null;
  if (nowTimer) clearInterval(nowTimer);
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
        <b style="color: {SEVERITY_COLOR.emergency}">{counts.emergency}</b><span>切迫</span>
      </div>
      <div class="cnt">
        <b style="color: {SEVERITY_COLOR.warning}">{counts.warning}</b><span>警報</span>
      </div>
      <div class="cnt">
        <b style="color: {SEVERITY_COLOR.advisory}">{counts.advisory}</b><span>注意報</span>
      </div>
      <div class="cnt"><b>{groups.length}</b><span>発令中の地域</span></div>
    </div>
    <span class="grow"></span>
    {#if stalled}
      <span class="pad stall">リレーから受信できていません（{BOSAI_RELAY}）</span>
    {:else if received === 0}
      <span class="mono dim pad">受信待ち</span>
    {:else}
      <span class="mono dim pad">{received} 件受信</span>
    {/if}
    {#if selectedPref}
      <button class="ghost" onclick={resetView}>全国へ戻す</button>
    {/if}
  </header>

  <nav class="layers" aria-label="レイヤー">
    {#each LAYERS as l, i (l.id)}
      {#if l.hazard && !LAYERS[i - 1]?.hazard}
        <span class="sep" aria-hidden="true"></span>
      {/if}
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

    {#if hazardTooWide}
      <p class="hintbar">
        ハザードマップはこの広さでは表示されません。拡大すると出ます。
      </p>
    {/if}

    {#if phase === "ready" && openWins.includes("list")}
      <OpsWindow
        title={selectedPref ? `発令中 / ${prefectureName(selectedPref)}` : "発令中一覧（全国）"}
        sub="{visibleGroups.length}地域"
        geom={geom.list}
        z={zOf("list")}
        focused={zOrder.at(-1) === "list"}
        onfocus={() => focusWin("list")}
        onclose={() => toggleWin("list")}
      >
        {#if visibleGroups.length === 0}
          <p class="empty">発表中の情報はありません</p>
        {/if}
        {#if offMapCount > 0}
          <p class="note">
            {offMapCount} 地域は地図に面で出せません（土砂災害は市町村、地震は震央地名など、
            予報区の形を持たないため）。地図に無いことは危険が無いことを意味しません。
          </p>
        {/if}
        {#each visibleGroups as g (g.areaCode)}
          <button
            class="row"
            class:sel={g.areaCode === selectedArea}
            onclick={() => pickArea(g.areaCode)}
          >
            <i class="bar-{g.top}"></i>
            <span class="mid">
              <span class="ttl">
                {#if g.prefName}<span class="pref">{g.prefName}</span>{/if}{g.areaName}
              </span>
              <span class="sub">
                {g.items.map((i) => HAZARD_LABEL[i.hazard]).filter((v, i, a) => a.indexOf(v) === i).join("・")}
                ／ {g.items.length}件{#if !g.onMap} ／ <span class="offmap">{g.areaType}</span>{/if}
              </span>
            </span>
            <span class="tag tag-{g.top}">{SEVERITY_LABEL[g.top]}</span>
          </button>
        {/each}
      </OpsWindow>
    {/if}

    {#if phase === "ready" && openWins.includes("detail")}
      <OpsWindow
        title="詳細"
        sub={detailGroup?.prefName ?? detailGroup?.areaType ?? ""}
        geom={geom.detail}
        z={zOf("detail")}
        focused={zOrder.at(-1) === "detail"}
        onfocus={() => focusWin("detail")}
        onclose={() => toggleWin("detail")}
      >
        {#if !detailGroup}
          <p class="empty">地図か一覧から地域を選んでください</p>
        {:else}
          <div class="detail">
            <div class="place">{detailGroup.areaName}</div>
            <div class="meta mono">
              {detailGroup.prefName ?? "—"} ／ {detailGroup.areaType} ／ {detailGroup.areaCode}
            </div>
            <!-- 同じ地域に複数の情報が同時に出る。ブロックで並べると数と種類が一目で掴める -->
            <div class="chips">
              {#each detailGroup.items as it (it.key)}
                <span class="chip lv-{it.severity}">{it.headline}</span>
              {/each}
            </div>
            <div class="hist">
              {#each detailGroup.items as it (it.key)}
                <div class="h">
                  <span class="tm mono">{fmtStamp(it.publishedAt)}</span>
                  <span class="dim">{HAZARD_LABEL[it.hazard]}</span>
                  {#if it.updatedAt !== it.publishedAt}
                    <span class="dim">更新 {fmtStamp(it.updatedAt)}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </OpsWindow>
    {/if}

    {#if phase === "ready" && openWins.includes("timeline")}
      <OpsWindow
        title="発表時刻"
        sub="直近12時間"
        geom={geom.timeline}
        z={zOf("timeline")}
        focused={zOrder.at(-1) === "timeline"}
        onfocus={() => focusWin("timeline")}
        onclose={() => toggleWin("timeline")}
      >
        <p class="note">
          発表から現在までの帯です。addressable event は履歴を残さないため、
          いま発表中のものしか描けません。解除済みのものは残りません。
        </p>
        {#each timeLanes as l (l.key)}
          <div class="lane">
            <span class="nm">{l.name}</span>
            <span class="tk">
              <i style="left: {l.left}%; width: {l.width}%; background: {SEVERITY_COLOR[l.top]}"></i>
            </span>
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

    <p class="credit">
      出典: 気象庁（eew2nostr 経由）{#if hazardOn} ／ {HAZARD_ATTRIBUTION}{/if}
    </p>

    <div class="legend">
      {#each ["emergency", "warning", "advisory"] as lv (lv)}
        <span>
          <i style="background: {SEVERITY_COLOR[lv as Severity]}"></i>{SEVERITY_LABEL[lv as Severity]}
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
.stall { color: #f0a2ae; font-size: 12px; }

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
.sep { flex: none; width: 1px; align-self: stretch; margin: 0 4px; background: #2a373d; }
.credit {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 800;
  margin: 0;
  font-size: 10px;
  color: #6d7c83;
  white-space: nowrap;
  pointer-events: none;
}

.stage { flex: 1; position: relative; min-height: 0; }
.map {
  position: absolute;
  inset: 0;
  background: #0b1013;
  /* Leaflet の内部ペインは z-index 200〜700 を使う。ここで重なり文脈を作らないと
     タイルやポリゴンがウインドウ（z-index 10〜）より前に出てしまう */
  z-index: 0;
}

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
.hintbar {
  position: absolute;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  z-index: 800;
  margin: 0;
  padding: 6px 12px;
  border-radius: 3px;
  background: #14222a;
  color: #9fc2d2;
  font-size: 12px;
  border: 1px solid #2b4552;
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
.bar-emergency { background: #a50021; }
.bar-warning { background: #ff2800; }
.bar-advisory { background: #f2e700; }
.bar-info { background: #5d6c73; }

.tag {
  align-self: center;
  flex: none;
  padding: 1px 6px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 700;
}
.tag-emergency { background: #a50021; color: #fff; }
.tag-warning { background: #ff2800; color: #fff; }
.tag-advisory { background: #f2e700; color: #241f00; }
.tag-info { background: #2b373d; color: #c8d3d8; }

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
.lv-emergency { background: #a50021; color: #fff; }
.lv-warning { background: #ff2800; color: #fff; }
.lv-advisory { background: #f2e700; color: #241f00; }
.lv-info { background: #2b373d; color: #c8d3d8; }

.pref { color: #8d9aa0; margin-right: 5px; font-weight: 400; }
.offmap { color: #c9a227; }

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
  .tk i { position: absolute; top: 1px; bottom: 1px; border-radius: 1px; min-width: 2px; }
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
