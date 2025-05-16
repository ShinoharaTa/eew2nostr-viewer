<script lang="ts">
import { format, getUnixTime, subDays } from "date-fns";
import type { Event } from "nostr-tools/core";
import EEWItem from "$lib/components/main/eewItem.svelte";
import EEWDetail from "$lib/components/main/eewDetail.svelte";
import EEWLatest from "$lib/components/main/latestEewDetail.svelte";
import { SimplePool } from "nostr-tools/pool";
import { onMount } from "svelte";

const pool = new SimplePool();
const relays = [
	"wss://relay-jp.shino3.net",
	"wss://r.kojira.io",
	"wss://yabu.me",
];

const now = getUnixTime(new Date());
const yesterday = getUnixTime(subDays(new Date(), 7));
let eews: Map<string, Event[]> = new Map();
let selectedId: string | null = null;
$: eewEntries = Array.from(eews.entries()) as [string, Event[]][];
$: selectedEvents =
	selectedId && eews.has(selectedId) ? (eews.get(selectedId) ?? []) : [];

$: latestEews = eewEntries
	.map(([eventId, events]) => {
		const latest = [...events]
			.sort((a, b) => a.created_at - b.created_at)
			.at(-1);
		if (!latest) return null;
		const parsed = JSON.parse(latest.content);
		const forecast = !parsed.body.intensity
			? "不明"
			: parsed.body.intensity.forecastMaxInt.to === "over"
				? "不明"
				: parsed.body.intensity.forecastMaxInt.to;
		return {
			id: eventId,
			created: latest.created_at,
			forecast,
			magnitude: parsed.body.earthquake.magnitude.value,
			hypocenter: parsed.body.earthquake.hypocenter.name,
			depth: parsed.body.earthquake.hypocenter.depth.value,
			originTime: new Date(parsed.body.earthquake.originTime),
		};
	})
	.filter((item) => !!item)
	.sort((a, b) => b.created - a.created);
const filter = {
	kinds: [7078],
	"#d": ["eew_alert_system_by_shino3"],
	since: yesterday,
};
onMount(() => {
	pool.subscribe(relays, filter, {
		onevent(ev) {
			const { eventId } = JSON.parse(ev.content);
			const arr = eews.get(eventId) ?? [];
			eews.set(eventId, [...arr, ev]);
			eews = new Map(eews);
		},
	});
});
</script>

<!-- <div class="top-right-checkbox form-check">
  <input class="form-check-input" type="checkbox" id="testModeCheckbox" bind:checked={$isTestMode}>
  <label class="form-check-label" for="testModeCheckbox">テストモード</label>
</div> -->

<!-- <NostrApp {relays}>
  <UniqueEventList
  >
    <div slot="loading">
      <p>Loading...</p>
    </div>

    <div slot="error" let:error>
      <p>{error}</p>
    </div>

  </UniqueEventList>
</NostrApp> -->
<div class="outline">
  {#if eewEntries.length > 0}
    <div class="eew-detail">
      {#if selectedEvents.length > 0}
        <div class="latest">
          <EEWLatest content={selectedEvents.at(-1).content}></EEWLatest>
        </div>
        <div class="list">
          {#each selectedEvents as ev}
            <EEWDetail content={ev.content}></EEWDetail>
          {/each}
        </div>
      {:else}
        詳細は一覧から選択
      {/if}
    </div>
    <div class="eew-list">
    {#each latestEews as item}
      <div on:click={() => (selectedId = item.id)}>
        <EEWItem {item} selected={selectedId===item.id}></EEWItem>
      </div>
    {/each}
    </div>
  {:else}
  <p>まだ EEW イベントが届いていません…</p>
  {/if}
</div>

<style lang="scss">
.outline {
  display: flex;
  width: 100vw;
}
.eew-detail{
  width: calc(100vw - 320px);
  >.latest {
    height: 35dvh;
    overflow: hidden;
  }
  >.list {
    height: 65dvh;
    overflow: auto;
  }
}
.eew-list {
  width: 320px;
  min-width: 320px;
  height: 100dvh;
  overflow: auto;
}
</style>