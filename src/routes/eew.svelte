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
  <div class="font-size-3 text-warning">
    緊急地震速報 (第{item.serial}報)
  </div>
  <div class="font-size-4">
    {format(parseISO(item.originTime), "yyyy年MM月dd日 HH時mm分")}
  </div>
  <div class="font-size-1 font-weight-eb {fontColor()}">
    震度 {item.forecast}
  </div>
  <div class="font-size-3 font-weight-bd">
    M {item.magnitude}
  </div>
  <div class="font-size-2 font-weight-eb">
    {item.place}
  </div>
  <div class="font-size-4">
    北緯 {item.latitude}度、東経 {item.longitude}度<br />深さ {Math.abs(
      item.depth,
    )}km
  </div>
</div>
