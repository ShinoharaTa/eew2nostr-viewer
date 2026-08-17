<script lang="ts">
// 地図の上に重ねる可動ウインドウ。移動・リサイズ・前面化・折りたたみ・閉じる。
import type { Snippet } from "svelte";

/** 位置と大きさ。親が $state で持ち、ウインドウ側が直接書き換える。
 *  こうすると閉じて開き直しても位置が残る。 */
export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  title: string;
  sub?: string;
  geom: WindowGeometry;
  z: number;
  focused?: boolean;
  onfocus?: () => void;
  onclose?: () => void;
  children: Snippet;
}

let { title, sub = "", geom, z, focused = false, onfocus, onclose, children }: Props = $props();

let collapsed = $state(false);

const MIN_W = 200;
const MIN_H = 90;
/* 画面の外へ出せる余地。これより先へは掴んで持ち出せない。
   タブレットは回転で領域が急に狭くなるので、届かない場所を作らない */
const KEEP_X = 60;
const KEEP_Y = 40;

/** ウインドウを載せている領域（.stage）の大きさ。ドラッグの上限に使う */
function hostSize(el: HTMLElement): { w: number; h: number } | null {
  const host = (el.closest(".win") as HTMLElement | null)?.offsetParent;
  return host instanceof HTMLElement ? { w: host.clientWidth, h: host.clientHeight } : null;
}

function startDrag(e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button")) return;
  onfocus?.();
  const el = e.currentTarget as HTMLElement;
  const sx = e.clientX;
  const sy = e.clientY;
  const ox = geom.x;
  const oy = geom.y;
  const host = hostSize(el);
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    geom.x = Math.max(0, ox + ev.clientX - sx);
    geom.y = Math.max(0, oy + ev.clientY - sy);
    if (host) {
      geom.x = Math.min(geom.x, Math.max(0, host.w - KEEP_X));
      geom.y = Math.min(geom.y, Math.max(0, host.h - KEEP_Y));
    }
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

function startResize(e: PointerEvent) {
  e.stopPropagation();
  onfocus?.();
  const el = e.currentTarget as HTMLElement;
  const sx = e.clientX;
  const sy = e.clientY;
  const ow = geom.w;
  const oh = geom.h;
  const host = hostSize(el);
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    geom.w = Math.max(MIN_W, ow + ev.clientX - sx);
    geom.h = Math.max(MIN_H, oh + ev.clientY - sy);
    // 領域より大きくしても操作できない場所が増えるだけ
    if (host) {
      geom.w = Math.min(geom.w, host.w);
      geom.h = Math.min(geom.h, host.h);
    }
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}
</script>

<section
  class="win cut"
  class:focused
  class:collapsed
  style="left: {geom.x}px; top: {geom.y}px; width: {geom.w}px; height: {collapsed
    ? 'auto'
    : geom.h + 'px'}; z-index: {z};"
  onpointerdowncapture={() => onfocus?.()}
>
  <div class="inner cut">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="head" onpointerdown={startDrag}>
    <span class="t">{title}</span>
    {#if sub}<span class="sub">{sub}</span>{/if}
    <span class="sp"></span>
    <button
      class="ctl"
      onclick={() => (collapsed = !collapsed)}
      aria-label={collapsed ? "展開する" : "折りたたむ"}
    >{collapsed ? "□" : "–"}</button>
    {#if onclose}
      <button class="ctl" onclick={onclose} aria-label="閉じる">✕</button>
    {/if}
  </header>

  {#if !collapsed}
    <div class="body">{@render children()}</div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grip" onpointerdown={startResize}></div>
  {/if}
  </div>
</section>

<style lang="scss">
/* clip-path は border を切ってしまうので、枠は「背景色＋1px の余白」で作る */
.win {
  position: absolute;
  display: flex;
  background: var(--line-hi);
  padding: 1px;
  overflow: hidden;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
  &.focused { background: var(--accent); }
}
.inner {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-panel);
}

.head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: #1b252a;
  border-bottom: 1px solid #2a363c;
  cursor: move;
  font-size: 12px;
  touch-action: none;
  .t { font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }
  .sub {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: #6d7c83;
    white-space: nowrap;
  }
  .sp { flex: 1; }
}
.win.focused .head { background: #22303a; }

.ctl {
  font: inherit;
  font-size: var(--t-small);
  line-height: 1;
  color: var(--ink-faint);
  background: transparent;
  border: none;
  padding: 2px 5px;
  cursor: pointer;
  &:hover { color: var(--ink); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
}

.body { flex: 1; overflow: auto; min-height: 0; }

.grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  touch-action: none;
  background: linear-gradient(135deg, transparent 50%, #35454d 50%);
}

/* 指で操作する端末では掴む場所を大きくする。44px が目安 */
@media (pointer: coarse) {
  .head { padding: 10px; }
  .ctl { padding: 8px 12px; }
  .grip { width: 28px; height: 28px; }
}
</style>
