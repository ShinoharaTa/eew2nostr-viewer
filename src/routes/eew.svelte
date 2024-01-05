<script lang="ts">
  import { parseISO, format } from "date-fns";
  export let content: string = "";
  const item = JSON.parse(content);
  const fontColor = "text-warning";
</script>

<!-- {content} -->
<div class="page">
  <div class="text-center">
    <div class="fs-3 bg-black p-3 text-warning">
      緊急地震速報 (第{item.serial}報)
    </div>
    <div class="fs-5 mt-1">
      {format(parseISO(item.originTime), "yyyy年MM月dd日 HH時mm分")}
    </div>
    <div class="forecast mt-4 px-3 {fontColor}">
      震度 {item.forecast}
    </div>
    <div class="magnitude">
      M {item.magnitude}
    </div>
    <div class="place mt-4">
      {item.place}
    </div>
    <div class="fs-4">
      北緯 {item.latitude}度<br />東経 {item.longitude}度<br />深さ {Math.abs(
        item.depth / 1000,
      )}km
    </div>
  </div>
</div>

<style>
  .forecast {
    font-size: 6rem;
    line-height: 6rem;
    font-family: "LINE_SEED_Bd";
  }
  .magnitude {
    margin-top: 0.5rem;
    font-size: 2.5rem;
    line-height: 2.5rem;
    font-family: "LINE_SEED_Eb";
  }
  .place {
    font-size: 3rem;
    font-family: "LINE_SEED_Bd";
  }
</style>
