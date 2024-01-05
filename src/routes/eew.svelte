<script lang="ts">
  import { parseISO, format } from "date-fns";
  export let content: string = "";
  const item = JSON.parse(content);
  const fontColor = () => {
    if (item.forecast === "7") {
      return "text-danger";
    }
    if (item.forecast === "6強") {
      return "text-danger";
    }
    if (item.forecast === "6弱") {
      return "text-danger";
    }
    if (item.forecast === "5強") {
      return "text-warning";
    }
    if (item.forecast === "5弱") {
      return "text-warning";
    }
    if (item.forecast === "4") {
      return "text-warning";
    }
    return "";
  };
</script>

<!-- {content} -->
<div class="text-center">
  <div class="fs-3 text-warning">
    緊急地震速報 (第{item.serial}報)
  </div>
  <div class="mt-1">
    {format(parseISO(item.originTime), "yyyy年MM月dd日 HH時mm分")}
  </div>
  <div class="forecast mt-4 px-3 {fontColor()}">
    震度 {item.forecast}
  </div>
  <div class="magnitude">
    M {item.magnitude}
  </div>
  <div class="place mt-4">
    {item.place}
  </div>
  <div class="">
    北緯 {item.latitude}度、東経 {item.longitude}度<br />深さ {Math.abs(
      item.depth / 1000,
    )}km
  </div>
</div>

<style>
  .forecast {
    font-size: 5rem;
    line-height: 5rem;
    font-family: "LINE_SEED_Bd";
  }
  @media (min-width: 576px) {
    .forecast {
      font-size: 10rem;
      line-height: 10rem;
    }
  }
  .magnitude {
    margin-top: 0.5rem;
    font-size: 2.5rem;
    line-height: 2.5rem;
    font-family: "LINE_SEED_Eb";
  }
  @media (min-width: 576px) {
    .magnitude {
      margin-top: 2rem;
      font-size: 4rem;
      line-height: 4rem;
    }
  }
  .place {
    font-size: 3rem;
    font-family: "LINE_SEED_Bd";
  }
  @media (min-width: 576px) {
    .place {
      font-size: 5rem;
    }
  }
</style>
