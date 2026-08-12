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

function startDrag(e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button")) return;
  onfocus?.();
  const el = e.currentTarget as HTMLElement;
  const sx = e.clientX;
  const sy = e.clientY;
  const ox = geom.x;
  const oy = geom.y;
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    geom.x = Math.max(0, ox + ev.clientX - sx);
    geom.y = Math.max(0, oy + ev.clientY - sy);
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
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    geom.w = Math.max(MIN_W, ow + ev.clientX - sx);
    geom.h = Math.max(MIN_H, oh + ev.clientY - sy);
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
  class="win"
  class:focused
  class:collapsed
  style="left: {geom.x}px; top: {geom.y}px; width: {geom.w}px; height: {collapsed
    ? 'auto'
    : geom.h + 'px'}; z-index: {z};"
  onpointerdowncapture={() => onfocus?.()}
>
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
</section>

<style lang="scss">
.win {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: rgba(18, 25, 29, 0.95);
  border: 1px solid #35454d;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
  &.focused { border-color: #67a9c4; }
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
  font-size: 12px;
  line-height: 1;
  color: #6d7c83;
  background: transparent;
  border: none;
  padding: 2px 5px;
  cursor: pointer;
  &:hover { color: #e2e9ec; }
  &:focus-visible { outline: 2px solid #67a9c4; outline-offset: 1px; }
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
</style>
