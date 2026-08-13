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
  WORKSPACES,
  detectSituation,
  focusTargets,
  type Situation,
} from "$lib/ops/workspaces";
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
type WinId = "filter";
type SidePos = "left" | "right" | "hidden";

let phase = $state<Phase>("loading");
let errorText = $state("");

// key ごとに最新1件。addressable event なので同じ key の更新で置き換わる
let statusByKey = $state<Record<string, BosaiStatus>>({});
let bosaiSub: BosaiSubscription | null = null;
let received = $state(0);
// 受信できないまま黙って空になるのが一番困る。一定時間で状態を出す
let stalled = $state(false);
let stallTimer: ReturnType<typeof setTimeout> | null = null;
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
// 座標は地図領域からの相対。サイドバーが左右どちらでも同じ扱いになる
// 常に要るもの（一覧・詳細・発表ログ）は固定のカラムに置く。
// ウィンドウは「常には要らないもの」だけにする
const geom = $state({
  filter: { x: 24, y: 58, w: 250, h: 190 },
});
let openWins = $state<WinId[]>([]);
let zOrder = $state<WinId[]>(["filter"]);
let sidePos = $state<SidePos>("left");

// ---- ニュース ----
// 配信元が CORS を開けていないので、サーバ側の中継 (/api/news) 経由で取る
interface NewsItem { title: string; link: string; publishedAt: string; }
let news = $state<NewsItem[]>([]);
let newsSource = $state("");
let newsError = $state("");
let newsTimer: ReturnType<typeof setInterval> | null = null;

async function loadNews() {
  try {
    const res = await fetch("/api/news");
    const data = (await res.json()) as {
      source: string; items: NewsItem[]; error?: string;
    };
    newsSource = data.source ?? "";
    if (data.error) { newsError = data.error; return; }
    news = data.items ?? [];
    newsError = "";
  } catch (e) {
    newsError = e instanceof Error ? e.message : String(e);
  }
}

// ---- 状況別ワークスペース ----
let situation = $state<Situation>("normal");
// 直前に人が触っていたら自動で切り替えない。読んでいる途中で画面を奪わないため
let lastTouch = $state(0);
let pending = $state<Situation | null>(null);
const HOLD_MS = 30_000;

function applyWorkspace(id: Situation, moveMap = true) {
  const def = WORKSPACES.find((w) => w.id === id);
  if (!def) return;
  situation = id;
  pending = null;

  // レイヤーは定義にあるものだけを入れる
  const next: Record<string, boolean> = {};
  for (const l of LAYERS) next[l.id] = l.ready && def.layers.includes(l.id);
  for (const k of Object.keys(layerOn)) if (!(k in next)) next[k] = false;
  layerOn = next;
  for (const h of HAZARD_TILES) {
    const on = next[h.id];
    const group = hazardLayers[h.id];
    if (!group || !map) continue;
    if (on) group.addTo(map);
    else map.removeLayer(group);
  }

  if (moveMap) {
    const targets = focusTargets(def, active);
    const head = targets.find((t) => t.area && prefectureCodeOfArea(t.area));
    if (head?.area) {
      const pref = prefectureCodeOfArea(head.area);
      if (pref) zoomToPrefecture(pref);
    } else if (!def.focus) {
      map?.fitBounds(HOME_BOUNDS, { padding: [2, 2] });
    }
  }
  restyle();
}

function pickWorkspace(id: Situation) {
  lastTouch = Date.now();
  applyWorkspace(id);
}

// 状況が変わったら切り替える。ただし直前まで操作していたら帯を出すに留める
function considerSwitch() {
  const detected = detectSituation(statuses);
  if (detected === situation) { pending = null; return; }
  if (Date.now() - lastTouch > HOLD_MS) applyWorkspace(detected);
  else pending = detected;
}
// 段階のフィルター。地図と一覧の両方に効く
const sevOn = $state<Record<Severity, boolean>>({
  emergency: true, warning: true, advisory: true, info: false,
});

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
const active = $derived(statuses.filter((s) => isActive(s) && sevOn[s.severity]));

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

// 県ごとにまとめる。区域ごとに並べると同じ県名が何度も繰り返され、
// 実データでは 115行のうち大半がその繰り返しだった。
// 県でまとめると 40行 ＋ 県に属さないもの、になる
interface PrefGroup {
  prefCode: string;
  prefName: string;
  top: Severity;
  itemCount: number;
  areas: AreaGroup[];
}

const prefGroups = $derived.by(() => {
  const by: Record<string, PrefGroup> = {};
  for (const g of groups) {
    if (!g.prefCode) continue;
    const p = by[g.prefCode] ?? (by[g.prefCode] = {
      prefCode: g.prefCode,
      prefName: g.prefName ?? g.prefCode,
      top: g.top,
      itemCount: 0,
      areas: [],
    });
    p.areas.push(g);
    p.itemCount += g.items.length;
    if (SEVERITY_RANK[g.top] > SEVERITY_RANK[p.top]) p.top = g.top;
  }
  const list = Object.values(by);
  for (const p of list) {
    p.areas.sort(
      (a, b) => SEVERITY_RANK[b.top] - SEVERITY_RANK[a.top] || a.areaCode.localeCompare(b.areaCode),
    );
  }
  return list.sort(
    (a, b) => SEVERITY_RANK[b.top] - SEVERITY_RANK[a.top] || a.prefCode.localeCompare(b.prefCode),
  );
});

// 都道府県に対応づかないもの。仕様書のとおり震央地名・津波予報区・火山・河川が該当する
const orphanGroups = $derived(groups.filter((g) => !g.prefCode));

// 折りたたみ。危ないものを隠さないよう、警報以上は既定で開く
const expanded = $state<Record<string, boolean>>({});
const isOpen = (p: PrefGroup) =>
  expanded[p.prefCode] ?? SEVERITY_RANK[p.top] >= SEVERITY_RANK.warning;
function togglePref(code: string, cur: boolean) {
  expanded[code] = !cur;
}

// 地図に面として出せないもの。「地図に無い＝危険が無い」と読まれないよう数を出す
const offMapCount = $derived(groups.filter((g) => !g.onMap).length);

const detailGroup = $derived(groups.find((g) => g.areaCode === selectedArea) ?? null);

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
      considerSwitch();
    });
    stallTimer = setTimeout(() => { if (received === 0) stalled = true; }, 12000);

    void loadNews();
    newsTimer = setInterval(() => void loadNews(), 5 * 60 * 1000);
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
    phase = "error";
  }
});

onDestroy(() => {
  if (stallTimer) clearTimeout(stallTimer);
  if (newsTimer) clearInterval(newsTimer);
  bosaiSub?.close();
  bosaiSub = null;
  map?.remove();
  map = null;
  areaLayer = null;
});

function fmtStamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const DOCK: [WinId, string][] = [["filter", "フィルター"]];

// 発表ログ。addressable event は履歴を残さないので、
// いま存在するものを発表順に並べるところまでしかできない
const logRows = $derived(
  [...active]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 80),
);
</script>

<svelte:head><title>防災ダッシュボード</title></svelte:head>

<svelte:window onpointerdown={() => (lastTouch = Date.now())} onkeydown={() => (lastTouch = Date.now())} />

<div class="console">
  <header class="bar">
    <span class="beacon" class:live={phase === "ready"}></span>
    <span class="brand">防災オペレーション</span>
    <div class="wsw">
      <b>状況</b>
      {#each WORKSPACES as w (w.id)}
        <button class:on={situation === w.id} onclick={() => pickWorkspace(w.id)}>{w.label}</button>
      {/each}
    </div>
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
    <div class="sidesw">
      <button class:on={sidePos === "left"} onclick={() => (sidePos = "left")} title="サイドバーを左へ">左</button>
      <button class:on={sidePos === "right"} onclick={() => (sidePos = "right")} title="サイドバーを右へ">右</button>
      <button class:on={sidePos === "hidden"} onclick={() => (sidePos = "hidden")} title="サイドバーを隠す">隠</button>
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
        class="lyr cut-sm"
        class:on={layerOn[l.id]}
        class:stripe-wip={!l.ready}
        disabled={!l.ready}
        onclick={() => toggleLayer(l.id)}
      >
        <i style="background: {l.color}"></i>{l.label}{#if !l.ready}<span class="soon">未実装</span>{/if}
      </button>
    {/each}
  </nav>

  <div class="body">
    <div class="cols" class:right={sidePos === "right"} class:hidden={sidePos === "hidden"}>
      <!-- 1カラム目：発令中一覧 -->
      <section class="col col-list">
        <div class="col-head">
          発令中<span class="sp"></span><b>{prefGroups.length}</b>県
          {#if orphanGroups.length > 0}／<b>{orphanGroups.length}</b>件{/if}
          {#if selectedPref}
            <button class="mini" onclick={resetView}>全国</button>
          {/if}
        </div>
        <div class="col-body">
          {#if prefGroups.length === 0 && orphanGroups.length === 0}
            <p class="empty">発表中の情報はありません</p>
          {/if}
          {#if offMapCount > 0}
            <p class="note">
              {offMapCount} 地域は地図に面で出せません（土砂災害は市町村、地震は震央地名など、
              予報区の形を持たないため）。地図に無いことは危険が無いことを意味しません。
            </p>
          {/if}

          {#each prefGroups as p (p.prefCode)}
            {@const open = isOpen(p)}
            <div class="prefblock">
              <div class="prefhead" class:danger={p.top === "emergency"}>
                <button
                  class="twist"
                  aria-expanded={open}
                  aria-label={open ? "閉じる" : "開く"}
                  onclick={() => togglePref(p.prefCode, open)}
                >{open ? "▾" : "▸"}</button>
                <button class="prefname" onclick={() => zoomToPrefecture(p.prefCode)}>
                  <i class="bar b-{p.top}"></i>
                  <span class="nm">{p.prefName}</span>
                  <span class="cnt">{p.areas.length}区域 ／ {p.itemCount}件</span>
                  <span class="tag cut-sm t-{p.top}">{SEVERITY_LABEL[p.top]}</span>
                </button>
              </div>

              {#if open}
                {#each p.areas as g (g.areaCode)}
                  <button
                    class="row sub-row"
                    class:sel={g.areaCode === selectedArea}
                    class:danger={g.top === "emergency"}
                    onclick={() => pickArea(g.areaCode)}
                  >
                    <i class="bar b-{g.top}"></i>
                    <span class="mid">
                      <span class="ttl">{g.areaName}</span>
                      <span class="sub">
                        {g.items.map((i) => i.headline).join(" ／ ")}
                      </span>
                    </span>
                    {#if !g.onMap}<span class="gran">{g.areaType}</span>{/if}
                  </button>
                {/each}
              {/if}
            </div>
          {/each}

          {#if orphanGroups.length > 0}
            <div class="orphan-head">
              県に属さないもの
              <span class="sp"></span>
              <b>{orphanGroups.length}</b>件
            </div>
            <p class="note">
              震央地名・津波予報区・火山・河川は都道府県に対応づきません（複数県にまたがる、
              海域であるなど）。地図に面でも出せません。
            </p>
            {#each orphanGroups as g (g.areaCode)}
              <button
                class="row"
                class:sel={g.areaCode === selectedArea}
                class:danger={g.top === "emergency"}
                onclick={() => pickArea(g.areaCode)}
              >
                <i class="bar b-{g.top}"></i>
                <span class="mid">
                  <span class="ttl">{g.areaName}</span>
                  <span class="sub">{g.items.map((i) => i.headline).join(" ／ ")}</span>
                </span>
                <span class="gran">{g.areaType}</span>
              </button>
            {/each}
          {/if}
        </div>
      </section>

      <!-- 2カラム目：詳細（上）と発表ログ（下） -->
      <section class="col col-side">
        <div class="pane pane-detail">
          <div class="col-head">
            詳細<span class="sp"></span>
            {#if detailGroup}<b>{detailGroup.prefName ?? detailGroup.areaType}</b>{/if}
          </div>
          <div class="col-body">
            {#if !detailGroup}
              <p class="empty">一覧から地域を選んでください</p>
            {:else}
              <div class="detail">
                <div class="place">{detailGroup.areaName}</div>
                <div class="meta mono">
                  {detailGroup.prefName ?? "—"} ／ {detailGroup.areaType} ／ {detailGroup.areaCode}
                </div>
                <div class="k">発表中</div>
                <!-- 同じ地域に複数の情報が同時に出る。ブロックで並べると数と種類が一目で掴める -->
                <div class="chips">
                  {#each detailGroup.items as it (it.key)}
                    <span class="chip cut-sm t-{it.severity}">{it.headline}</span>
                  {/each}
                </div>
                <div class="k">発表時刻</div>
                <div class="times">
                  {#each detailGroup.items as it (it.key)}
                    <div><span>{fmtStamp(it.publishedAt)}</span>{it.headline}</div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="pane pane-log">
          <div class="col-head">発表ログ<span class="sp"></span><b>{logRows.length}</b>件</div>
          <div class="col-body">
            {#each logRows as r (r.key)}
              <button class="logrow" onclick={() => r.area && pickArea(r.area.code)}>
                <span class="tm mono">{fmtStamp(r.publishedAt)}</span>
                <i class="bar b-{r.severity}"></i>
                <span class="c">
                  <span class="h">{r.headline}</span>
                  <span class="w">{HAZARD_LABEL[r.hazard]}{#if r.area} ／ {r.area.name}{/if}</span>
                </span>
              </button>
            {/each}
            {#if logRows.length === 0}
              <p class="empty">受信待ち</p>
            {/if}
          </div>
        </div>
      </section>
    </div>

    <!-- 地図とニュース -->
    <div class="main">
      <div class="stage">
        <div class="map" bind:this={mapEl}></div>

        {#if phase === "loading"}
          <div class="overlay"><span>気象庁のデータを取得しています…</span></div>
        {:else if phase === "error"}
          <div class="overlay err">
            <strong>地図を表示できませんでした</strong><span>{errorText}</span>
          </div>
        {/if}

        {#if pending}
          <div class="switchbar cut-sm">
            <span>{WORKSPACES.find((w) => w.id === pending)?.label}の配置に切り替えますか</span>
            <button onclick={() => applyWorkspace(pending!)}>切り替える</button>
            <button class="ghosty" onclick={() => (pending = null)}>いいえ</button>
          </div>
        {/if}

        {#if hazardTooWide}
          <p class="hintbar cut-sm">ハザードマップはこの広さでは表示されません。拡大すると出ます。</p>
        {/if}

        {#if phase === "ready" && openWins.includes("filter")}
          <OpsWindow
            title="フィルター"
            geom={geom.filter}
            z={zOf("filter")}
            focused={zOrder.at(-1) === "filter"}
            onfocus={() => focusWin("filter")}
            onclose={() => toggleWin("filter")}
          >
            <div class="filters">
              {#each ["emergency", "warning", "advisory", "info"] as sv (sv)}
                <label class="fchk">
                  <input type="checkbox" bind:checked={sevOn[sv as Severity]} onchange={restyle} />
                  <i style="background: {SEVERITY_COLOR[sv as Severity]}"></i>
                  {SEVERITY_LABEL[sv as Severity]}
                </label>
              {/each}
            </div>
          </OpsWindow>
        {/if}

        <div class="dock">
          {#each DOCK as [id, label] (id)}
            <button class="cut-sm" class:on={openWins.includes(id)} onclick={() => toggleWin(id)}>
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

      <!-- 地図の下。横に伸びるので見出しが読める形にする -->
      <section class="news">
        <div class="col-head">
          ニュース<span class="sp"></span>
          {#if newsSource}<b>{newsSource}</b>{/if}
        </div>
        <div class="news-body">
          {#if newsError}
            <p class="empty">ニュースを取得できませんでした（{newsError}）</p>
          {:else if news.length === 0}
            <p class="empty">取得中…</p>
          {:else}
            {#each news as n (n.link)}
              <a class="newsitem" href={n.link} target="_blank" rel="external noopener noreferrer">
                <span class="tm mono">{fmtStamp(n.publishedAt)}</span>
                <span class="ttl">{n.title}</span>
              </a>
            {/each}
          {/if}
        </div>
      </section>
    </div>
  </div>
</div>

<style lang="scss">
.console {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-void);
  color: var(--ink);
  overflow: hidden;
}
.mono { font-family: var(--mono); }
.dim { color: var(--ink-dim); font-size: var(--t-small); }
.grow { flex: 1; }
.pad { padding: 0 var(--s3); align-self: center; }
.stall { color: #f0a2ae; font-size: var(--t-small); align-self: center; padding: 0 var(--s3); }

/* ---------- ヘッダ ---------- */
.bar {
  flex: none;
  display: flex;
  align-items: stretch;
  height: 52px;
  background: var(--bg-raise);
  border-bottom: 1px solid var(--line);
}
.beacon {
  align-self: center;
  margin-left: var(--s4);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-faint);
  flex: none;
  &.live { background: #2ed17f; box-shadow: 0 0 0 3px rgba(46, 209, 127, 0.16); }
}
.brand {
  display: flex;
  align-items: center;
  padding: 0 var(--s4) 0 var(--s2);
  font-weight: var(--w-bold);
  white-space: nowrap;
  border-right: 1px solid var(--line);
}
.counts { display: flex; min-width: 0; overflow: hidden; }
.cnt {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 var(--s4);
  border-right: 1px solid var(--line);
  white-space: nowrap;
  b {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--t-num);
    line-height: 1.05;
    font-weight: var(--w-bold);
  }
  span { font-size: var(--t-micro); letter-spacing: var(--ls-label); color: var(--ink-faint); }
}
.wsw {
  display: flex;
  align-items: center;
  gap: var(--s1);
  padding: 0 var(--s3);
  border-right: 1px solid var(--line);
  b {
    font-size: var(--t-micro);
    letter-spacing: var(--ls-label);
    color: var(--ink-faint);
    font-weight: var(--w-bold);
    margin-right: var(--s1);
  }
  button {
    font: inherit;
    font-size: var(--t-body);
    padding: 6px 12px;
    color: var(--ink-dim);
    background: transparent;
    border: none;
    cursor: pointer;
    &.on { background: #22303a; color: var(--ink); font-weight: var(--w-bold); }
    &:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  }
}

/* 自動切り替えを保留したときの提案。読んでいる途中で画面を奪わないため */
.switchbar {
  position: absolute;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  z-index: 850;
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 7px var(--s3);
  background: #14222a;
  border: 1px solid #2b4552;
  color: #9fc2d2;
  font-size: var(--t-small);
  button {
    font: inherit;
    font-size: var(--t-small);
    color: var(--bg-void);
    background: var(--ink);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font-weight: var(--w-bold);
    &.ghosty { background: transparent; color: var(--ink-dim); border: 1px solid var(--line-hi); font-weight: var(--w-normal); }
  }
}

.sidesw {
  display: flex;
  align-self: center;
  margin-left: var(--s3);
  button {
    font: inherit;
    font-size: var(--t-small);
    color: var(--ink-dim);
    background: transparent;
    border: 1px solid var(--line-hi);
    margin-left: -1px;
    padding: 5px 10px;
    cursor: pointer;
    &.on { background: var(--ink); color: var(--bg-void); border-color: var(--ink); font-weight: var(--w-bold); }
  }
}
.ghost {
  align-self: center;
  font: inherit;
  font-size: var(--t-small);
  color: var(--ink-dim);
  margin-right: var(--s4);
  background: transparent;
  border: 1px solid var(--line-hi);
  padding: 7px 12px;
  cursor: pointer;
  &:hover { background: #1c262b; }
}

/* ---------- レイヤー帯 ---------- */
.layers {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px var(--s3);
  background: #0e1417;
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}
.lyr {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  min-height: 32px;
  border: 1px solid #2f3d44;
  background: transparent;
  color: var(--ink-dim);
  font: inherit;
  font-size: var(--t-small);
  cursor: pointer;
  i { width: 8px; height: 8px; opacity: 0.35; flex: none; }
  &.on {
    color: var(--ink);
    border-color: var(--ink-faint);
    background: #1c262b;
    i { opacity: 1; }
  }
  /* 未実装は工事中。破線＋下端のシマシマ（彩度が無いので段階の色と混ざらない） */
  &:disabled {
    color: var(--ink-faint);
    border-style: dashed;
    cursor: not-allowed;
    i { background: #3a464c !important; opacity: 1; }
  }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
}
.soon { font-size: var(--t-micro); color: var(--ink-faint); margin-left: 3px; }
.sep { flex: none; width: 1px; align-self: stretch; margin: 0 var(--s1); background: #2a373d; }

/* ---------- 本体 ---------- */
.body { flex: 1; display: flex; min-height: 0; }

/* 常に要るものは固定のカラムに置く。画面端に接するので45度カットしない。
   固定と浮動を形で区別する */
.cols {
  flex: none;
  display: flex;
  min-height: 0;
  &.right { order: 2; }
  &.hidden { display: none; }
}
.col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--line);
}
.cols.right .col:last-child { border-right: none; }
.cols.right .col:first-child { border-left: 1px solid var(--line); }
.col-list { width: 340px; }
.col-side { width: 320px; }

.pane { display: flex; flex-direction: column; min-height: 0; }
/* 詳細は内容が短いことが多いので、余りは発表ログに回す */
.pane-detail { flex: 0 1 auto; max-height: 46%; border-bottom: 1px solid var(--line); }
.pane-log { flex: 1 1 auto; }

.col-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 9px var(--s3);
  background: var(--bg-raise);
  border-bottom: 1px solid var(--line);
  font-size: var(--t-micro);
  letter-spacing: var(--ls-label);
  color: var(--ink-faint);
  b { color: var(--ink); font-size: var(--t-body); letter-spacing: 0; font-weight: var(--w-bold); }
  .sp { flex: 1; }
}
.mini {
  font: inherit;
  font-size: var(--t-micro);
  letter-spacing: 0;
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-hi);
  padding: 3px 8px;
  cursor: pointer;
}
.col-body { flex: 1; overflow-y: auto; min-height: 0; }

/* 県の見出し */
.prefblock { border-bottom: 1px solid var(--line); }
.prefhead {
  display: flex;
  align-items: stretch;
  background: #161d21;
  position: relative;
  /* 切迫だけシマシマ。ここでしか使わないので模様が印になる */
  &.danger::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.16;
    background-image: repeating-linear-gradient(45deg, var(--sev-emergency) 0 6px, transparent 6px 12px);
  }
}
.twist {
  flex: none;
  width: 26px;
  font: inherit;
  font-size: var(--t-small);
  color: var(--ink-faint);
  background: transparent;
  border: none;
  cursor: pointer;
  &:hover { color: var(--ink); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
}
.prefname {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 8px var(--s3) 8px 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:hover { background: var(--bg-raise); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  i.bar { width: 3px; align-self: stretch; flex: none; }
  .nm { font-size: var(--t-body); font-weight: var(--w-bold); white-space: nowrap; }
  .cnt { flex: 1; font-size: var(--t-micro); color: var(--ink-faint); white-space: nowrap; }
}

.orphan-head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 9px var(--s3);
  margin-top: var(--s2);
  background: var(--bg-raise);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  font-size: var(--t-micro);
  letter-spacing: var(--ls-label);
  color: var(--ink-faint);
  b { color: var(--ink-dim); letter-spacing: 0; }
  .sp { flex: 1; }
}

.gran {
  align-self: center;
  flex: none;
  font-size: var(--t-micro);
  color: var(--ink-faint);
}

/* 一覧の行 */
.row {
  display: flex;
  width: 100%;
  gap: var(--s2);
  align-items: stretch;
  padding: var(--s2) var(--s3);
  border: none;
  border-bottom: 1px solid #1c2529;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  position: relative;
  &:hover { background: var(--bg-raise); }
  &.sel { background: #16242f; box-shadow: inset 2px 0 0 var(--accent); }
  /* 切迫だけシマシマ。ここでしか使わないので模様が「一番危ないもの」の印になる */
  &.danger::after {
    content: "";
    position: absolute;
    inset: 0 0 0 3px;
    pointer-events: none;
    opacity: 0.13;
    background-image: repeating-linear-gradient(45deg, var(--sev-emergency) 0 6px, transparent 6px 12px);
  }
  i.bar { width: 3px; flex: none; }
  .mid { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .ttl {
    font-size: var(--t-body);
    font-weight: var(--w-bold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: var(--t-small);
    color: var(--ink-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.sub-row {
  padding-left: 26px;
  border-bottom-color: #161e22;
  .ttl { font-weight: var(--w-normal); }
}

.tag {
  align-self: center;
  flex: none;
  padding: 2px 7px;
  font-size: var(--t-micro);
  font-weight: var(--w-bold);
}
.b-emergency { background: var(--sev-emergency); }
.b-warning { background: var(--sev-warning); }
.b-advisory { background: var(--sev-advisory); }
.b-info { background: var(--sev-info); }
.t-emergency { background: var(--sev-emergency); color: var(--on-emergency); }
.t-warning { background: var(--sev-warning); color: var(--on-warning); }
.t-advisory { background: var(--sev-advisory); color: var(--on-advisory); }
.t-info { background: var(--sev-info); color: var(--on-info); }

/* 地図とニュースを縦に積む */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }

.news {
  flex: none;
  height: 168px;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-top: 1px solid var(--line);
}
.news-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  /* 横に伸びる場所なので、見出しが読める幅で折り返す */
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(430px, 1fr));
  align-content: start;
}
.newsitem {
  display: flex;
  gap: var(--s2);
  align-items: baseline;
  padding: 7px var(--s3);
  border-bottom: 1px solid #1c2529;
  border-right: 1px solid #1c2529;
  color: inherit;
  text-decoration: none;
  &:hover { background: var(--bg-raise); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .tm { font-size: var(--t-micro); color: var(--ink-faint); flex: none; }
  .ttl {
    font-size: var(--t-small);
    color: var(--ink-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  &:hover .ttl { color: var(--ink); }
}

/* ---------- 地図 ---------- */
.stage { flex: 1; position: relative; min-width: 0; }
.map {
  position: absolute;
  inset: 0;
  background: var(--bg-void);
  /* Leaflet の内部ペインは z-index 200〜700 を使う。ここで重なり文脈を作らないと
     タイルやポリゴンがウィンドウより前に出る */
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
  gap: var(--s2);
  background: rgba(8, 11, 13, 0.86);
  color: var(--ink-dim);
  &.err { color: #ff93a5; }
}
.hintbar {
  position: absolute;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  z-index: 800;
  margin: 0;
  padding: 6px var(--s3);
  background: #14222a;
  color: #9fc2d2;
  font-size: var(--t-small);
  border: 1px solid #2b4552;
}

.dock {
  position: absolute;
  left: var(--s3);
  bottom: 44px;
  z-index: 800;
  display: flex;
  gap: 6px;
  button {
    font: inherit;
    font-size: var(--t-small);
    color: var(--ink-dim);
    background: rgba(8, 11, 13, 0.9);
    border: 1px solid var(--line-hi);
    padding: 7px 13px;
    cursor: pointer;
    &.on { background: var(--ink); color: var(--bg-void); border-color: var(--ink); font-weight: var(--w-bold); }
  }
}

.credit {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 800;
  margin: 0;
  font-size: var(--t-micro);
  color: var(--ink-faint);
  white-space: nowrap;
  pointer-events: none;
}

.legend {
  position: absolute;
  right: 60px;
  bottom: 12px;
  z-index: 800;
  display: flex;
  gap: var(--s3);
  font-size: var(--t-micro);
  color: var(--ink-dim);
  background: rgba(8, 11, 13, 0.8);
  border: 1px solid var(--line);
  padding: 5px 10px;
  pointer-events: none;
  span { display: inline-flex; align-items: center; gap: 5px; }
  i { width: 9px; height: 9px; }
}

/* ---------- ウィンドウの中身 ---------- */
.empty { padding: var(--s5) var(--s3); margin: 0; color: var(--ink-faint); text-align: center; }
.note {
  margin: 0;
  padding: var(--s2) 10px;
  font-size: var(--t-micro);
  line-height: 1.6;
  color: var(--ink-dim);
  border-bottom: 1px solid #212b30;
}

.detail { padding: var(--s3); display: flex; flex-direction: column; gap: var(--s3); }
.place { font-size: var(--t-lead); font-weight: var(--w-bold); letter-spacing: var(--ls-tight); }
.meta { font-size: var(--t-micro); color: var(--ink-dim); }
.k { font-size: var(--t-micro); letter-spacing: var(--ls-label); color: var(--ink-faint); font-weight: var(--w-bold); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { padding: 6px 10px; font-size: var(--t-small); font-weight: var(--w-bold); }
.times {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  font-size: var(--t-small);
  color: var(--ink-dim);
  span { font-family: var(--mono); color: var(--ink-faint); margin-right: var(--s2); }
}

.logrow {
  display: flex;
  width: 100%;
  gap: var(--s2);
  padding: 7px 11px;
  border: none;
  border-bottom: 1px solid #1c2529;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  align-items: stretch;
  &:hover { background: var(--bg-raise); }
  .tm { font-family: var(--mono); font-size: var(--t-micro); color: var(--ink-faint); flex: none; width: 76px; }
  i.bar { width: 3px; flex: none; }
  .c { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .h { font-size: var(--t-small); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .w { font-size: var(--t-micro); color: var(--ink-faint); }
}

.filters { padding: var(--s3); display: flex; flex-direction: column; gap: var(--s2); }
.fchk {
  display: flex;
  align-items: center;
  gap: var(--s2);
  font-size: var(--t-small);
  color: var(--ink-dim);
  cursor: pointer;
  i { width: 9px; height: 9px; flex: none; }
}

:global(.leaflet-container) { background: var(--bg-void); outline: none; }
:global(.leaflet-control-zoom a) {
  background: var(--bg-raise);
  color: var(--ink-dim);
  border-color: var(--line-hi);
}
:global(.leaflet-control-zoom a:hover) { background: #22303a; }
:global(.leaflet-tooltip) {
  background: var(--bg-raise);
  color: var(--ink);
  border: 1px solid var(--line-hi);
  border-radius: 0;
  box-shadow: none;
  font-size: var(--t-small);
}
:global(.leaflet-tooltip-top::before) { border-top-color: var(--line-hi); }
</style>
