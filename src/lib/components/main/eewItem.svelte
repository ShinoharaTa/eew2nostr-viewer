<script lang="ts">
import { format } from "date-fns";
export let item: {
	forecast: string;
	hypocenter: string;
	depth: string;
	magnitude: string;
	originTime: Date;
};
export let selected: boolean
</script>

<section class="outline {selected ? 'selected' : ''}">
  <div class="flex-shrink-1">
    <div class="forecast">
      {#if item.forecast === "不明"}
        <span class="undefined">不明</span>
      {:else if item.forecast === "4"}
        <span class="text-warning">{item.forecast}</span>
      {:else if item.forecast === "5-"}
        <span class="text-warning">{item.forecast}</span><span class="text-warning note">弱</span>
      {:else if item.forecast === "5+"}
        <span class="text-danger">{item.forecast}</span><span class="text-danger note">強</span>
      {:else if item.forecast === "6-"}
        <span class="text-danger">{item.forecast}</span><span class="text-danger note">弱</span>
      {:else if item.forecast === "6+"}
        <span class="text-danger">{item.forecast}</span><span class="text-danger note">強</span>
      {:else if item.forecast === "7"}
        <span class="text-danger">{item.forecast}</span>
      {:else}
        <span>{item.forecast}</span>
      {/if}
    </div>
    <div class="magnitude">
      M{item.magnitude}
    </div>
  </div>
  <div class="flex-fill ms-2">
    <div class="hypocenter">{item.hypocenter}</div>
    <div class="time">{format(new Date(item.originTime), "yyyy-MM-dd HH:mm")}</div>
  </div>
</section>

<style lang="scss">
.outline {
  display: flex;
  align-items: center;
  padding: 1rem 0.4rem 0.1rem;
  border-left: 4px #888 solid;
  border-top: solid 1px #888;
  margin-bottom: 0.5rem;
  >.warning {}
  >.danger {}
  &.selected {
    background-color: #222;
  }
}
.forecast {
  font-family: "LINE_SEED_Eb";
  font-size: 2rem;
  line-height: 1.8rem;
  text-align: center;
  width: 3.5rem;
  >.undefined {
    // writing-mode: vertical-rl;
    // white-space: pre-wrap;
    font-size: 1.6rem;
    // line-height: 0rem;
  }
  >.note {
    font-size: 1.2rem
  }
}
.magnitude {
  font-size: 0.7rem;
  text-align: center;
}
.hypocenter {
  font-size: 1.4rem;
}

.time {
  font-size: 0.6rem;
}
</style>